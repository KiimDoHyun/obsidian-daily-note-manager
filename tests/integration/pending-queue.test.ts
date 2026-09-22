/**
 * 대기 큐 통합 시나리오.
 *
 * 핵심 불변식: "오늘 데일리 노트는 어떤 실패가 있어도 반드시 생성된다."
 * 종합/드롭/보관 문서 쓰기가 실패하면 이벤트는 큐에 쌓이고, 다음 실행에서 재시도된다.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { Engine } from "../../src/engine";
import { fromIsoDate } from "../../src/engine/dateutil";
import { dailyNotePath, monthlySummaryPath } from "../../src/engine/paths";
import {
  pendingQueuePath,
  readQueue,
} from "../../src/engine/writers/pendingQueue";
import { InMemoryVault } from "../helpers/inMemoryVault";
import { makeDailyNoteMd, makeSettings } from "../helpers/fixtures";
import type { DailyNoteSettings } from "../../src/settings";

function withFixedToday<T>(iso: string, fn: () => T | Promise<T>): Promise<T> {
  const orig = Date;
  const [y, m, d] = iso.split("-").map((n) => parseInt(n, 10));
  const target = new orig(y, m - 1, d).getTime();
  // @ts-expect-error monkey patch for test determinism
  globalThis.Date = class extends orig {
    constructor(...args: unknown[]) {
      if (args.length === 0) super(target);
      else super(...(args as ConstructorParameters<typeof orig>));
    }
    static now() {
      return target;
    }
  };
  return Promise.resolve(fn()).finally(() => {
    globalThis.Date = orig;
  });
}

function makeEngine(
  vault: InMemoryVault,
  settings?: Partial<DailyNoteSettings>,
): { engine: Engine; settings: DailyNoteSettings } {
  const s = makeSettings({ autoRunOnLoad: false, ...(settings ?? {}) });
  const engine = new Engine(
    vault,
    s,
    async () => {
      /* saveSettings noop */
    },
    "test-vault",
  );
  return { engine, settings: s };
}

/**
 * 특정 경로의 write 를 실패시키는 프록시 볼트.
 * 실제 InMemoryVault 를 위임하되, "실패 규칙" 리스트에 매치되는 write 만 던진다.
 */
class FailingVaultProxy extends InMemoryVault {
  private failWritePaths = new Set<string>();
  private failReadPaths = new Set<string>();

  failWritesTo(path: string): void {
    this.failWritePaths.add(path);
  }

  allowWritesTo(path: string): void {
    this.failWritePaths.delete(path);
  }

  async write(path: string, content: string): Promise<void> {
    if (this.failWritePaths.has(path)) {
      throw new Error(`simulated write failure: ${path}`);
    }
    return super.write(path, content);
  }
}

describe("대기 큐 — 통합 시나리오", () => {
  let vault: FailingVaultProxy;
  beforeEach(() => {
    vault = new FailingVaultProxy();
  });

  it("종합 쓰기 성공 → 큐 파일 생성 안 됨", async () => {
    await withFixedToday("2026-09-15", async () => {
      const { engine, settings } = makeEngine(vault);
      vault.seed(
        dailyNotePath(fromIsoDate("2026-09-14"), settings),
        makeDailyNoteMd({ date: "2026-09-14", activeLines: ["- [x] 완료 항목"] }),
      );
      await engine.createForToday();
      expect(vault.exists(pendingQueuePath(settings))).toBe(false);
      // 완료가 종합에 정상 기록됐는지
      const summary = vault.peek(monthlySummaryPath(fromIsoDate("2026-09-14"), settings))!;
      expect(summary).toContain("완료 항목");
    });
  });

  it("종합 쓰기 실패 → 오늘 노트는 생성되고, 실패한 이벤트만 큐에 쌓임", async () => {
    await withFixedToday("2026-09-15", async () => {
      const { engine, settings } = makeEngine(vault);
      vault.seed(
        dailyNotePath(fromIsoDate("2026-09-14"), settings),
        makeDailyNoteMd({ date: "2026-09-14", activeLines: ["- [x] 완료 항목"] }),
      );
      const summaryPath = monthlySummaryPath(fromIsoDate("2026-09-14"), settings);
      // ensureSummary 는 성공, 하지만 appendEvent 의 두 번째 write 는 실패시킨다.
      // 전략: ensureSummary 가 파일을 만든 후 그 경로에 대한 write 를 실패시켜야 한다.
      // 간단하게 문서 파일을 미리 시드해서 ensureSummary 가 skip 되게 하고, 이후 write 를 실패로.
      vault.seed(
        summaryPath,
        [
          "---",
          "tags: [monthly-summary, 2026-09]",
          "---",
          "",
          "# 2026-09 월간 종합",
          "",
          "## 📈 이번 달 요약",
          "- 완료: 0건",
          "",
          "## 3주차 (09-14 ~ 09-18)",
          "",
          "### ✅ 완료",
          "",
          "### ⏭️ 드롭",
          "",
          "### 📦 보관 이동",
          "",
        ].join("\n"),
      );
      vault.failWritesTo(summaryPath);

      await engine.createForToday();

      // 오늘 노트는 반드시 만들어져야 한다.
      expect(vault.exists(dailyNotePath(fromIsoDate("2026-09-15"), settings))).toBe(true);
      // 실패한 completed 는 큐에 쌓임.
      const queue = await readQueue(vault, settings);
      expect(queue.length).toBe(1);
      expect(queue[0].eventType).toBe("completed");
      expect(queue[0].block.topText).toBe("완료 항목");
      expect(queue[0].targetSummaryPath).toBe(summaryPath);
    });
  });

  it("여러 실패가 큐에 누적된다", async () => {
    await withFixedToday("2026-09-15", async () => {
      const { engine, settings } = makeEngine(vault);
      vault.seed(
        dailyNotePath(fromIsoDate("2026-09-14"), settings),
        makeDailyNoteMd({
          date: "2026-09-14",
          activeLines: ["- [x] A", "- [x] B", "- [x] C"],
        }),
      );
      const summaryPath = monthlySummaryPath(fromIsoDate("2026-09-14"), settings);
      vault.seed(
        summaryPath,
        [
          "---",
          "tags: [monthly-summary, 2026-09]",
          "---",
          "",
          "# 2026-09 월간 종합",
          "",
          "## 📈 이번 달 요약",
          "- 완료: 0건",
          "",
          "## 3주차 (09-14 ~ 09-18)",
          "",
          "### ✅ 완료",
          "",
          "### ⏭️ 드롭",
          "",
          "### 📦 보관 이동",
          "",
        ].join("\n"),
      );
      vault.failWritesTo(summaryPath);

      await engine.createForToday();

      const queue = await readQueue(vault, settings);
      expect(queue.length).toBe(3);
      expect(queue.map((e) => e.block.topText).sort()).toEqual(["A", "B", "C"]);
    });
  });

  it("다음 실행에서 종합이 복구되면 큐가 소진되고 파일이 사라진다", async () => {
    // 첫 실행: 종합 write 실패 → 큐에 쌓임.
    await withFixedToday("2026-09-15", async () => {
      const { engine, settings } = makeEngine(vault);
      vault.seed(
        dailyNotePath(fromIsoDate("2026-09-14"), settings),
        makeDailyNoteMd({ date: "2026-09-14", activeLines: ["- [x] 항목"] }),
      );
      const summaryPath = monthlySummaryPath(fromIsoDate("2026-09-14"), settings);
      vault.seed(
        summaryPath,
        [
          "---",
          "tags: [monthly-summary, 2026-09]",
          "---",
          "",
          "# 2026-09 월간 종합",
          "",
          "## 📈 이번 달 요약",
          "- 완료: 0건",
          "",
          "## 3주차 (09-14 ~ 09-18)",
          "",
          "### ✅ 완료",
          "",
          "### ⏭️ 드롭",
          "",
          "### 📦 보관 이동",
          "",
        ].join("\n"),
      );
      vault.failWritesTo(summaryPath);
      await engine.createForToday();
      expect((await readQueue(vault, settings)).length).toBe(1);
    });

    // 다음 날: 종합 write 를 다시 허용, 오늘 노트 새로 만들면 drain 이 큐를 비운다.
    await withFixedToday("2026-09-16", async () => {
      const { engine, settings } = makeEngine(vault);
      const summaryPath = monthlySummaryPath(fromIsoDate("2026-09-15"), settings);
      vault.allowWritesTo(summaryPath);
      await engine.createForToday();
      expect(vault.exists(dailyNotePath(fromIsoDate("2026-09-16"), settings))).toBe(true);
      expect(vault.exists(pendingQueuePath(settings))).toBe(false);
      const summary = vault.peek(summaryPath)!;
      expect(summary).toContain("항목");
    });
  });

  it("여러 달 항목이 큐에 섞여 있으면 각기 대상 문서로 복구된다", async () => {
    // 09월 대상 + 10월 대상 항목을 시드로 넣어두고 drain 을 호출한다.
    const { engine, settings } = makeEngine(vault);
    const sep = monthlySummaryPath(fromIsoDate("2026-09-30"), settings);
    const oct = monthlySummaryPath(fromIsoDate("2026-10-01"), settings);
    // 두 종합 문서 모두 정상 시드.
    for (const [path, header] of [[sep, "## 5주차 (09-28 ~ 09-30)"], [oct, "## 1주차 (10-01 ~ 10-02)"]] as const) {
      vault.seed(
        path,
        [
          "---",
          `tags: [monthly-summary]`,
          "---",
          "",
          "# 종합",
          "",
          "## 📈 이번 달 요약",
          "- 완료: 0건",
          "",
          header,
          "",
          "### ✅ 완료",
          "",
          "### ⏭️ 드롭",
          "",
          "### 📦 보관 이동",
          "",
        ].join("\n"),
      );
    }

    // 큐에 시드
    const queueContent = [
      "```queue",
      `{"eventType":"completed","eventDate":"2026-09-30","targetSummaryPath":"${sep}","block":{"topText":"9월 항목","children":[],"isCompleted":true,"isDroppedImmediate":false,"hasArchiveMarker":false,"hasLongMarker":false,"carryoverDays":0,"originDate":null}}`,
      `{"eventType":"completed","eventDate":"2026-10-01","targetSummaryPath":"${oct}","block":{"topText":"10월 항목","children":[],"isCompleted":true,"isDroppedImmediate":false,"hasArchiveMarker":false,"hasLongMarker":false,"carryoverDays":0,"originDate":null}}`,
      "```",
    ].join("\n");
    vault.seed(pendingQueuePath(settings), queueContent);

    const res = await engine.drainPendingQueue();
    expect(res.drained).toBe(2);
    expect(res.remaining).toBe(0);
    expect(vault.peek(sep)!).toContain("9월 항목");
    expect(vault.peek(oct)!).toContain("10월 항목");
  });

  it("부분 드레인: 09월은 회복, 10월은 여전히 실패", async () => {
    const { engine, settings } = makeEngine(vault);
    const sep = monthlySummaryPath(fromIsoDate("2026-09-30"), settings);
    const oct = monthlySummaryPath(fromIsoDate("2026-10-01"), settings);

    // 09월만 정상 시드, 10월은 파일 없음.
    vault.seed(
      sep,
      [
        "---",
        `tags: [monthly-summary]`,
        "---",
        "",
        "# 종합",
        "",
        "## 📈 이번 달 요약",
        "- 완료: 0건",
        "",
        "## 5주차 (09-28 ~ 09-30)",
        "",
        "### ✅ 완료",
        "",
        "### ⏭️ 드롭",
        "",
        "### 📦 보관 이동",
        "",
      ].join("\n"),
    );

    const queueContent = [
      "```queue",
      `{"eventType":"completed","eventDate":"2026-09-30","targetSummaryPath":"${sep}","block":{"topText":"9월 항목","children":[],"isCompleted":true,"isDroppedImmediate":false,"hasArchiveMarker":false,"hasLongMarker":false,"carryoverDays":0,"originDate":null}}`,
      `{"eventType":"completed","eventDate":"2026-10-01","targetSummaryPath":"${oct}","block":{"topText":"10월 항목","children":[],"isCompleted":true,"isDroppedImmediate":false,"hasArchiveMarker":false,"hasLongMarker":false,"carryoverDays":0,"originDate":null}}`,
      "```",
    ].join("\n");
    vault.seed(pendingQueuePath(settings), queueContent);

    const res = await engine.drainPendingQueue();
    expect(res.drained).toBe(1);
    expect(res.remaining).toBe(1);
    expect(vault.peek(sep)!).toContain("9월 항목");
    // 큐에는 10월 항목만 남는다.
    const remaining = await readQueue(vault, settings);
    expect(remaining.length).toBe(1);
    expect(remaining[0].block.topText).toBe("10월 항목");
  });

  it("catchUp: 3일 놓친 상황에서 큐가 있어도 모두 시도된다", async () => {
    // 준비: 09-11(금) lastRunDate, 09-14(월) 노트 시드, today = 09-16(수)
    await withFixedToday("2026-09-16", async () => {
      const { engine, settings } = makeEngine(vault, {
        lastRunDate: "2026-09-11",
        autoRunOnLoad: true,
      });
      // 09-11 노트 시드 (source of catchUp 시작점 데이터)
      vault.seed(
        dailyNotePath(fromIsoDate("2026-09-11"), settings),
        makeDailyNoteMd({ date: "2026-09-11", activeLines: ["- [ ] 이월 항목"] }),
      );
      // 큐에 기존 항목 시드 (대상 종합이 정상이므로 곧바로 소진되어야 함)
      const summaryPath = monthlySummaryPath(fromIsoDate("2026-09-11"), settings);
      vault.seed(
        summaryPath,
        [
          "---",
          "tags: [monthly-summary, 2026-09]",
          "---",
          "",
          "# 2026-09 월간 종합",
          "",
          "## 📈 이번 달 요약",
          "- 완료: 0건",
          "",
          "## 2주차 (09-07 ~ 09-11)",
          "",
          "### ✅ 완료",
          "",
          "### ⏭️ 드롭",
          "",
          "### 📦 보관 이동",
          "",
          "## 3주차 (09-14 ~ 09-18)",
          "",
          "### ✅ 완료",
          "",
          "### ⏭️ 드롭",
          "",
          "### 📦 보관 이동",
          "",
        ].join("\n"),
      );
      const queueContent = [
        "```queue",
        `{"eventType":"completed","eventDate":"2026-09-11","targetSummaryPath":"${summaryPath}","block":{"topText":"오래된 완료","children":[],"isCompleted":true,"isDroppedImmediate":false,"hasArchiveMarker":false,"hasLongMarker":false,"carryoverDays":0,"originDate":null}}`,
        "```",
      ].join("\n");
      vault.seed(pendingQueuePath(settings), queueContent);

      await engine.catchUp();

      // 큐가 소진되어 파일이 사라졌는지
      expect(vault.exists(pendingQueuePath(settings))).toBe(false);
      // catchUp 이 목표 날짜(14, 15, 16) 노트를 생성했는지
      expect(vault.exists(dailyNotePath(fromIsoDate("2026-09-14"), settings))).toBe(true);
      expect(vault.exists(dailyNotePath(fromIsoDate("2026-09-16"), settings))).toBe(true);
      // 종합에 오래된 완료가 기록됐는지
      const summary = vault.peek(summaryPath)!;
      expect(summary).toContain("오래된 완료");
    });
  });

  it("'대기열 지금 처리' 명령 API: drainPendingQueue 결과 반환", async () => {
    const { engine, settings } = makeEngine(vault);
    // 빈 상태
    const empty = await engine.drainPendingQueue();
    expect(empty).toEqual({ drained: 0, remaining: 0 });

    // 회복 불가 항목 하나
    const queueContent = [
      "```queue",
      `{"eventType":"completed","eventDate":"2026-09-15","targetSummaryPath":"Notes/nowhere.md","block":{"topText":"X","children":[],"isCompleted":true,"isDroppedImmediate":false,"hasArchiveMarker":false,"hasLongMarker":false,"carryoverDays":0,"originDate":null}}`,
      "```",
    ].join("\n");
    vault.seed(pendingQueuePath(settings), queueContent);
    const res = await engine.drainPendingQueue();
    expect(res).toEqual({ drained: 0, remaining: 1 });
  });

  it("기존 종합 문서(변경 전 생성)는 경고 콜아웃이 추가되지 않는다", async () => {
    // 기존 파일 시드 (구 문구)
    const path = monthlySummaryPath(fromIsoDate("2026-09-15"), makeSettings());
    const oldContent = [
      "---",
      "tags: [monthly-summary, 2026-09]",
      "---",
      "",
      "# 2026-09 월간 종합",
      "",
      "> 이 문서는 스크립트가 매일 자동 갱신합니다.",
      "",
      "## 📈 이번 달 요약",
      "- 완료: 0건",
      "",
      "## 3주차 (09-14 ~ 09-18)",
      "",
      "### ✅ 완료",
      "",
      "### ⏭️ 드롭",
      "",
      "### 📦 보관 이동",
      "",
    ].join("\n");
    vault.seed(path, oldContent);

    await withFixedToday("2026-09-15", async () => {
      const { engine } = makeEngine(vault);
      await engine.createForToday();
      const after = vault.peek(path)!;
      // 원본 문구는 유지되며 경고 콜아웃이 새로 삽입되지 않는다.
      expect(after).toContain("이 문서는 스크립트가 매일 자동 갱신합니다.");
      expect(after).not.toContain("[!warning]");
    });
  });

  it("새로 만들어지는 종합 문서에는 경고 콜아웃이 포함된다", async () => {
    await withFixedToday("2026-09-15", async () => {
      const { engine, settings } = makeEngine(vault);
      await engine.createForToday();
      const path = monthlySummaryPath(fromIsoDate("2026-09-14"), settings);
      const md = vault.peek(path)!;
      expect(md).toContain("[!warning] 이 문서는 플러그인이 자동으로 관리합니다");
      expect(md).toContain("직접 편집하면 구조가 깨져");
    });
  });
});
