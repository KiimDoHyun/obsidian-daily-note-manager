/**
 * 월/년 경계 회귀 테스트.
 * 목적: 이월 카운터의 origin-date 연도 유추, 5일 드롭 창이 두 달을 걸치는 경우,
 * 월간 종합/드롭 문서 배치 규칙, catch-up 재생, 주차 폴더 계산 등을
 * 월·년 경계에서 검증한다.
 *
 * 이 파일은 프로덕션 코드를 수정하지 않는다. 이미 있는 InMemoryVault·픽스처를 그대로 사용.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { Engine } from "../../src/engine";
import { fromIsoDate, resolveOriginDate, toIsoDate } from "../../src/engine/dateutil";
import {
  dailyNoteDir,
  dailyNotePath,
  monthlyDropPath,
  monthlySummaryPath,
} from "../../src/engine/paths";
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
      /* no-op */
    },
    "test-vault",
  );
  return { engine, settings: s };
}

describe("월/년 경계 회귀", () => {
  let vault: InMemoryVault;
  beforeEach(() => {
    vault = new InMemoryVault();
  });

  // 시나리오 1 — 년 경계 이월 (12/31 → 1/1)
  it("년 경계: 12-31 활성 → 01-01 이월 1일째, origin-date 는 2025-12-31", async () => {
    await withFixedToday("2026-01-01", async () => {
      const { engine, settings } = makeEngine(vault);
      vault.seed(
        dailyNotePath(fromIsoDate("2025-12-31"), settings),
        makeDailyNoteMd({ date: "2025-12-31", activeLines: ["- [ ] 연말 잔업"] }),
      );
      await engine.createForToday();
      const today = vault.peek(dailyNotePath(fromIsoDate("2026-01-01"), settings))!;
      expect(today).toContain("- [ ] 연말 잔업 (⏰ 1일째 이월, 12-31~)");
    });
  });

  // 시나리오 1b — origin-date 유추기 단위 검증
  it("년 경계 origin 유추: noteDate=2026-01-05 + MM-DD=12-30 → 2025-12-30", () => {
    const noteDate = fromIsoDate("2026-01-05");
    const origin = resolveOriginDate(noteDate, 12, 30);
    expect(toIsoDate(origin)).toBe("2025-12-30");
  });

  // 시나리오 2 — 년 경계 드롭 (5영업일 창이 년을 걸침)
  it("년 경계 드롭: 12-26 시작 → 01-02 실행 시 5일째 → 드롭 문서 달 선택", async () => {
    // 2025-12-26 (Fri) 시작. 영업일 카운트:
    //   12-26 Fri  = 시작(1일째 표기는 다음 노트부터)
    //   12-29 Mon  = 1일째 이월
    //   12-30 Tue  = 2일째
    //   12-31 Wed  = 3일째
    //   2026-01-01 Thu (신정 공휴일이지만 스킵 안 함, 영업일 취급) = 4일째
    //   2026-01-02 Fri = 5일째 → 드롭
    // 어제 노트(01-01)에 4일째로 시드해두고 01-02 실행.
    await withFixedToday("2026-01-02", async () => {
      const { engine, settings } = makeEngine(vault);
      vault.seed(
        dailyNotePath(fromIsoDate("2026-01-01"), settings),
        makeDailyNoteMd({
          date: "2026-01-01",
          carryoverLines: ["- [ ] Year end long task (4일째 이월, 12-26~)"],
        }),
      );
      await engine.createForToday();

      const today = vault.peek(dailyNotePath(fromIsoDate("2026-01-02"), settings))!;
      // 오늘 노트엔 안 남음
      expect(today).not.toContain("Year end long task");

      // 드롭 문서: 코드는 prevDate(=2026-01-01) 기준으로 monthlyDrop 을 씀 → 2026-01 드롭
      const janDropPath = "Notes/2026-01/2026-01 드롭.md";
      const decDropPath = "Notes/2025-12/2025-12 드롭.md";
      const inJan = vault.exists(janDropPath) && vault.peek(janDropPath)!.includes("Year end long task");
      const inDec = vault.exists(decDropPath) && vault.peek(decDropPath)!.includes("Year end long task");
      // 사양: 드롭·완료 기록은 이벤트가 발생한 날(종료일) 기준으로 해당 월 문서에 남는다.
      // 즉 12-26 에 시작했더라도 01-02 에 드롭 판정이 나면 2026-01 드롭 문서로 간다.
      expect(inJan || inDec).toBe(true);
      expect(inJan).toBe(true);
      expect(inDec).toBe(false);
    });
  });

  // 시나리오 3 — 월 경계 드롭 (1/28 → 2/3)
  it("월 경계 드롭: 01-28 시작 → 02-03 5일째 도달 → 드롭 문서 달 선택", async () => {
    // 01-28 Wed 시작. 이월: 01-29 Thu(1) → 01-30 Fri(2) → 02-02 Mon(3) → 02-03 Tue(4)…
    // 5영업일째 도달은 실제로 02-04 Wed. 여기서는 어제(02-03) 에 4일째 시드하고 02-04 실행.
    await withFixedToday("2026-02-04", async () => {
      const { engine, settings } = makeEngine(vault);
      vault.seed(
        dailyNotePath(fromIsoDate("2026-02-03"), settings),
        makeDailyNoteMd({
          date: "2026-02-03",
          carryoverLines: ["- [ ] Cross month task (4일째 이월, 01-28~)"],
        }),
      );
      await engine.createForToday();
      const today = vault.peek(dailyNotePath(fromIsoDate("2026-02-04"), settings))!;
      expect(today).not.toContain("Cross month task");

      const febDropPath = "Notes/2026-02/2026-02 드롭.md";
      const janDropPath = "Notes/2026-01/2026-01 드롭.md";
      const inFeb = vault.exists(febDropPath) && vault.peek(febDropPath)!.includes("Cross month task");
      const inJan = vault.exists(janDropPath) && vault.peek(janDropPath)!.includes("Cross month task");
      // 사양: 종료일 기준. 01-28 에 시작했어도 02-04 에 드롭 판정이 나면 2026-02 문서로.
      expect(inFeb || inJan).toBe(true);
      expect(inFeb).toBe(true);
      expect(inJan).toBe(false);
    });
  });

  // 시나리오 4 — 월말 완료 → 다음달 1일 실행 시 종합 문서 배치
  it("월 경계 완료: 09-30 완료 → 10-01 실행 시 완료 로그는 09월 종합에 기록", async () => {
    await withFixedToday("2026-10-01", async () => {
      const { engine, settings } = makeEngine(vault);
      vault.seed(
        dailyNotePath(fromIsoDate("2026-09-30"), settings),
        makeDailyNoteMd({ date: "2026-09-30", activeLines: ["- [x] Sep close task"] }),
      );
      await engine.createForToday();
      const sepSummary = vault.peek(monthlySummaryPath(fromIsoDate("2026-09-30"), settings))!;
      expect(sepSummary).toContain("- 09-30 Sep close task (당일)");
      // 10월 종합 파일도 새로 생성.
      expect(vault.exists(monthlySummaryPath(fromIsoDate("2026-10-01"), settings))).toBe(true);
    });
  });

  // 시나리오 5 — Catch-up across year boundary
  it("년 경계 catch-up: last=2025-12-30, today=2026-01-05 → 12-31·01-01·01-02·01-05 순차 생성", async () => {
    // 2025-12-30 Tue, 2025-12-31 Wed, 2026-01-01 Thu, 2026-01-02 Fri,
    // 2026-01-03 Sat 스킵, 01-04 Sun 스킵, 01-05 Mon.
    await withFixedToday("2026-01-05", async () => {
      const { engine, settings } = makeEngine(vault, {
        autoRunOnLoad: true,
        lastRunDate: "2025-12-30",
      });
      vault.seed(
        dailyNotePath(fromIsoDate("2025-12-30"), settings),
        makeDailyNoteMd({ date: "2025-12-30", activeLines: ["- [ ] carry across year"] }),
      );

      await engine.catchUp();

      const dec31 = vault.peek(dailyNotePath(fromIsoDate("2025-12-31"), settings));
      const jan1 = vault.peek(dailyNotePath(fromIsoDate("2026-01-01"), settings));
      const jan2 = vault.peek(dailyNotePath(fromIsoDate("2026-01-02"), settings));
      const jan5 = vault.peek(dailyNotePath(fromIsoDate("2026-01-05"), settings));
      expect(dec31).toBeDefined();
      expect(jan1).toBeDefined();
      expect(jan2).toBeDefined();
      expect(jan5).toBeDefined();

      // 카운터 연속성
      expect(dec31!).toContain("- [ ] carry across year (⏰ 1일째 이월, 12-30~)");
      expect(jan1!).toContain("- [ ] carry across year (⏰ 2일째 이월, 12-30~)");
      expect(jan2!).toContain("- [ ] carry across year (⏰ 3일째 이월, 12-30~)");
      // 01-05 는 4일째(주말 스킵으로 영업일만 +1)
      expect(jan5!).toContain("- [ ] carry across year (⏰ 4일째 이월, 12-30~)");

      // 년도별 폴더 배치
      expect(dailyNoteDir(fromIsoDate("2025-12-31"), settings)).toContain("2025-12/");
      expect(dailyNoteDir(fromIsoDate("2026-01-01"), settings)).toContain("2026-01/");
    });
  });

  // 시나리오 6 — Catch-up across month boundary
  it("월 경계 catch-up: last=2026-01-30(금), today=2026-02-03(화) → 02-02, 02-03 생성", async () => {
    // 대상: 01-31 Sat 스킵, 02-01 Sun 스킵, 02-02 Mon, 02-03 Tue.
    await withFixedToday("2026-02-03", async () => {
      const { engine, settings } = makeEngine(vault, {
        autoRunOnLoad: true,
        lastRunDate: "2026-01-30",
      });
      vault.seed(
        dailyNotePath(fromIsoDate("2026-01-30"), settings),
        makeDailyNoteMd({ date: "2026-01-30", activeLines: ["- [ ] month-cross task"] }),
      );

      await engine.catchUp();

      const feb2 = vault.peek(dailyNotePath(fromIsoDate("2026-02-02"), settings));
      const feb3 = vault.peek(dailyNotePath(fromIsoDate("2026-02-03"), settings));
      expect(feb2).toBeDefined();
      expect(feb3).toBeDefined();

      // 카운터: 02-02=1일째, 02-03=2일째
      expect(feb2!).toContain("- [ ] month-cross task (⏰ 1일째 이월, 01-30~)");
      expect(feb3!).toContain("- [ ] month-cross task (⏰ 2일째 이월, 01-30~)");

      // 2월 종합이 생성됨
      expect(vault.exists(monthlySummaryPath(fromIsoDate("2026-02-02"), settings))).toBe(true);
    });
  });

  // 시나리오 7a — 5월 1일(금) 주차 폴더
  it("월 경계 주차 폴더: 2026-05-01(금) → 1주차 폴더에 배치", async () => {
    await withFixedToday("2026-05-01", async () => {
      const { engine, settings } = makeEngine(vault);
      await engine.createForToday();
      const path = dailyNotePath(fromIsoDate("2026-05-01"), settings);
      expect(path).toBe("Notes/2026-05/1주차/📅 2026-05-01.md");
      expect(vault.exists(path)).toBe(true);
    });
  });

  // 시나리오 7b — 11월 1일(일) 주차 폴더
  it("월 경계 주차 폴더: 2026-11-01(일) → 1주차 폴더에 배치", async () => {
    await withFixedToday("2026-11-01", async () => {
      const { engine, settings } = makeEngine(vault, { skipWeekend: false });
      await engine.createForToday();
      const path = dailyNotePath(fromIsoDate("2026-11-01"), settings);
      expect(path).toBe("Notes/2026-11/1주차/📅 2026-11-01.md");
      expect(vault.exists(path)).toBe(true);
    });
  });

  // 시나리오 8 — Origin-date ambiguity (year-guess heuristic)
  it("원본 날짜 유추: 2026-01-05 노트에 '12-30~' 태그 → 2025-12-30 으로 해석", async () => {
    // 어제(01-02) 에 4일째 12-30~ 시드, 오늘(01-05) 실행. 카운터 +1 = 5일째 → 드롭 대상.
    // 이 시나리오의 핵심은 코드가 (12-30~) 을 "작년" 으로 인식해야 한다는 점.
    await withFixedToday("2026-01-05", async () => {
      const { engine, settings } = makeEngine(vault);
      vault.seed(
        dailyNotePath(fromIsoDate("2026-01-02"), settings),
        makeDailyNoteMd({
          date: "2026-01-02",
          carryoverLines: ["- [ ] Long carry (4일째 이월, 12-30~)"],
        }),
      );
      await engine.createForToday();
      // 5일째 도달 → 드롭 대상.
      const today = vault.peek(dailyNotePath(fromIsoDate("2026-01-05"), settings))!;
      expect(today).not.toContain("Long carry");
      // 드롭 문서에는 origin 표시가 남는다. prev(01-02) 기준 → 2026-01 드롭.
      const janDrop = vault.peek(monthlyDropPath(fromIsoDate("2026-01-02"), settings));
      const decDrop = vault.peek(monthlyDropPath(fromIsoDate("2025-12-30"), settings));
      const anyMention = (janDrop && janDrop.includes("Long carry")) ||
        (decDrop && decDrop.includes("Long carry"));
      expect(anyMention).toBe(true);
      // origin 이 12-30 으로 해석됐다는 신호가 드롭 로그에 남아있는지 (형식 유연 검증).
      const dropContent = (janDrop ?? "") + (decDrop ?? "");
      expect(dropContent).toMatch(/12-30/);
    });
  });

  // 시나리오 9 — Leap year
  it("윤년: 2028-02-29 → 2028-03-01 순차 처리와 카운터", async () => {
    // 02-29(화)에 활성 → 03-01(수)에서 1일째 이월. 그 다음날(03-02) 은 2일째.
    await withFixedToday("2028-03-01", async () => {
      const { engine, settings } = makeEngine(vault);
      vault.seed(
        dailyNotePath(fromIsoDate("2028-02-29"), settings),
        makeDailyNoteMd({ date: "2028-02-29", activeLines: ["- [ ] leap task"] }),
      );
      await engine.createForToday();
      const mar1 = vault.peek(dailyNotePath(fromIsoDate("2028-03-01"), settings))!;
      expect(mar1).toContain("- [ ] leap task (⏰ 1일째 이월, 02-29~)");
      // 3월 종합 파일 생성
      expect(vault.exists(monthlySummaryPath(fromIsoDate("2028-03-01"), settings))).toBe(true);
      // 2월 마지막 노트가 존재했으니 2월 종합도 방문됨.
      expect(vault.exists(monthlySummaryPath(fromIsoDate("2028-02-29"), settings))).toBe(true);
    });
  });

  // 추가 — 년 경계 완료 로그
  it("년 경계 완료: 2025-12-31 완료 → 2026-01-01 실행 시 완료 로그는 2025-12 종합에 기록", async () => {
    await withFixedToday("2026-01-01", async () => {
      const { engine, settings } = makeEngine(vault);
      vault.seed(
        dailyNotePath(fromIsoDate("2025-12-31"), settings),
        makeDailyNoteMd({ date: "2025-12-31", activeLines: ["- [x] year close"] }),
      );
      await engine.createForToday();
      const decSummary = vault.peek(monthlySummaryPath(fromIsoDate("2025-12-31"), settings))!;
      expect(decSummary).toContain("- 12-31 year close (당일)");
      expect(vault.exists(monthlySummaryPath(fromIsoDate("2026-01-01"), settings))).toBe(true);
    });
  });
});
