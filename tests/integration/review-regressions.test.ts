/**
 * 독립 리뷰에서 찾은 버그의 회귀 테스트.
 * ① 부재 후 같은 날 강제 재생성 시 이어받은 항목 유실
 * ② 주말 제외를 끄면 월요일에 일요일 노트를 건너뜀
 * ③ 강제 생성 날짜가 마지막 실행일을 미래·과거로 옮김 (+ 마지막 실행일이 미래로 동기화된 경우)
 * ④ 같은 날 이름이 같은 서로 다른 항목이 기록 하나로 합쳐짐
 * ⑤ 대기열로 다른 달 문서에 쓴 기록이 그 달 요약 숫자에 반영되지 않음
 */
import { describe, it, expect } from "vitest";
import { Engine } from "../../src/engine";
import { fromIsoDate } from "../../src/engine/dateutil";
import { archivePath, dailyNotePath, monthlyDropPath, monthlySummaryPath } from "../../src/engine/paths";
import { enqueue, pendingQueuePath } from "../../src/engine/writers/pendingQueue";
import { makeBlock } from "../../src/engine/types";
import { InMemoryVault } from "../helpers/inMemoryVault";
import { carriedNames, makeDailyNoteMd, makeSettings } from "../helpers/fixtures";
import { withFixedToday } from "../helpers/fixedDate";
import type { DailyNoteSettings } from "../../src/settings";

function setup(overrides: Partial<DailyNoteSettings> = {}) {
  const vault = new InMemoryVault();
  const settings = makeSettings(overrides);
  const engine = new Engine(vault, settings, async () => {});
  const seed = (iso: string, note: { activeLines?: string[]; carryoverLines?: string[] }) =>
    vault.seed(dailyNotePath(fromIsoDate(iso), settings), makeDailyNoteMd({ date: iso, ...note }));
  const note = (iso: string) => vault.peek(dailyNotePath(fromIsoDate(iso), settings)) ?? "";
  const lines = (path: string, needle: string) =>
    (vault.peek(path) ?? "").split("\n").filter((l) => l.includes(needle));
  return { vault, settings, engine, seed, note, lines };
}

describe("① 부재 후 같은 날 강제 재생성", () => {
  it("5월 29일 → 9월 1일 복귀 후 오늘을 강제 재생성해도 #장기 항목을 그대로 이어받는다", async () => {
    const t = setup({ lastRunDate: "2026-05-29" });
    t.seed("2026-05-29", { activeLines: ["- [ ] 긴 일 #장기"] });
    await withFixedToday("2026-09-01", () => t.engine.createForToday());
    expect(t.note("2026-09-01")).toContain("- [ ] 긴 일 #장기 (⏰ 67일째 이월, 05-29~)");

    await withFixedToday("2026-09-01", () => t.engine.forceDate(fromIsoDate("2026-09-01")));
    expect(t.note("2026-09-01")).toContain("- [ ] 긴 일 #장기 (⏰ 67일째 이월, 05-29~)");
  });

  it("마지막 실행일 노트가 지워졌어도 그보다 오래된 노트를 찾아 이어받는다 (14일 이내)", async () => {
    // 09-14 노트 → 09-18 은 평일 4일 뒤라 드롭 기준(5) 전.
    const t = setup({ lastRunDate: "2026-09-16" });
    t.seed("2026-09-14", { activeLines: ["- [ ] 오래된 노트 일"] });
    await withFixedToday("2026-09-18", () => t.engine.createForToday());
    expect(carriedNames(t.note("2026-09-18"), "2026-09-18")).toContain("오래된 노트 일");
  });

  it("마지막 실행일 노트가 지워졌어도 그보다 훨씬 오래된 노트를 찾아 이어받는다 (한 달 전)", async () => {
    const t = setup({ lastRunDate: "2026-09-15" });
    t.seed("2026-08-14", { activeLines: ["- [ ] 한 달 전 일 #장기"] });
    await withFixedToday("2026-09-18", () => t.engine.createForToday());
    expect(carriedNames(t.note("2026-09-18"), "2026-09-18")).toContain("한 달 전 일 #장기");
  });

  it("첫 실행(마지막 실행일 없음)은 여전히 최근 14일까지만 본다", async () => {
    const t = setup({ lastRunDate: null });
    t.seed("2026-08-14", { activeLines: ["- [ ] 아주 옛날 일"] });
    await withFixedToday("2026-09-18", () => t.engine.createForToday());
    expect(carriedNames(t.note("2026-09-18"), "2026-09-18")).not.toContain("아주 옛날 일");
  });
});

describe("② 주말 제외를 끈 경우의 이전 노트", () => {
  it("월요일에 금요일이 아니라 일요일 노트를 이어받는다", async () => {
    const t = setup({ skipWeekend: false, lastRunDate: "2026-09-27" });
    t.seed("2026-09-25", { activeLines: ["- [ ] 금요일 일"] });
    t.seed("2026-09-27", {
      activeLines: ["- [ ] 일요일 새 일", "- [x] 일요일 완료"],
      carryoverLines: ["- [x] 금요일 일 (⏰ 2일째 이월, 09-25~)"],
    });
    await withFixedToday("2026-09-28", () => t.engine.createForToday());

    const names = carriedNames(t.note("2026-09-28"), "2026-09-28");
    expect(names).toContain("일요일 새 일");
    expect(names).not.toContain("금요일 일");
    const sum = monthlySummaryPath(fromIsoDate("2026-09-27"), t.settings);
    expect(t.lines(sum, "일요일 완료")).toHaveLength(1);
    expect(t.lines(sum, "금요일 일")).toHaveLength(1);
  });
});

describe("③ 마지막 실행일은 실제 오늘을 넘지 않고, 뒤로 가지도 않는다", () => {
  it("미래 날짜(12-31)로 강제 생성해도 마지막 실행일은 실제 오늘에 머문다", async () => {
    const t = setup({ lastRunDate: "2026-09-30" });
    await withFixedToday("2026-10-01", () => t.engine.createForToday());
    await withFixedToday("2026-10-01", () => t.engine.forceDate(fromIsoDate("2026-12-31")));
    expect(t.settings.lastRunDate).toBe("2026-10-01");
  });

  it("과거 날짜로 강제 생성해도 마지막 실행일이 뒤로 가지 않는다", async () => {
    const t = setup({ lastRunDate: "2026-09-30" });
    await withFixedToday("2026-10-01", () => t.engine.createForToday());
    await withFixedToday("2026-10-01", () => t.engine.forceDate(fromIsoDate("2026-09-15")));
    expect(t.settings.lastRunDate).toBe("2026-10-01");
  });

  it("마지막 실행일이 미래로 동기화돼 있어도 오늘 노트는 만들고, 마지막 실행일을 오늘로 바로잡는다", async () => {
    const t = setup({ lastRunDate: "2026-12-31" });
    t.seed("2026-09-30", { activeLines: ["- [ ] 어제 일"] });
    const res = await withFixedToday("2026-10-01", () => t.engine.createForToday());
    expect(res.status).toBe("created");
    expect(t.note("2026-10-01")).toContain("- [ ] 어제 일 (⏰ 1일째 이월, 09-30~)");
    expect(t.settings.lastRunDate).toBe("2026-10-01");
  });
});

describe("④ 같은 날 이름이 같은 서로 다른 항목", () => {
  it("완료 두 건은 종합에 두 줄, 요약 2건으로 남는다", async () => {
    const t = setup();
    t.seed("2026-09-17", { activeLines: ["- [x] 회의록 작성", "- [x] 회의록 작성"] });
    await withFixedToday("2026-09-18", () => t.engine.createForToday());
    const sum = monthlySummaryPath(fromIsoDate("2026-09-17"), t.settings);
    expect(t.lines(sum, "회의록 작성")).toHaveLength(2);
    expect(t.vault.peek(sum)!).toContain("- 완료: 2건");
  });

  it("드롭 두 건은 하위 메모까지 각각 드롭 문서에 남고, 다시 실행해도 늘지 않는다", async () => {
    const t = setup();
    t.seed("2026-09-17", { activeLines: ["- [-] 같은 이름", "\t- 첫째 메모", "- [-] 같은 이름", "\t- 둘째 메모"] });
    await withFixedToday("2026-09-18", () => t.engine.createForToday());
    await withFixedToday("2026-09-18", () => t.engine.forceDate(fromIsoDate("2026-09-18")));
    const drop = monthlyDropPath(fromIsoDate("2026-09-17"), t.settings);
    expect(t.lines(drop, "- [-] 같은 이름")).toHaveLength(2);
    expect(t.lines(drop, "첫째 메모")).toHaveLength(1);
    expect(t.lines(drop, "둘째 메모")).toHaveLength(1);
    expect(t.lines(monthlySummaryPath(fromIsoDate("2026-09-17"), t.settings), "같은 이름")).toHaveLength(2);
  });

  it("보관 두 건도 각각 남고, 다시 실행해도 늘지 않는다", async () => {
    const t = setup();
    t.seed("2026-09-17", { activeLines: ["- [ ] 같은 보관 #보관", "- [ ] 같은 보관 #보관"] });
    await withFixedToday("2026-09-18", () => t.engine.createForToday());
    await withFixedToday("2026-09-18", () => t.engine.forceDate(fromIsoDate("2026-09-18")));
    expect(t.lines(archivePath(t.settings), "- [ ] 같은 보관")).toHaveLength(2);
  });
});

describe("⑤ 대기열로 다른 달에 쓴 기록의 요약 숫자", () => {
  const julyEntry = (settings: DailyNoteSettings) => ({
    eventType: "completed" as const,
    eventDate: "2026-07-15",
    target: "summary" as const,
    targetPath: monthlySummaryPath(fromIsoDate("2026-07-15"), settings),
    block: makeBlock({ topText: "7월 일", isCompleted: true }),
    occurrence: 1,
  });

  it("오늘 노트를 만들 때 대기열이 7월 문서에 기록하면 7월 요약 숫자도 다시 센다", async () => {
    const t = setup();
    await enqueue(julyEntry(t.settings), t.vault, t.settings);
    await withFixedToday("2026-10-01", () => t.engine.createForToday());
    expect(t.vault.exists(pendingQueuePath(t.settings))).toBe(false);
    expect(t.vault.peek(monthlySummaryPath(fromIsoDate("2026-07-15"), t.settings))!).toContain("- 완료: 1건");
  });

  it("'대기열 지금 처리' 명령도 기록한 달의 요약 숫자를 다시 센다", async () => {
    const t = setup();
    await enqueue(julyEntry(t.settings), t.vault, t.settings);
    const res = await t.engine.drainPendingQueue();
    expect(res).toEqual({ drained: 1, remaining: 0 });
    expect(t.vault.peek(monthlySummaryPath(fromIsoDate("2026-07-15"), t.settings))!).toContain("- 완료: 1건");
  });
});
