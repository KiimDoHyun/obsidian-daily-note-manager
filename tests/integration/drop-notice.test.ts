/**
 * 오늘 노트 맨 아래의 "오늘 드롭된 업무" 참고 칸.
 *
 * 규칙:
 *   - 이번 실행에서 **자동으로**(이월 일수가 드롭 기준일에 도달해) 드롭된 항목만 보여준다.
 *     직접 `[-]` 로 지운 항목은 사용자가 이미 알고 있으므로 넣지 않는다.
 *   - 노트 최하단(마커 예시·링크 줄 아래)에 빈 줄 + `---` 로 구분해 붙인다.
 *     빈 줄이 없으면 마크다운이 윗줄을 제목으로 바꿔 버린다.
 *   - 제목은 굵은 글씨(목차에 안 뜨게), 목록은 체크박스 없는 점 목록.
 *   - 드롭 기준일 숫자는 설정값을 그대로 쓴다.
 *   - 드롭이 없으면 구분선도 칸도 만들지 않는다.
 *   - 이 칸은 다음 날 처리에 영향을 주지 않는다.
 * 같이 고친 것: 마커 예시·드롭 문서 안내문에 박혀 있던 "5일" 을 설정값으로.
 */
import { describe, it, expect } from "vitest";
import { Engine } from "../../src/engine";
import { fromIsoDate } from "../../src/engine/dateutil";
import { parseDailyNoteText } from "../../src/engine/parser";
import { dailyNotePath, monthlyDropPath } from "../../src/engine/paths";
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

async function run(
  lastIso: string,
  todayIso: string,
  note: { activeLines?: string[]; carryoverLines?: string[] },
  overrides: Partial<DailyNoteSettings> = {},
) {
  const vault = new InMemoryVault();
  const settings = makeSettings({ lastRunDate: lastIso, ...overrides });
  vault.seed(dailyNotePath(fromIsoDate(lastIso), settings), makeDailyNoteMd({ date: lastIso, ...note }));
  await withFixedToday(todayIso, () => new Engine(vault, settings, async () => {}).runDaily());
  return { vault, settings, today: vault.peek(dailyNotePath(fromIsoDate(todayIso), settings))! };
}

/** 노트에서 맨 아래 드롭 칸(마지막 `---` 이후)만 잘라낸다. 없으면 null. */
function dropSection(note: string): string[] | null {
  const lines = note.replace(/\n+$/, "").split("\n");
  const i = lines.lastIndexOf("---");
  if (i === -1 || !lines[i + 1]?.startsWith("**⏭️")) return null;
  return lines.slice(i + 1);
}

describe("오늘 드롭된 업무 — 노트 맨 아래 참고 칸", () => {
  it("자동 드롭된 항목을 맨 아래에 보여준다 (기준일 기본 5)", async () => {
    const r = await run("2026-09-17", "2026-09-18", {
      carryoverLines: ["- [ ] 보고서 작성 (⏰ 4일째 이월, 09-11~) (🔴 드롭 예정입니다)"],
    });
    expect(dropSection(r.today)).toEqual([
      "**⏭️ 오늘 드롭된 업무 1건** (이월 5일째 도달 · [[2026-09 드롭]])",
      "- 보고서 작성 (09-11 시작, 09-17 드롭, 5영업일 이월)",
    ]);
  });

  it("마커 예시·링크 줄보다 아래에 있고, 구분선 위에 빈 줄이 있다", async () => {
    const r = await run("2026-09-17", "2026-09-18", {
      carryoverLines: ["- [ ] 보고서 작성 (⏰ 4일째 이월, 09-11~)"],
    });
    const lines = r.today.split("\n");
    const linkLine = lines.findIndex((l) => l.startsWith("📂 "));
    const sep = lines.lastIndexOf("---");
    expect(sep).toBeGreaterThan(linkLine);
    expect(lines[sep - 1]).toBe("");
    expect(lines.slice(sep).some((l) => /^\s*- \[.\]/.test(l))).toBe(false);
  });

  it("드롭 기준일을 3으로 바꾸면 그 숫자를 쓴다", async () => {
    const r = await run(
      "2026-09-17",
      "2026-09-18",
      { carryoverLines: ["- [ ] 짧은 기준 (⏰ 2일째 이월, 09-15~)"] },
      { dropThresholdDays: 3, warnOrangeDaysBeforeDrop: 2, warnRedDaysBeforeDrop: 1 },
    );
    expect(dropSection(r.today)).toEqual([
      "**⏭️ 오늘 드롭된 업무 1건** (이월 3일째 도달 · [[2026-09 드롭]])",
      "- 짧은 기준 (09-15 시작, 09-17 드롭, 3영업일 이월)",
    ]);
  });

  it("기준일을 낮춰 기준보다 오래된 항목이 드롭되면 실제 이월 일수를 보여준다 (7일째 → 기준 5)", async () => {
    const r = await run("2026-09-17", "2026-09-18", {
      carryoverLines: ["- [ ] 오래 묵은 일 (⏰ 6일째 이월, 09-09~)"],
    });
    expect(dropSection(r.today)![1]).toBe("- 오래 묵은 일 (09-09 시작, 09-17 드롭, 7영업일 이월)");
  });

  it("직접 [-] 로 지운 항목은 보여주지 않는다", async () => {
    const r = await run("2026-09-17", "2026-09-18", {
      activeLines: ["- [-] 직접 지운 일"],
      carryoverLines: ["- [ ] 자동 드롭 (⏰ 4일째 이월, 09-11~)"],
    });
    const sec = dropSection(r.today)!;
    expect(sec[0]).toContain("1건");
    expect(sec.join("\n")).not.toContain("직접 지운 일");
  });

  it("직접 지운 항목만 있으면 칸 자체가 없다", async () => {
    const r = await run("2026-09-17", "2026-09-18", { activeLines: ["- [-] 직접 지운 일"] });
    expect(dropSection(r.today)).toBeNull();
  });

  it("드롭이 없으면 구분선도 칸도 없다 (노트가 링크 줄로 끝난다)", async () => {
    const r = await run("2026-09-17", "2026-09-18", { activeLines: ["- [ ] 평범한 일"] });
    expect(dropSection(r.today)).toBeNull();
    expect(r.today.replace(/\n+$/, "").split("\n").pop()!).toMatch(/^📂 /);
  });

  it("오래 비웠다 돌아오면 드롭이 일어난 달마다 드롭 문서 링크를 붙이고 날짜순으로 보여준다", async () => {
    // 05-29(금) 노트 기준:
    //   5월 드롭   4일째 → 06-01 에 5일째 → 드롭, 기록 05-29
    //   6월 초 드롭 2일째 → 06-01(3) 02(4) → 03 에 5일째 → 기록 06-02
    //   6월 드롭   새 할일 → 06-01(1) … 04(4) → 05 에 5일째 → 기록 06-04
    const r = await run("2026-05-29", "2026-09-01", {
      activeLines: ["- [ ] 6월 드롭"],
      carryoverLines: ["- [ ] 5월 드롭 (⏰ 4일째 이월, 05-25~)", "- [ ] 6월 초 드롭 (⏰ 2일째 이월, 05-27~)"],
    });
    expect(dropSection(r.today)).toEqual([
      "**⏭️ 오늘 드롭된 업무 3건** (이월 5일째 도달 · [[2026-05 드롭]] · [[2026-06 드롭]])",
      "- 5월 드롭 (05-25 시작, 05-29 드롭, 5영업일 이월)",
      "- 6월 초 드롭 (05-27 시작, 06-02 드롭, 5영업일 이월)",
      "- 6월 드롭 (05-29 시작, 06-04 드롭, 5영업일 이월)",
    ]);
  });

  it("다음 날 처리에 영향이 없다: 칸이 있는 노트를 다시 읽어도 이월·할일에 끼어들지 않고, 다음 날엔 칸이 사라진다", async () => {
    const r = await run("2026-09-17", "2026-09-18", {
      carryoverLines: ["- [ ] 보고서 작성 (⏰ 4일째 이월, 09-11~)", "- [ ] 남는 일 (⏰ 1일째 이월, 09-16~)"],
    });
    const parsed = parseDailyNoteText(r.today, fromIsoDate("2026-09-18"));
    expect(parsed.carryoverBlocks.map((b) => b.topText)).toEqual(["남는 일"]);
    expect(parsed.memoLines).toEqual([]);

    await withFixedToday("2026-09-21", () => new Engine(r.vault, r.settings, async () => {}).runDaily());
    const next = r.vault.peek(dailyNotePath(fromIsoDate("2026-09-21"), r.settings))!;
    expect(dropSection(next)).toBeNull();
    // 09-18(금) 노트에 2일째 → 09-21(월) 은 평일 하루 뒤라 3일째.
    expect(next).toContain("- [ ] 남는 일 (⏰ 3일째 이월, 09-16~) (🟠 드롭 예정입니다)");
  });
});

describe("고정돼 있던 '5일' 을 설정값으로", () => {
  it("노트 맨 아래 마커 예시가 드롭 기준일 설정을 따른다 (7일)", async () => {
    const r = await run(
      "2026-09-17",
      "2026-09-18",
      { activeLines: ["- [ ] 평범한 일"] },
      { dropThresholdDays: 7 },
    );
    expect(r.today).toContain("#장기    → 7일 드롭 규칙 면제, 무한 이월");
    expect(r.today).not.toContain("5일 드롭 규칙");
  });

  it("월간 드롭 문서 안내문이 드롭 기준일 설정을 따르고, '초과' 대신 '도달' 로 적는다 (3일)", async () => {
    const r = await run(
      "2026-09-17",
      "2026-09-18",
      { activeLines: ["- [-] 아무거나"] },
      { dropThresholdDays: 3, warnOrangeDaysBeforeDrop: 2, warnRedDaysBeforeDrop: 1 },
    );
    const drop = r.vault.peek(monthlyDropPath(fromIsoDate("2026-09-17"), r.settings))!;
    expect(drop).toContain("> 이월 3일째에 도달했거나 즉시 드롭(`[-]`) 처리된 항목.");
    expect(drop).not.toContain("5일 초과");
  });
});
