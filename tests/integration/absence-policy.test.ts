/**
 * 부재(휴가·장기 미사용) 후 복귀 정책.
 *
 * 규칙:
 *   - 며칠을 비웠든 **오늘 노트 하나만** 만든다. 그 사이 날짜의 노트는 만들지 않는다.
 *   - 이월 일수·드롭은 "그 사이 영업일마다 노트가 있었던 것처럼" 계산한다.
 *     (주말 제외 설정이면 영업일만, 아니면 달력 날짜를 센다.)
 *   - 드롭 기록 날짜·월은 매일 노트를 만들었을 때와 똑같이 잡는다
 *     (드롭되기 직전, 마지막으로 노트에 남아 있었을 날짜).
 *   - 마지막 노트는 얼마나 오래됐든 반드시 이어받는다.
 *
 * 날짜를 고정해 흉내 내므로 실제로 휴가를 쓰거나 몇 달을 기다릴 필요가 없다.
 */
import { describe, it, expect } from "vitest";
import { Engine } from "../../src/engine";
import { collectTimelineItems } from "../../src/engine/writers/timeline";
import { toIsoDate } from "../../src/engine/dateutil";
import { fromIsoDate } from "../../src/engine/dateutil";
import { dailyNotePath, monthlyDropPath, monthlySummaryPath } from "../../src/engine/paths";
import { InMemoryVault } from "../helpers/inMemoryVault";
import { carriedNames, makeDailyNoteMd, makeSettings } from "../helpers/fixtures";
import type { DailyNoteSettings } from "../../src/settings";
import { withFixedToday } from "../helpers/fixedDate";

async function returnAfterAbsence(
  lastIso: string,
  todayIso: string,
  note: { activeLines?: string[]; carryoverLines?: string[] },
  overrides: Partial<DailyNoteSettings> = {},
) {
  const vault = new InMemoryVault();
  const settings = makeSettings({ lastRunDate: lastIso, ...overrides });
  vault.seed(dailyNotePath(fromIsoDate(lastIso), settings), makeDailyNoteMd({ date: lastIso, ...note }));
  await withFixedToday(todayIso, async () => {
    await new Engine(vault, settings, async () => {}).createForToday();
  });
  const notes = vault.list().filter((p) => p.includes("📅")).map((p) => p.slice(-13, -3));
  const peek = (p: string) => vault.peek(p) ?? "";
  return {
    vault,
    settings,
    notes,
    today: peek(dailyNotePath(fromIsoDate(todayIso), settings)),
    summaryOf: (iso: string) => peek(monthlySummaryPath(fromIsoDate(iso), settings)),
    dropOf: (iso: string) => peek(monthlyDropPath(fromIsoDate(iso), settings)),
  };
}

describe("부재 후 복귀 — 오늘 노트만 만든다", () => {
  it("5월 13일 → 9월 1일: 그 사이 노트는 하나도 없고 오늘 노트만 생긴다", async () => {
    const r = await returnAfterAbsence("2026-05-13", "2026-09-01", {
      activeLines: ["- [ ] 일반 업무", "- [ ] 긴 업무 #장기", "- [x] 떠나기 전 끝낸 일"],
    });
    expect(r.notes).toEqual(["2026-05-13", "2026-09-01"]);
    expect(r.settings.lastRunDate).toBe("2026-09-01");
  });

  it("5월 13일 → 9월 1일: 그 사이 드롭은 매일 노트가 있던 것처럼 5월에 계산된다", async () => {
    const r = await returnAfterAbsence("2026-05-13", "2026-09-01", {
      activeLines: ["- [ ] 일반 업무", "- [ ] 긴 업무 #장기", "- [x] 떠나기 전 끝낸 일"],
    });
    // 일반 업무: 05-14(1) 15(2) 18(3) 19(4) → 20일에 5일째 → 드롭. 기록 날짜는 19일.
    expect(carriedNames(r.today).some((n) => n.includes("일반 업무"))).toBe(false);
    expect(r.dropOf("2026-05-19")).toContain("- [-] 일반 업무 (05-13 시작, 05-19 드롭, 5영업일 이월)");
    const may = r.summaryOf("2026-05-19");
    expect(may).toContain("- 05-19 일반 업무 (05-13 시작, 5영업일 이월 후 드롭)");
    // 떠나기 전 체크한 완료는 5월 13일로 기록.
    expect(may).toContain("- 05-13 떠나기 전 끝낸 일 (당일)");
    expect(may).toContain("- 완료: 1건");
    expect(may).toContain("- 드롭: 1건");
    // 6·7·8월에는 아무 일도 없었다.
    expect(r.vault.exists(monthlySummaryPath(fromIsoDate("2026-07-01"), r.settings))).toBe(false);
  });

  it("5월 13일 → 9월 1일: #장기 업무는 그 사이 영업일 수(79일)만큼 이월 일수가 쌓여 오늘로 넘어온다", async () => {
    const r = await returnAfterAbsence("2026-05-13", "2026-09-01", {
      activeLines: ["- [ ] 긴 업무 #장기"],
    });
    expect(r.today).toContain("- [ ] 긴 업무 #장기 (⏰ 79일째 이월, 05-13~)");
  });

  it("1주 휴가(금 → 다음다음 월): 오늘 노트만 생기고, 일반 업무는 휴가 중 날짜로 드롭된다", async () => {
    const r = await returnAfterAbsence("2026-09-11", "2026-09-21", {
      activeLines: ["- [ ] 일반 업무", "- [ ] 긴 업무 #장기"],
    });
    expect(r.notes).toEqual(["2026-09-11", "2026-09-21"]);
    expect(carriedNames(r.today).some((n) => n.includes("일반 업무"))).toBe(false);
    expect(r.dropOf("2026-09-17")).toContain("- [-] 일반 업무 (09-11 시작, 09-17 드롭, 5영업일 이월)");
    expect(r.today).toContain("- [ ] 긴 업무 #장기 (⏰ 6일째 이월, 09-11~)");
  });

  it("짧은 부재(화 → 금, 3영업일): 오늘 노트만 생기고 3일째 + 🟠 경고", async () => {
    const r = await returnAfterAbsence("2026-09-15", "2026-09-18", { activeLines: ["- [ ] task A"] });
    expect(r.notes).toEqual(["2026-09-15", "2026-09-18"]);
    expect(r.today).toMatch(/^- \[ \] task A \(⏰ 3일째 이월, 09-15~\) \(🟠 드롭 예정입니다\)$/m);
  });

  it("이미 이월 중이던 항목은 기존 일수에 이어서 센다 (2일째 → 영업일 2일 뒤 4일째 🔴)", async () => {
    const r = await returnAfterAbsence("2026-09-15", "2026-09-17", {
      carryoverLines: ["- [ ] 이어지는 일 (⏰ 2일째 이월, 09-11~)"],
    });
    expect(r.today).toContain("- [ ] 이어지는 일 (⏰ 4일째 이월, 09-11~) (🔴 드롭 예정입니다)");
  });

  it("skipWeekend=true: 주말은 세지 않는다 (목 → 화 = 금·월·화 3일)", async () => {
    const r = await returnAfterAbsence("2026-09-17", "2026-09-22", { activeLines: ["- [ ] task"] });
    expect(r.notes).toEqual(["2026-09-17", "2026-09-22"]);
    expect(r.today).toContain("- [ ] task (⏰ 3일째 이월, 09-17~)");
  });

  it("skipWeekend=false: 주말도 센다 (목 → 화 = 5일 → 드롭, 기록은 월요일)", async () => {
    const r = await returnAfterAbsence(
      "2026-09-17",
      "2026-09-22",
      { activeLines: ["- [ ] task"] },
      { skipWeekend: false },
    );
    expect(r.notes).toEqual(["2026-09-17", "2026-09-22"]);
    expect(r.today).not.toContain("- [ ] task");
    expect(r.dropOf("2026-09-21")).toContain("- [-] task (09-17 시작, 09-21 드롭, 5영업일 이월)");
  });

  it("월 경계: 지난달 완료는 지난달 종합, 이월은 이번 달 오늘 노트로", async () => {
    // 09-29(화) → 10-02(금): 09-30·10-01·10-02 = 3일
    const r = await returnAfterAbsence("2026-09-29", "2026-10-02", {
      activeLines: ["- [x] Sep task done", "- [ ] carry to Oct"],
    });
    expect(r.notes).toEqual(["2026-09-29", "2026-10-02"]);
    expect(r.summaryOf("2026-09-29")).toContain("- 09-29 Sep task done (당일)");
    expect(r.today).toContain("- [ ] carry to Oct (⏰ 3일째 이월, 09-29~)");
    expect(r.vault.exists(monthlySummaryPath(fromIsoDate("2026-10-01"), r.settings))).toBe(true);
  });

  it("드롭 시점이 다음 달로 넘어가면 다음 달 종합·드롭 문서에 기록된다", async () => {
    // 09-30(수) 3일째 → 10-01(4) → 10-02 에 5일째 → 드롭, 기록 날짜 10-01.
    const r = await returnAfterAbsence("2026-09-30", "2026-10-05", {
      carryoverLines: ["- [ ] 넘어간 일 (⏰ 3일째 이월, 09-25~)"],
    });
    expect(r.dropOf("2026-10-01")).toContain("- [-] 넘어간 일 (09-25 시작, 10-01 드롭, 5영업일 이월)");
    expect(r.summaryOf("2026-10-01")).toContain("- 10-01 넘어간 일 (09-25 시작, 5영업일 이월 후 드롭)");
    expect(r.summaryOf("2026-09-30")).not.toContain("넘어간 일");
    expect(r.vault.exists(monthlyDropPath(fromIsoDate("2026-09-30"), r.settings))).toBe(false);
  });

  it("5월 29일(금)에 등록 → 9월에 열기: 드롭은 6월에 일어나므로 6월 폴더의 드롭 문서·종합에 기록된다", async () => {
    // 06-01(1) 02(2) 03(3) 04(4) → 05일에 5일째 → 드롭, 기록 날짜 06-04.
    const r = await returnAfterAbsence("2026-05-29", "2026-09-01", { activeLines: ["- [ ] 5월 말 등록 업무"] });
    const junePath = monthlyDropPath(fromIsoDate("2026-06-04"), r.settings);
    expect(junePath).toBe("Notes/2026-06/2026-06 드롭.md");
    expect(r.dropOf("2026-06-04")).toContain("- [-] 5월 말 등록 업무 (05-29 시작, 06-04 드롭, 5영업일 이월)");
    expect(r.summaryOf("2026-06-04")).toContain("- 06-04 5월 말 등록 업무 (05-29 시작, 5영업일 이월 후 드롭)");
    expect(r.summaryOf("2026-06-04")).toContain("- 드롭: 1건");
    // 5월 문서에는 드롭이 없고, 7·8월 문서는 생기지 않는다. 노트는 5/29 와 9/1 둘뿐.
    expect(r.vault.exists(monthlyDropPath(fromIsoDate("2026-05-29"), r.settings))).toBe(false);
    expect(r.vault.exists(monthlySummaryPath(fromIsoDate("2026-07-01"), r.settings))).toBe(false);
    expect(r.vault.exists(monthlySummaryPath(fromIsoDate("2026-08-01"), r.settings))).toBe(false);
    expect(r.notes).toEqual(["2026-05-29", "2026-09-01"]);
    expect(carriedNames(r.today).some((n) => n.includes("5월 말 등록 업무"))).toBe(false);
  });

  it("어제 노트에서 이어지는 평소 하루는 기존과 똑같이 +1", async () => {
    const r = await returnAfterAbsence("2026-09-17", "2026-09-18", { activeLines: ["- [ ] task"] });
    expect(r.today).toContain("- [ ] task (⏰ 1일째 이월, 09-17~)");
  });

  it("lastRunDate 없음(첫 실행) → 오늘 노트만", async () => {
    const vault = new InMemoryVault();
    const settings = makeSettings({ lastRunDate: null });
    await withFixedToday("2026-09-15", async () => {
      await new Engine(vault, settings, async () => {}).createForToday();
    });
    expect(vault.list().filter((p) => p.includes("📅"))).toHaveLength(1);
  });
});

describe("#장기 업무 — 100일 넘는 이월", () => {
  const run = async (vault: InMemoryVault, settings: DailyNoteSettings, iso: string) =>
    withFixedToday(iso, () => new Engine(vault, settings, async () => {}).createForToday());

  it("5월 13일 → 10월 15일(111영업일): 세 자리 일수로 넘어오고, 경고 없이, 하위 메모도 유지", async () => {
    const r = await returnAfterAbsence("2026-05-13", "2026-10-15", {
      activeLines: ["- [ ] 긴 연구 #장기", "\t- 참고 링크 메모"],
    });
    const lines = r.today.split("\n");
    const i = lines.findIndex((l) => l.includes("긴 연구"));
    expect(lines[i]).toBe("- [ ] 긴 연구 #장기 (⏰ 111일째 이월, 05-13~)");
    expect(lines[i + 1]).toBe("\t- 참고 링크 메모");
  });

  it("세 자리 일수 태그를 다음 날 다시 읽어 +1 (111 → 112)", async () => {
    const r = await returnAfterAbsence("2026-05-13", "2026-10-15", { activeLines: ["- [ ] 긴 연구 #장기"] });
    await run(r.vault, r.settings, "2026-10-16");
    const next = r.vault.peek(dailyNotePath(fromIsoDate("2026-10-16"), r.settings))!;
    expect(next).toContain("- [ ] 긴 연구 #장기 (⏰ 112일째 이월, 05-13~)");
  });

  it("해를 넘겨도(5월 13일 → 다음 해 1월 5일, 169영업일) 이어지고, 완료하면 소요 일수·시작일이 맞게 기록된다", async () => {
    const r = await returnAfterAbsence("2026-05-13", "2027-01-05", { activeLines: ["- [ ] 긴 연구 #장기"] });
    const janPath = dailyNotePath(fromIsoDate("2027-01-05"), r.settings);
    expect(r.vault.peek(janPath)!).toContain("- [ ] 긴 연구 #장기 (⏰ 169일째 이월, 05-13~)");

    // 1월 5일 노트에서 체크 → 다음 날 실행 시 1월 종합에 완료 기록.
    r.vault.seed(janPath, r.vault.peek(janPath)!.replace("- [ ] 긴 연구", "- [x] 긴 연구"));
    await run(r.vault, r.settings, "2027-01-06");
    const jan = r.vault.peek(monthlySummaryPath(fromIsoDate("2027-01-05"), r.settings))!;
    expect(jan).toContain("- 01-05 긴 연구 #장기 (169영업일 소요, 05-13 시작)");
  });

  it("1년 넘게 이월된 항목도 시작일을 올바른 해로 해석한다 (타임라인 진행중 막대 시작점)", async () => {
    // 2025-09-01 시작, 2026-10-01 노트에서 283일째. 태그엔 연도가 없어 "09-01" 만 남는다.
    const vault = new InMemoryVault();
    const settings = makeSettings({ lastRunDate: "2026-10-01" });
    vault.seed(
      dailyNotePath(fromIsoDate("2026-10-01"), settings),
      makeDailyNoteMd({ date: "2026-10-01", carryoverLines: ["- [ ] 아주 긴 일 #장기 (⏰ 283일째 이월, 09-01~)"] }),
    );
    await run(vault, settings, "2026-10-02");
    const today = vault.peek(dailyNotePath(fromIsoDate("2026-10-02"), settings))!;
    expect(today).toContain("- [ ] 아주 긴 일 #장기 (⏰ 284일째 이월, 09-01~)");

    const items = await withFixedToday("2026-10-02", () =>
      collectTimelineItems(fromIsoDate("2026-10-02"), vault, settings),
    );
    const item = items.find((x) => x.name.includes("아주 긴 일"))!;
    expect(toIsoDate(item.start)).toBe("2025-09-01");
  });
});

