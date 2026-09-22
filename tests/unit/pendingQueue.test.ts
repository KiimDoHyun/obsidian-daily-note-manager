/**
 * pendingQueue 모듈의 순수 함수/직렬화 검증.
 * 통합 시나리오는 tests/integration/pending-queue.test.ts 에서 다룬다.
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  drainQueue,
  enqueue,
  parseQueueFile,
  pendingQueuePath,
  readQueue,
  writeQueue,
  type PendingEntry,
} from "../../src/engine/writers/pendingQueue";
import { fromIsoDate } from "../../src/engine/dateutil";
import { makeBlock, type TaskBlock } from "../../src/engine/types";
import { InMemoryVault } from "../helpers/inMemoryVault";
import { makeSettings } from "../helpers/fixtures";

function block(topText: string, overrides: Partial<TaskBlock> = {}): TaskBlock {
  return makeBlock({ topText, ...overrides });
}

function entry(overrides: Partial<PendingEntry> = {}): PendingEntry {
  return {
    eventType: "completed",
    eventDate: "2026-09-15",
    targetSummaryPath: "Notes/2026-09/2026-09 종합.md",
    block: block("샘플 할일"),
    ...overrides,
  };
}

describe("pendingQueue — 경로", () => {
  it("설정의 notesSubdir 기준으로 파일 경로를 만든다", () => {
    const s = makeSettings({ notesSubdir: "Notes" });
    expect(pendingQueuePath(s)).toBe("Notes/_대기 완료 로그.md");
  });

  it("커스텀 notesSubdir 반영", () => {
    const s = makeSettings({ notesSubdir: "Journal" });
    expect(pendingQueuePath(s)).toBe("Journal/_대기 완료 로그.md");
  });
});

describe("pendingQueue — readQueue", () => {
  let vault: InMemoryVault;
  const settings = makeSettings();
  beforeEach(() => {
    vault = new InMemoryVault();
  });

  it("파일이 없으면 빈 배열", async () => {
    const res = await readQueue(vault, settings);
    expect(res).toEqual([]);
  });

  it("빈 파일이면 빈 배열", async () => {
    vault.seed(pendingQueuePath(settings), "");
    const res = await readQueue(vault, settings);
    expect(res).toEqual([]);
  });

  it("깨진 JSON 라인은 무시", async () => {
    vault.seed(
      pendingQueuePath(settings),
      "# 대기 완료 로그\n\n## 재시도 데이터\n\n```queue\n{ this is not json\n{\"eventType\":\"completed\",\"eventDate\":\"2026-09-15\",\"targetSummaryPath\":\"a.md\",\"block\":{\"topText\":\"OK\",\"children\":[],\"isCompleted\":true,\"isDroppedImmediate\":false,\"hasArchiveMarker\":false,\"hasLongMarker\":false,\"carryoverDays\":0,\"originDate\":null}}\n```\n",
    );
    const res = await readQueue(vault, settings);
    expect(res.length).toBe(1);
    expect(res[0].block.topText).toBe("OK");
  });
});

describe("pendingQueue — writeQueue", () => {
  let vault: InMemoryVault;
  const settings = makeSettings();
  beforeEach(() => {
    vault = new InMemoryVault();
  });

  it("빈 배열이면 파일을 지운다", async () => {
    vault.seed(pendingQueuePath(settings), "seeded content");
    await writeQueue([], vault, settings);
    expect(vault.exists(pendingQueuePath(settings))).toBe(false);
  });

  it("빈 배열이고 파일이 원래 없어도 안전", async () => {
    await expect(writeQueue([], vault, settings)).resolves.toBeUndefined();
    expect(vault.exists(pendingQueuePath(settings))).toBe(false);
  });

  it("항목을 쓰고 다시 읽으면 왕복 일치 (단일 항목)", async () => {
    const e = entry({ block: block("한글 항목", { carryoverDays: 3, originDate: fromIsoDate("2026-09-10") }) });
    await writeQueue([e], vault, settings);
    const back = await readQueue(vault, settings);
    expect(back.length).toBe(1);
    expect(back[0].eventType).toBe("completed");
    expect(back[0].eventDate).toBe("2026-09-15");
    expect(back[0].block.topText).toBe("한글 항목");
    expect(back[0].block.carryoverDays).toBe(3);
    expect(back[0].block.originDate?.getTime()).toBe(fromIsoDate("2026-09-10").getTime());
  });

  it("여러 항목 왕복 유지 (완료/드롭/보관 섞임)", async () => {
    const entries: PendingEntry[] = [
      entry({ eventType: "completed", block: block("완료 1") }),
      entry({ eventType: "dropped", eventDate: "2026-09-16", block: block("드롭 1", { carryoverDays: 6 }) }),
      entry({ eventType: "archived", eventDate: "2026-09-17", block: block("보관 1", { hasArchiveMarker: true }) }),
    ];
    await writeQueue(entries, vault, settings);
    const back = await readQueue(vault, settings);
    expect(back.length).toBe(3);
    expect(back.map((e) => e.eventType)).toEqual(["completed", "dropped", "archived"]);
    expect(back[1].block.carryoverDays).toBe(6);
    expect(back[2].block.hasArchiveMarker).toBe(true);
  });

  it("하위 항목·메모(children) 를 보존", async () => {
    const e = entry({
      block: block("부모", { children: ["  - 하위1", "  - 하위2", "    메모 라인"] }),
    });
    await writeQueue([e], vault, settings);
    const back = await readQueue(vault, settings);
    expect(back[0].block.children).toEqual(["  - 하위1", "  - 하위2", "    메모 라인"]);
  });

  it("파일 본문에 경고 콜아웃과 대상 경로 요약이 포함된다", async () => {
    await writeQueue([entry()], vault, settings);
    const raw = vault.peek(pendingQueuePath(settings))!;
    expect(raw).toContain("[!warning]");
    expect(raw).toContain("Notes/2026-09/2026-09 종합.md");
    expect(raw).toContain("2026-09-15");
  });
});

describe("pendingQueue — enqueue", () => {
  let vault: InMemoryVault;
  const settings = makeSettings();
  beforeEach(() => {
    vault = new InMemoryVault();
  });

  it("파일이 없을 때 처음 enqueue 하면 파일이 생기고 1건 저장", async () => {
    await enqueue(entry(), vault, settings);
    expect(vault.exists(pendingQueuePath(settings))).toBe(true);
    const back = await readQueue(vault, settings);
    expect(back.length).toBe(1);
  });

  it("이미 항목이 있을 때 enqueue 하면 뒤에 추가", async () => {
    await enqueue(entry({ block: block("첫 번째") }), vault, settings);
    await enqueue(entry({ block: block("두 번째") }), vault, settings);
    const back = await readQueue(vault, settings);
    expect(back.map((e) => e.block.topText)).toEqual(["첫 번째", "두 번째"]);
  });

  it("서로 다른 달의 항목을 동시에 유지", async () => {
    await enqueue(
      entry({
        eventDate: "2026-09-30",
        targetSummaryPath: "Notes/2026-09/2026-09 종합.md",
        block: block("9월 항목"),
      }),
      vault,
      settings,
    );
    await enqueue(
      entry({
        eventDate: "2026-10-01",
        targetSummaryPath: "Notes/2026-10/2026-10 종합.md",
        block: block("10월 항목"),
      }),
      vault,
      settings,
    );
    const back = await readQueue(vault, settings);
    expect(back.length).toBe(2);
    expect(back[0].targetSummaryPath).toContain("2026-09");
    expect(back[1].targetSummaryPath).toContain("2026-10");
  });
});

describe("pendingQueue — drainQueue", () => {
  let vault: InMemoryVault;
  const settings = makeSettings();
  beforeEach(() => {
    vault = new InMemoryVault();
  });

  it("큐가 비어있으면 drained=0, remaining=0", async () => {
    const res = await drainQueue(vault, settings);
    expect(res).toEqual({ drained: 0, remaining: 0 });
  });

  it("대상 종합 문서가 정상이면 항목이 소진되고 큐 파일이 사라진다", async () => {
    // 정상 종합 시드
    const summaryPath = "Notes/2026-09/2026-09 종합.md";
    const summary = [
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
    ].join("\n");
    vault.seed(summaryPath, summary);
    await enqueue(entry({ targetSummaryPath: summaryPath }), vault, settings);
    const res = await drainQueue(vault, settings);
    expect(res.drained).toBe(1);
    expect(res.remaining).toBe(0);
    expect(vault.exists(pendingQueuePath(settings))).toBe(false);
    const written = vault.peek(summaryPath)!;
    expect(written).toContain("샘플 할일");
  });

  it("대상 종합 문서가 없거나 깨져 있으면 항목이 큐에 남는다", async () => {
    await enqueue(entry({ targetSummaryPath: "Notes/nowhere.md" }), vault, settings);
    const res = await drainQueue(vault, settings);
    expect(res.drained).toBe(0);
    expect(res.remaining).toBe(1);
    expect(vault.exists(pendingQueuePath(settings))).toBe(true);
  });
});

describe("pendingQueue — parseQueueFile 직접", () => {
  it("코드펜스 밖 라인은 파싱하지 않는다", () => {
    const md = [
      "# 대기 완료 로그",
      "- [2026-09-15] 완료 — 샘플 → `Notes/x.md`",
      "",
      "```queue",
      `{"eventType":"completed","eventDate":"2026-09-15","targetSummaryPath":"Notes/x.md","block":{"topText":"샘플","children":[],"isCompleted":true,"isDroppedImmediate":false,"hasArchiveMarker":false,"hasLongMarker":false,"carryoverDays":0,"originDate":null}}`,
      "```",
    ].join("\n");
    const res = parseQueueFile(md);
    expect(res.length).toBe(1);
    expect(res[0].block.topText).toBe("샘플");
  });

  it("잘못된 eventType 은 걸러낸다", () => {
    const md = [
      "```queue",
      `{"eventType":"unknown","eventDate":"2026-09-15","targetSummaryPath":"x","block":{"topText":"a","children":[],"isCompleted":false,"isDroppedImmediate":false,"hasArchiveMarker":false,"hasLongMarker":false,"carryoverDays":0,"originDate":null}}`,
      "```",
    ].join("\n");
    expect(parseQueueFile(md)).toEqual([]);
  });

  it("잘못된 날짜 형식은 걸러낸다", () => {
    const md = [
      "```queue",
      `{"eventType":"completed","eventDate":"2026/09/15","targetSummaryPath":"x","block":{"topText":"a","children":[],"isCompleted":false,"isDroppedImmediate":false,"hasArchiveMarker":false,"hasLongMarker":false,"carryoverDays":0,"originDate":null}}`,
      "```",
    ].join("\n");
    expect(parseQueueFile(md)).toEqual([]);
  });
});
