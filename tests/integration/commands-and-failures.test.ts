/**
 * 커버리지에서 비어 있던 사용자 기능·실패 경로.
 * - 미리보기(dryRun): 결과를 정확히 보고하되 볼트는 한 글자도 바꾸지 않는다.
 * - 이번 달 종합 재계산(recomputeMonth)
 * - 종합 문서 자체를 만들 수 없을 때: 오늘 노트는 생기고, 기록은 대기열로, 보관함은 따로 쓴다.
 * - 설정 저장 실패: 노트 생성은 성공으로 끝난다.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { Engine } from "../../src/engine";
import { fromIsoDate } from "../../src/engine/dateutil";
import { archivePath, dailyNotePath, monthlySummaryPath } from "../../src/engine/paths";
import { enqueue, pendingQueuePath, readQueue } from "../../src/engine/writers/pendingQueue";
import { makeBlock } from "../../src/engine/types";
import { InMemoryVault } from "../helpers/inMemoryVault";
import { makeDailyNoteMd, makeSettings } from "../helpers/fixtures";
import { withFixedToday } from "../helpers/fixedDate";

function snapshot(vault: InMemoryVault): Record<string, string> {
  return Object.fromEntries(vault.list().map((p) => [p, vault.peek(p)!]));
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("미리보기 (dryRun)", () => {
  it("이월·완료·드롭·보관 대상을 정확히 보고하고 볼트는 바꾸지 않는다", async () => {
    const vault = new InMemoryVault();
    const settings = makeSettings({});
    vault.seed(
      dailyNotePath(fromIsoDate("2026-09-17"), settings),
      makeDailyNoteMd({
        date: "2026-09-17",
        activeLines: ["- [ ] 이월될 일", "- [x] 끝낸 일", "- [-] 버릴 일", "- [ ] 미룰 일 #보관"],
        carryoverLines: ["- [ ] 오래된 일 (⏰ 4일째 이월, 09-11~) (🔴 드롭 예정입니다)"],
      }),
    );
    // 처리 가능한 항목이 대기열에 있어도 미리보기는 건드리지 않아야 한다.
    await enqueue(
      {
        target: "summary",
        eventType: "completed",
        eventDate: "2026-09-16",
        targetPath: monthlySummaryPath(fromIsoDate("2026-09-16"), settings),
        block: makeBlock({ topText: "대기 중인 완료" }),
        occurrence: 1,
      },
      vault,
      settings,
    );
    const before = snapshot(vault);

    const report = await withFixedToday("2026-09-18", () =>
      new Engine(vault, settings, async () => {}).dryRun(),
    );

    expect(report.targetDate).toBe("2026-09-18");
    expect(report.carriedOver).toEqual(["이월될 일 (1일째)"]);
    expect(report.toComplete).toEqual(["끝낸 일"]);
    expect(report.toDrop.sort()).toEqual(["버릴 일", "오래된 일"]);
    expect(report.toArchive).toEqual(["미룰 일 #보관"]);
    expect(report.summary).toBe("[dry-run] 2026-09-18 — 이월 1 · 완료 1 · 드롭 2 · 보관 1");
    expect(snapshot(vault)).toEqual(before);
    expect(settings.lastRunDate).toBeNull();
  });
});

describe("이번 달 종합 재계산 (recomputeMonth)", () => {
  it("사용자가 종합 문서에 기록 줄을 직접 지워도 요약 숫자를 다시 맞춘다", async () => {
    const vault = new InMemoryVault();
    const settings = makeSettings({});
    vault.seed(
      dailyNotePath(fromIsoDate("2026-09-17"), settings),
      makeDailyNoteMd({ date: "2026-09-17", activeLines: ["- [x] 하나", "- [x] 둘"] }),
    );
    const engine = new Engine(vault, settings, async () => {});
    await withFixedToday("2026-09-18", () => engine.createForToday());
    const sumPath = monthlySummaryPath(fromIsoDate("2026-09-17"), settings);
    expect(vault.peek(sumPath)!).toContain("- 완료: 2건");

    vault.seed(sumPath, vault.peek(sumPath)!.replace(/^- 09-17 둘 .*\n/m, ""));
    await engine.recomputeMonth("2026-09");

    expect(vault.peek(sumPath)!).toContain("- 완료: 1건");
  });
});

describe("실패 경로", () => {
  it("종합 문서를 만들 수 없을 때: 오늘 노트는 생기고, 종합 기록은 대기열로, 보관함은 따로 쓴다", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const vault = new InMemoryVault();
    const settings = makeSettings({});
    const sumPath = monthlySummaryPath(fromIsoDate("2026-09-17"), settings);
    vault.seed(
      dailyNotePath(fromIsoDate("2026-09-17"), settings),
      makeDailyNoteMd({ date: "2026-09-17", activeLines: ["- [x] 끝낸 일", "- [ ] 미룰 일 #보관"] }),
    );
    const write = vault.write.bind(vault);
    let blocked = true;
    vault.write = async (p: string, c: string) => {
      if (p === sumPath && blocked) throw new Error("disk full");
      return write(p, c);
    };

    await withFixedToday("2026-09-18", () => new Engine(vault, settings, async () => {}).createForToday());

    expect(vault.exists(dailyNotePath(fromIsoDate("2026-09-18"), settings))).toBe(true);
    expect(vault.peek(archivePath(settings))!).toContain("- [ ] 미룰 일 #보관 (보관: 09-17)");
    const queue = await readQueue(vault, settings);
    expect(queue.map((e) => [e.target, e.eventType, e.block.topText])).toEqual([
      ["summary", "completed", "끝낸 일"],
      ["summary", "archived", "미룰 일 #보관"],
    ]);

    // 복구 후 바로 다음 실행에서 종합 문서가 새로 생기고 대기열이 비어야 한다.
    blocked = false;
    await withFixedToday("2026-09-21", () => new Engine(vault, settings, async () => {}).createForToday());
    expect(vault.exists(pendingQueuePath(settings))).toBe(false);
    const sum = vault.peek(sumPath)!;
    expect(sum).toContain("- 09-17 끝낸 일 (당일)");
    expect(sum).toContain("- 09-17 미룰 일 #보관");
  });

  it("설정 저장이 실패해도 노트 생성은 성공으로 끝난다", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const vault = new InMemoryVault();
    const settings = makeSettings({});
    const engine = new Engine(vault, settings, async () => {
      throw new Error("settings write failed");
    });
    const res = await withFixedToday("2026-09-18", () => engine.createForToday());
    expect(res.status).toBe("created");
    expect(settings.lastRunDate).toBe("2026-09-18");
  });
});

describe("엔진 잠금 — 실패 뒤 복구", () => {
  it("한 번 실패해도 같은 엔진의 다음 실행은 막히지 않고 정상 처리된다", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const vault = new InMemoryVault();
    const settings = makeSettings();
    vault.seed(
      dailyNotePath(fromIsoDate("2026-09-17"), settings),
      makeDailyNoteMd({ date: "2026-09-17", activeLines: ["- [x] 끝낸 일"] }),
    );
    const todayPath = dailyNotePath(fromIsoDate("2026-09-18"), settings);
    const write = vault.write.bind(vault);
    let blocked = true;
    vault.write = async (p: string, c: string) => {
      if (p === todayPath && blocked) throw new Error("disk busy");
      return write(p, c);
    };
    const engine = new Engine(vault, settings, async () => {});

    await expect(withFixedToday("2026-09-18", () => engine.createForToday())).rejects.toThrow("disk busy");
    expect(settings.lastRunDate).toBeNull();

    blocked = false;
    const res = await withFixedToday("2026-09-18", () => engine.createForToday());
    expect(res.status).toBe("created");
    expect(settings.lastRunDate).toBe("2026-09-18");
    const sum = vault.peek(monthlySummaryPath(fromIsoDate("2026-09-17"), settings))!;
    expect(sum.split("\n").filter((l) => l.includes("끝낸 일"))).toHaveLength(1);
  });
});

describe("오늘 노트가 이미 있을 때도 대기열은 재시도", () => {
  it("직접 만든 오늘 노트가 있어도 대기열을 처리하고 요약 숫자도 맞춘다", async () => {
    const vault = new InMemoryVault();
    const settings = makeSettings();
    vault.seed(dailyNotePath(fromIsoDate("2026-09-18"), settings), "사용자가 직접 만든 노트");
    await enqueue(
      {
        target: "summary",
        eventType: "completed",
        eventDate: "2026-09-17",
        targetPath: monthlySummaryPath(fromIsoDate("2026-09-17"), settings),
        block: makeBlock({ topText: "밀린 완료" }),
        occurrence: 1,
      },
      vault,
      settings,
    );
    const res = await withFixedToday("2026-09-18", () => new Engine(vault, settings, async () => {}).createForToday());
    expect(res.status).toBe("skipped_exists");
    expect(vault.exists(pendingQueuePath(settings))).toBe(false);
    const sum = vault.peek(monthlySummaryPath(fromIsoDate("2026-09-17"), settings))!;
    expect(sum).toContain("- 09-17 밀린 완료 (당일)");
    expect(sum).toContain("- 완료: 1건");
  });
});

