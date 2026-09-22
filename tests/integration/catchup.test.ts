/**
 * Engine.catchUp — 놓친 영업일 이어잡기 통합 시나리오.
 * lastRunDate 다음 영업일부터 today 까지 순차 처리하는 로직과 폴백을 검증.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { Engine, CatchUpError } from "../../src/engine";
import { fromIsoDate } from "../../src/engine/dateutil";
import { dailyNotePath, monthlySummaryPath } from "../../src/engine/paths";
import { InMemoryVault } from "../helpers/inMemoryVault";
import { makeDailyNoteMd, makeSettings } from "../helpers/fixtures";
import type { DailyNoteSettings } from "../../src/settings";
import * as obsidian from "obsidian";

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
      expect(wed!).toContain("- [ ] task A (⏰ 1일째 이월, 09-15~)");
      expect(thu!).toContain("- [ ] task A (⏰ 2일째 이월, 09-15~)");
      // 09-17 → 09-18 은 3일째로 접어드는 시점 → 🟠 경고 부착
      expect(fri!).toMatch(/^- \[ \] task A \(⏰ 3일째 이월, 09-15~\) \(🟠 드롭 예정입니다\)$/m);
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

/**
 * 실패-전파 규칙: 중간 날짜 하나가 실패하면 뒤이은 날짜는 시도하지 않고
 * lastRunDate 는 마지막 성공 날짜에 머무른다. 다음 catchUp 호출이 실패 날짜부터
 * 자연스레 재시도한다.
 */
describe("Engine.catchUp — 중간 실패 시 즉시 중단", () => {
  let vault: InMemoryVault;
  beforeEach(() => {
    vault = new InMemoryVault();
  });

  /**
   * 특정 데일리 노트 경로에 대해 vault.write 가 처음 호출될 때만 예외를 던지도록 가로챈다.
   * 두 번째 호출부터는 원본 write 를 그대로 통과시켜 "재시도 시 성공" 시나리오를 재현한다.
   */
  function poisonWriteOnce(v: InMemoryVault, targetPath: string): { calls: number } {
    const state = { calls: 0 };
    const originalWrite = v.write.bind(v);
    v.write = async (path: string, content: string) => {
      if (path === targetPath) {
        state.calls += 1;
        if (state.calls === 1) throw new Error(`simulated write failure: ${path}`);
      }
      return originalWrite(path, content);
    };
    return state;
  }

  it("3일 catch-up 중 2일째 실패 → 3일째 시도 없음, lastRunDate 는 시작 시점에 정지", async () => {
    // today = 2026-09-18 (Fri). lastRunDate = 2026-09-15 (Tue). 대상: 16, 17, 18.
    await withFixedToday("2026-09-18", async () => {
      const { engine, settings } = makeEngine(vault, { lastRunDate: "2026-09-15" });
      vault.seed(
        dailyNotePath(fromIsoDate("2026-09-15"), settings),
        makeDailyNoteMd({ date: "2026-09-15", activeLines: ["- [ ] task A"] }),
      );

      const day17Path = dailyNotePath(fromIsoDate("2026-09-17"), settings);
      const day18Path = dailyNotePath(fromIsoDate("2026-09-18"), settings);
      poisonWriteOnce(vault, day17Path);

      await expect(engine.catchUp()).rejects.toBeInstanceOf(CatchUpError);

      // 16 은 성공, 17 은 실패로 파일 없음, 18 은 아예 시도 안 함.
      expect(vault.exists(dailyNotePath(fromIsoDate("2026-09-16"), settings))).toBe(true);
      expect(vault.exists(day17Path)).toBe(false);
      expect(vault.exists(day18Path)).toBe(false);

      // 16 까지만 성공했으므로 lastRunDate 는 16 에 멈춰야 한다.
      expect(settings.lastRunDate).toBe("2026-09-16");
    });
  });

  it("실패 후 재실행 → 실패한 날짜(2일째)부터 재시도, 성공하면 3일째까지 진행", async () => {
    await withFixedToday("2026-09-18", async () => {
      const { engine, settings } = makeEngine(vault, { lastRunDate: "2026-09-15" });
      vault.seed(
        dailyNotePath(fromIsoDate("2026-09-15"), settings),
        makeDailyNoteMd({ date: "2026-09-15", activeLines: ["- [ ] task A"] }),
      );

      const day17Path = dailyNotePath(fromIsoDate("2026-09-17"), settings);
      const day18Path = dailyNotePath(fromIsoDate("2026-09-18"), settings);
      poisonWriteOnce(vault, day17Path); // 첫 호출만 실패, 재시도는 통과.

      await expect(engine.catchUp()).rejects.toBeInstanceOf(CatchUpError);
      expect(settings.lastRunDate).toBe("2026-09-16");

      // 두 번째 호출: 대상은 17, 18. 17 은 이제 성공 (poison 이 한 번만 발동).
      await engine.catchUp();

      expect(vault.exists(day17Path)).toBe(true);
      expect(vault.exists(day18Path)).toBe(true);
      expect(settings.lastRunDate).toBe("2026-09-18");

      // 이월 카운터 체인이 끊기지 않았는지 확인: 17 은 15 기준 2일째, 18 은 3일째.
      const day17 = vault.peek(day17Path)!;
      const day18 = vault.peek(day18Path)!;
      expect(day17).toContain("- [ ] task A (⏰ 2일째 이월, 09-15~)");
      expect(day18).toMatch(/^- \[ \] task A \(⏰ 3일째 이월, 09-15~\) \(🟠 드롭 예정입니다\)$/m);
    });
  });

  it("CatchUpError 는 실패 날짜와 원본 원인을 노출한다", async () => {
    await withFixedToday("2026-09-18", async () => {
      const { engine, settings } = makeEngine(vault, { lastRunDate: "2026-09-15" });
      vault.seed(
        dailyNotePath(fromIsoDate("2026-09-15"), settings),
        makeDailyNoteMd({ date: "2026-09-15", activeLines: ["- [ ] task A"] }),
      );
      const day17Path = dailyNotePath(fromIsoDate("2026-09-17"), settings);
      poisonWriteOnce(vault, day17Path);

      let caught: CatchUpError | null = null;
      try {
        await engine.catchUp();
      } catch (err) {
        caught = err as CatchUpError;
      }
      expect(caught).not.toBeNull();
      expect(caught!.failedDate).toBe("2026-09-17");
      expect((caught!.cause as Error).message).toContain("simulated write failure");
    });
  });
});

/**
 * 플러그인 래퍼의 Notice dedupe 검증. 같은 실패 날짜가 반복돼도 Notice 는 한 번만.
 */
describe("plugin.runCatchUp — Notice 중복 방지", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("같은 실패 날짜로 두 번 호출해도 Notice 는 한 번만 뜬다", async () => {
    const vault = new InMemoryVault();
    await withFixedToday("2026-09-18", async () => {
      const settings = makeSettings({ autoRunOnLoad: true, lastRunDate: "2026-09-15" });
      const engine = new Engine(
        vault,
        settings,
        async () => {
          /* noop */
        },
        "test-vault",
      );
      vault.seed(
        dailyNotePath(fromIsoDate("2026-09-15"), settings),
        makeDailyNoteMd({ date: "2026-09-15", activeLines: ["- [ ] task A"] }),
      );
      // 17 이 매번 실패하도록 (한 번만 아님).
      const day17Path = dailyNotePath(fromIsoDate("2026-09-17"), settings);
      const originalWrite = vault.write.bind(vault);
      vault.write = async (path: string, content: string) => {
        if (path === day17Path) throw new Error("perma-fail");
        return originalWrite(path, content);
      };

      const noticeSpy = vi.spyOn(obsidian, "Notice").mockImplementation(
        // @ts-expect-error 반환 타입은 Notice 지만 테스트에서 참조 안 함
        (_msg: string, _timeout?: number) => ({}),
      );

      // 최소 플러그인 스캐폴딩. main.ts 의 runCatchUp 만 호출 가능하도록.
      const { default: DailyNoteManagerPlugin } = await import("../../src/main");
      const plugin = new (DailyNoteManagerPlugin as unknown as new (
        a: unknown,
        m: unknown,
      ) => InstanceType<typeof DailyNoteManagerPlugin>)({}, {});
      (plugin as unknown as { engine: Engine }).engine = engine;

      // 첫 실행: 17 에서 실패 → Notice 1회, lastRunDate = 16.
      await plugin.runCatchUp();
      expect(noticeSpy).toHaveBeenCalledTimes(1);
      expect(settings.lastRunDate).toBe("2026-09-16");

      // 두 번째 실행: 다시 17 에서 실패. 같은 실패 날짜이므로 Notice 는 추가로 뜨지 않음.
      await plugin.runCatchUp();
      expect(noticeSpy).toHaveBeenCalledTimes(1);
      expect(settings.lastRunDate).toBe("2026-09-16");
    });
  });

  it("실패 날짜가 바뀌면 다시 Notice 를 띄운다", async () => {
    const vault = new InMemoryVault();
    await withFixedToday("2026-09-18", async () => {
      const settings = makeSettings({ autoRunOnLoad: true, lastRunDate: "2026-09-15" });
      const engine = new Engine(
        vault,
        settings,
        async () => {
          /* noop */
        },
        "test-vault",
      );
      vault.seed(
        dailyNotePath(fromIsoDate("2026-09-15"), settings),
        makeDailyNoteMd({ date: "2026-09-15", activeLines: ["- [ ] task A"] }),
      );

      // 처음엔 16 이 실패, 이후엔 17 이 실패하도록 두 단계로 재구성.
      const day16Path = dailyNotePath(fromIsoDate("2026-09-16"), settings);
      const day17Path = dailyNotePath(fromIsoDate("2026-09-17"), settings);
      const originalWrite = vault.write.bind(vault);
      let poisonPath: string = day16Path;
      vault.write = async (path: string, content: string) => {
        if (path === poisonPath) throw new Error(`fail ${path}`);
        return originalWrite(path, content);
      };

      const noticeSpy = vi.spyOn(obsidian, "Notice").mockImplementation(
        // @ts-expect-error 반환 타입은 Notice 지만 테스트에서 참조 안 함
        (_msg: string, _timeout?: number) => ({}),
      );

      const { default: DailyNoteManagerPlugin } = await import("../../src/main");
      const plugin = new (DailyNoteManagerPlugin as unknown as new (
        a: unknown,
        m: unknown,
      ) => InstanceType<typeof DailyNoteManagerPlugin>)({}, {});
      (plugin as unknown as { engine: Engine }).engine = engine;

      // 1차: 16 에서 실패 → Notice 1회.
      await plugin.runCatchUp();
      expect(noticeSpy).toHaveBeenCalledTimes(1);

      // 이제 16 은 통과, 17 이 실패하도록 스위칭.
      poisonPath = day17Path;
      await plugin.runCatchUp();
      // 실패 날짜가 달라졌으므로 Notice 가 다시 발동해야 한다.
      expect(noticeSpy).toHaveBeenCalledTimes(2);
    });
  });
});
