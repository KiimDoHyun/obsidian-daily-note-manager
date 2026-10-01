/**
 * 사용자가 예상 밖으로 편집한 노트가 다음 날 흐름에서 올바로 처리되는지.
 */
import { describe, it, expect } from "vitest";
import { Engine } from "../../src/engine";
import { fromIsoDate } from "../../src/engine/dateutil";
import { dailyNotePath, monthlySummaryPath } from "../../src/engine/paths";
import { InMemoryVault } from "../helpers/inMemoryVault";
import { carriedNames, makeDailyNoteMd, makeSettings } from "../helpers/fixtures";
import { withFixedToday } from "../helpers/fixedDate";

async function runNextDay(prevIso: string, todayIso: string, md: string) {
  const vault = new InMemoryVault();
  const settings = makeSettings({});
  vault.seed(dailyNotePath(fromIsoDate(prevIso), settings), md);
  await withFixedToday(todayIso, async () => {
    await new Engine(vault, settings, async () => {}).createForToday();
  });
  return {
    today: vault.peek(dailyNotePath(fromIsoDate(todayIso), settings))!,
    summary: vault.peek(monthlySummaryPath(fromIsoDate(prevIso), settings))!,
  };
}

describe("사용자 편집 — 다음 날 흐름", () => {
  it("대문자 [X] 로 체크한 항목은 월간 종합에 완료로 기록되고 오늘로 넘어오지 않는다", async () => {
    const { today, summary } = await runNextDay(
      "2026-09-17",
      "2026-09-18",
      makeDailyNoteMd({ date: "2026-09-17", activeLines: ["- [ ] 일반", "- [X] 대문자 완료"] }),
    );
    expect(summary).toContain("- 09-17 대문자 완료 (당일)");
    expect(today).not.toContain("대문자 완료");
    expect(today).toContain("- [ ] 일반 (⏰ 1일째 이월, 09-17~)");
  });

  it("이월 태그 뒤에 글을 덧붙여도 일수가 이어지고 태그는 하나만 남는다", async () => {
    const { today } = await runNextDay(
      "2026-09-17",
      "2026-09-18",
      makeDailyNoteMd({
        date: "2026-09-17",
        carryoverLines: ["- [ ] 보고서 (⏰ 3일째 이월, 09-14~) (🟠 드롭 예정입니다) 내일까지"],
      }),
    );
    const line = today.split("\n").find((l) => l.includes("보고서"))!;
    expect(line).toBe("- [ ] 보고서 내일까지 (⏰ 4일째 이월, 09-14~) (🔴 드롭 예정입니다)");
  });

  it("이월 태그 뒤에 글을 덧붙인 항목도 임계에 도달하면 드롭된다", async () => {
    const { today, summary } = await runNextDay(
      "2026-09-17",
      "2026-09-18",
      makeDailyNoteMd({
        date: "2026-09-17",
        carryoverLines: ["- [ ] 보고서 (⏰ 4일째 이월, 09-11~) (🔴 드롭 예정입니다) 내일까지"],
      }),
    );
    expect(carriedNames(today).some((n) => n.includes("보고서"))).toBe(false);
    expect(summary).toContain("보고서 내일까지 (09-11 시작, 5영업일 이월 후 드롭)");
  });
});
