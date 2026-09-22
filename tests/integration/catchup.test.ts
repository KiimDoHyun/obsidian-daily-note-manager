/**
 * Engine.catchUp — 놓친 영업일 이어잡기 통합 시나리오.
 * lastRunDate 다음 영업일부터 today 까지 순차 처리하는 로직과 폴백을 검증.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { Engine } from "../../src/engine";
import { fromIsoDate } from "../../src/engine/dateutil";
import { dailyNotePath, monthlySummaryPath } from "../../src/engine/paths";
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
  // catchUp 자체를 검증하므로 autoRunOnLoad 는 기본 true 로.
  const s = makeSettings({ autoRunOnLoad: true, ...(settings ?? {}) });
  const engine = new Engine(
    vault,
    s,
    async () => {
      /* saveSettings 부작용은 상위 세션 관심 밖 */
    },
    "test-vault",
  );
  return { engine, settings: s };
}

describe("Engine.catchUp — 놓친 영업일 이어잡기", () => {
  let vault: InMemoryVault;
  beforeEach(() => {
    vault = new InMemoryVault();
  });

  // MUST 1
  it("짧은 부재 (3영업일) → 그 사이 영업일 노트를 순차 생성", async () => {
    // today = 2026-09-18 (Fri). lastRunDate = 2026-09-15 (Tue).
    // 처리 대상: 09-16 (Wed), 09-17 (Thu), 09-18 (Fri).
    await withFixedToday("2026-09-18", async () => {
      const { engine, settings } = makeEngine(vault, { lastRunDate: "2026-09-15" });
      vault.seed(
        dailyNotePath(fromIsoDate("2026-09-15"), settings),
        makeDailyNoteMd({ date: "2026-09-15", activeLines: ["- [ ] task A"] }),
      );

      await engine.catchUp();

      const wed = vault.peek(dailyNotePath(fromIsoDate("2026-09-16"), settings));
      const thu = vault.peek(dailyNotePath(fromIsoDate("2026-09-17"), settings));
      const fri = vault.peek(dailyNotePath(fromIsoDate("2026-09-18"), settings));
      expect(wed).toBeDefined();
      expect(thu).toBeDefined();
      expect(fri).toBeDefined();

      // 카운터가 하루씩 올라가는지: 16 → 1일째, 17 → 2일째, 18 → 3일째
      expect(wed!).toContain("- [ ] task A (**1일째** 이월, 09-15~)");
      expect(thu!).toContain("- [ ] task A (**2일째** 이월, 09-15~)");
      // 09-17 → 09-18 은 3일째로 접어드는 시점 → 🟠 경고 부착
      expect(fri!).toMatch(/^- \[ \] task A \(\*\*3일째\*\* 이월, 09-15~\) \(🟠 드롭 예정입니다\)$/m);
    });
  });

  // MUST 2
  it("장기 부재 (> maxCatchUpDays) → 오늘만 처리, 중간 노트는 안 만듬", async () => {
    // today = 2026-09-30 (Wed). lastRunDate = 2026-09-01. gap = 29일 > 14 → 오늘만.
    await withFixedToday("2026-09-30", async () => {
      const { engine, settings } = makeEngine(vault, {
        lastRunDate: "2026-09-01",
        maxCatchUpDays: 14,
      });
      vault.seed(
        dailyNotePath(fromIsoDate("2026-09-01"), settings),
        makeDailyNoteMd({ date: "2026-09-01", activeLines: ["- [ ] stale task"] }),
      );

      await engine.catchUp();

      // 오늘만 생성됨. 중간 영업일(예: 09-15) 은 만들어지지 않음.
      expect(vault.exists(dailyNotePath(fromIsoDate("2026-09-30"), settings))).toBe(true);
      expect(vault.exists(dailyNotePath(fromIsoDate("2026-09-15"), settings))).toBe(false);
      expect(vault.exists(dailyNotePath(fromIsoDate("2026-09-29"), settings))).toBe(false);
    });
  });

  // MUST 3
  it("skipWeekend=true → 주말은 대상에서 제외", async () => {
    // today = 2026-09-22 (Tue). lastRunDate = 2026-09-17 (Thu).
    // 대상: 09-18 (Fri), (09-19 Sat 스킵), (09-20 Sun 스킵), 09-21 (Mon), 09-22 (Tue).
    await withFixedToday("2026-09-22", async () => {
      const { engine, settings } = makeEngine(vault, {
        lastRunDate: "2026-09-17",
        skipWeekend: true,
      });
      vault.seed(
        dailyNotePath(fromIsoDate("2026-09-17"), settings),
        makeDailyNoteMd({ date: "2026-09-17", activeLines: ["- [ ] task"] }),
      );

      await engine.catchUp();

      expect(vault.exists(dailyNotePath(fromIsoDate("2026-09-18"), settings))).toBe(true);
      expect(vault.exists(dailyNotePath(fromIsoDate("2026-09-19"), settings))).toBe(false);
      expect(vault.exists(dailyNotePath(fromIsoDate("2026-09-20"), settings))).toBe(false);
      expect(vault.exists(dailyNotePath(fromIsoDate("2026-09-21"), settings))).toBe(true);
      expect(vault.exists(dailyNotePath(fromIsoDate("2026-09-22"), settings))).toBe(true);
    });
  });

  it("skipWeekend=false → 주말도 대상에 포함", async () => {
    // today = 2026-09-22 (Tue). lastRunDate = 2026-09-17 (Thu).
    // 대상: 09-18, 09-19, 09-20, 09-21, 09-22 (5개 모두).
    await withFixedToday("2026-09-22", async () => {
      const { engine, settings } = makeEngine(vault, {
        lastRunDate: "2026-09-17",
        skipWeekend: false,
      });
      vault.seed(
        dailyNotePath(fromIsoDate("2026-09-17"), settings),
        makeDailyNoteMd({ date: "2026-09-17", activeLines: ["- [ ] task"] }),
      );

      await engine.catchUp();

      // 주말 포함해 모두 생성.
      for (const iso of ["2026-09-18", "2026-09-19", "2026-09-20", "2026-09-21", "2026-09-22"]) {
        expect(vault.exists(dailyNotePath(fromIsoDate(iso), settings))).toBe(true);
      }
    });
  });

  it("autoRunOnLoad=false → catchUp 이 아무 것도 하지 않음", async () => {
    await withFixedToday("2026-09-22", async () => {
      const { engine, settings } = makeEngine(vault, {
        autoRunOnLoad: false,
        lastRunDate: "2026-09-17",
      });
      vault.seed(
        dailyNotePath(fromIsoDate("2026-09-17"), settings),
        makeDailyNoteMd({ date: "2026-09-17", activeLines: ["- [ ] task"] }),
      );
      await engine.catchUp();
      expect(vault.exists(dailyNotePath(fromIsoDate("2026-09-22"), settings))).toBe(false);
    });
  });

  it("lastRunDate === null → 오늘만 처리", async () => {
    await withFixedToday("2026-09-15", async () => {
      const { engine, settings } = makeEngine(vault, { lastRunDate: null });
      await engine.catchUp();
      expect(vault.exists(dailyNotePath(fromIsoDate("2026-09-15"), settings))).toBe(true);
    });
  });

  it("today ≤ lastRunDate → 조기 return, 아무 것도 하지 않음", async () => {
    await withFixedToday("2026-09-15", async () => {
      const { engine, settings } = makeEngine(vault, { lastRunDate: "2026-09-15" });
      await engine.catchUp();
      expect(vault.exists(dailyNotePath(fromIsoDate("2026-09-15"), settings))).toBe(false);
    });
  });

  // SHOULD 8
  it("월 경계 catch-up: 이벤트가 각각 지난달·이번달 종합으로 배분", async () => {
    // today = 2026-10-02 (Fri). lastRunDate = 2026-09-29 (Tue).
    // 대상: 09-30 (Wed), 10-01 (Thu), 10-02 (Fri).
    await withFixedToday("2026-10-02", async () => {
      const { engine, settings } = makeEngine(vault, {
        lastRunDate: "2026-09-29",
      });
      // 09-29 노트에 완료된 태스크 하나 → 09-30 실행 시 9월 종합에 로그.
      vault.seed(
        dailyNotePath(fromIsoDate("2026-09-29"), settings),
        makeDailyNoteMd({
          date: "2026-09-29",
          activeLines: ["- [x] Sep task done", "- [ ] carry to Oct"],
        }),
      );

      await engine.catchUp();

      // 3일치 노트 모두 생성.
      expect(vault.exists(dailyNotePath(fromIsoDate("2026-09-30"), settings))).toBe(true);
      expect(vault.exists(dailyNotePath(fromIsoDate("2026-10-01"), settings))).toBe(true);
      expect(vault.exists(dailyNotePath(fromIsoDate("2026-10-02"), settings))).toBe(true);

      // 9월 완료 이벤트는 9월 종합에 기록.
      const sepSummary = vault.peek(monthlySummaryPath(fromIsoDate("2026-09-30"), settings))!;
      expect(sepSummary).toContain("- 09-29 Sep task done (당일)");

      // 10월 종합이 신규 생성됨.
      const octSummaryPath = monthlySummaryPath(fromIsoDate("2026-10-01"), settings);
      expect(vault.exists(octSummaryPath)).toBe(true);

      // 이월된 태스크가 10월 첫날 노트에 그대로 이어짐.
      const oct1 = vault.peek(dailyNotePath(fromIsoDate("2026-10-01"), settings))!;
      expect(oct1).toContain("carry to Oct");
    });
  });
});
