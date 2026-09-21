/**
 * design.md 4.7 절 테스트 시나리오 이식 (Engine.createForToday 오케스트레이션).
 * InMemoryVault 로 파일시스템을 시뮬레이션, Obsidian API 없이 순수 로직 검증.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { Engine } from "../../src/engine";
import { fromIsoDate, toIsoDate } from "../../src/engine/dateutil";
import { dailyNotePath, monthlySummaryPath } from "../../src/engine/paths";
import { InMemoryVault } from "../helpers/inMemoryVault";
import { makeDailyNoteMd, makeLegacyDailyNoteMd, makeSettings } from "../helpers/fixtures";
import type { DailyNoteSettings } from "../../src/settings";

/**
 * Engine 은 내부에서 todayDate() 를 호출한다. 테스트 결정성을 위해 시스템 시각을 고정.
 */
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
  const saved: DailyNoteSettings[] = [];
  const engine = new Engine(
    vault,
    s,
    async () => {
      saved.push({ ...s });
    },
    "test-vault",
  );
  return { engine, settings: s };
}

describe("Engine.createForToday — 시나리오", () => {
  let vault: InMemoryVault;
  beforeEach(() => {
    vault = new InMemoryVault();
  });

  // 시나리오 1
  it("첫 실행 (어제 노트 없음) → 오늘 노트만 생성, 이월 섹션 비어있음", async () => {
    await withFixedToday("2026-09-15", async () => {
      const { engine, settings } = makeEngine(vault);
      const res = await engine.createForToday();
      expect(res.created).toBe(true);

      const todayPath = dailyNotePath(fromIsoDate("2026-09-15"), settings);
      const md = vault.peek(todayPath)!;
      expect(md).toContain("## ✅ 이월된 할일\n\n## 💬 메모");
    });
  });

  // 시나리오 2
  it("어제 미완료 활성 할일 → 오늘 1일째 이월", async () => {
    await withFixedToday("2026-09-15", async () => {
      const { engine, settings } = makeEngine(vault);
      // 어제(월 14) 노트 seed
      vault.seed(
        dailyNotePath(fromIsoDate("2026-09-14"), settings),
        makeDailyNoteMd({ date: "2026-09-14", activeLines: ["- [ ] SNMP 개선"] }),
      );
      await engine.createForToday();
      const md = vault.peek(dailyNotePath(fromIsoDate("2026-09-15"), settings))!;
      expect(md).toContain("- [ ] SNMP 개선 (1일째 이월, 09-14~)");
    });
  });

  // 시나리오 3
  it("2일째 이월 → 3일째 + 🟠 + 드롭 예정 문구", async () => {
    await withFixedToday("2026-09-15", async () => {
      const { engine, settings } = makeEngine(vault);
      vault.seed(
        dailyNotePath(fromIsoDate("2026-09-14"), settings),
        makeDailyNoteMd({
          date: "2026-09-14",
          carryoverLines: ["- [ ] SNMP 개선 (2일째 이월, 09-10~)"],
        }),
      );
      await engine.createForToday();
      const md = vault.peek(dailyNotePath(fromIsoDate("2026-09-15"), settings))!;
      expect(md).toMatch(/🟠 - \[ \] SNMP 개선 \(3일째 이월, 09-10~\) \(드롭 예정입니다\)/);
    });
  });

  // 시나리오 4
  it("4일째 이월 → 5일째 도달 → 드롭 문서로 이동, 오늘 이월 안 됨", async () => {
    await withFixedToday("2026-09-15", async () => {
      const { engine, settings } = makeEngine(vault);
      vault.seed(
        dailyNotePath(fromIsoDate("2026-09-14"), settings),
        makeDailyNoteMd({
          date: "2026-09-14",
          carryoverLines: ["- [ ] Old task (4일째 이월, 09-08~)"],
        }),
      );
      await engine.createForToday();
      const todayMd = vault.peek(dailyNotePath(fromIsoDate("2026-09-15"), settings))!;
      expect(todayMd).not.toContain("Old task");
      // 어제(9/14) 가 속한 달의 드롭 문서에 기록
      const dropPath = "Notes/2026-09/2026-09 드롭.md";
      expect(vault.exists(dropPath)).toBe(true);
      expect(vault.peek(dropPath)!).toContain("Old task");
    });
  });

  // 시나리오 5
  it("#장기 마커는 5일째 도달해도 계속 이월", async () => {
    await withFixedToday("2026-09-15", async () => {
      const { engine, settings } = makeEngine(vault);
      vault.seed(
        dailyNotePath(fromIsoDate("2026-09-14"), settings),
        makeDailyNoteMd({
          date: "2026-09-14",
          carryoverLines: ["- [ ] Long task #장기 (4일째 이월, 09-08~)"],
        }),
      );
      await engine.createForToday();
      const todayMd = vault.peek(dailyNotePath(fromIsoDate("2026-09-15"), settings))!;
      expect(todayMd).toContain("Long task #장기 (5일째 이월, 09-08~)");
      // #장기 는 경고 색상 제외
      expect(todayMd).not.toContain("드롭 예정");
    });
  });

  // 시나리오 6
  it("#보관 마커 → 보관함으로 이동, 이월 안 됨", async () => {
    await withFixedToday("2026-09-15", async () => {
      const { engine, settings } = makeEngine(vault);
      vault.seed(
        dailyNotePath(fromIsoDate("2026-09-14"), settings),
        makeDailyNoteMd({
          date: "2026-09-14",
          activeLines: ["- [ ] Archive me #보관"],
        }),
      );
      await engine.createForToday();
      expect(vault.exists("Notes/보관함.md")).toBe(true);
      expect(vault.peek("Notes/보관함.md")!).toContain("Archive me #보관");
      const todayMd = vault.peek(dailyNotePath(fromIsoDate("2026-09-15"), settings))!;
      expect(todayMd).not.toContain("Archive me");
    });
  });

  // 시나리오 7
  it("[-] 마커 → 드롭 문서로 즉시 이동, 이월 안 됨", async () => {
    await withFixedToday("2026-09-15", async () => {
      const { engine, settings } = makeEngine(vault);
      vault.seed(
        dailyNotePath(fromIsoDate("2026-09-14"), settings),
        makeDailyNoteMd({
          date: "2026-09-14",
          activeLines: ["- [-] 폐기 아이디어"],
        }),
      );
      await engine.createForToday();
      expect(vault.peek("Notes/2026-09/2026-09 드롭.md")!).toContain("폐기 아이디어");
      expect(vault.peek(dailyNotePath(fromIsoDate("2026-09-15"), settings))!).not.toContain(
        "폐기 아이디어",
      );
    });
  });

  // 시나리오 8
  it("[x] 체크된 활성 할일 → 월간 종합에 '당일' 로 로그", async () => {
    await withFixedToday("2026-09-15", async () => {
      const { engine, settings } = makeEngine(vault);
      vault.seed(
        dailyNotePath(fromIsoDate("2026-09-14"), settings),
        makeDailyNoteMd({ date: "2026-09-14", activeLines: ["- [x] Done today"] }),
      );
      await engine.createForToday();
      const summary = vault.peek(monthlySummaryPath(fromIsoDate("2026-09-14"), settings))!;
      expect(summary).toContain("- 09-14 Done today (당일)");
    });
  });

  // 시나리오 9
  it("[x] 체크된 이월 할일(3일째) → '3영업일 소요' 로그", async () => {
    await withFixedToday("2026-09-15", async () => {
      const { engine, settings } = makeEngine(vault);
      vault.seed(
        dailyNotePath(fromIsoDate("2026-09-14"), settings),
        makeDailyNoteMd({
          date: "2026-09-14",
          carryoverLines: ["- [x] Done after wait (3일째 이월, 09-10~)"],
        }),
      );
      await engine.createForToday();
      const summary = vault.peek(monthlySummaryPath(fromIsoDate("2026-09-14"), settings))!;
      expect(summary).toContain(
        "- 09-14 Done after wait (3영업일 소요, 09-10 시작)",
      );
    });
  });

  // 시나리오 10
  it("블록 하위 메모·서브 체크박스가 함께 이월", async () => {
    await withFixedToday("2026-09-15", async () => {
      const { engine, settings } = makeEngine(vault);
      vault.seed(
        dailyNotePath(fromIsoDate("2026-09-14"), settings),
        makeDailyNoteMd({
          date: "2026-09-14",
          activeLines: [
            "- [ ] Parent",
            "    - sub note",
            "    - [x] sub done",
            "        - deeper",
          ],
        }),
      );
      await engine.createForToday();
      const todayMd = vault.peek(dailyNotePath(fromIsoDate("2026-09-15"), settings))!;
      expect(todayMd).toContain("- [ ] Parent (1일째 이월, 09-14~)");
      expect(todayMd).toContain("    - sub note");
      expect(todayMd).toContain("    - [x] sub done");
      expect(todayMd).toContain("        - deeper");
    });
  });

  // 시나리오 13
  it("월요일 → 지난 금요일을 어제로 인식 (주말 스킵)", async () => {
    // 2026-09-21 (Mon) → prev business day = 2026-09-18 (Fri)
    await withFixedToday("2026-09-21", async () => {
      const { engine, settings } = makeEngine(vault);
      vault.seed(
        dailyNotePath(fromIsoDate("2026-09-18"), settings),
        makeDailyNoteMd({
          date: "2026-09-18",
          activeLines: ["- [ ] Friday task"],
        }),
      );
      await engine.createForToday();
      const todayMd = vault.peek(dailyNotePath(fromIsoDate("2026-09-21"), settings))!;
      expect(todayMd).toContain("- [ ] Friday task (1일째 이월, 09-18~)");
    });
  });

  // 시나리오 14
  it("주말(토): 스킵 (skipWeekend=true 기본)", async () => {
    await withFixedToday("2026-09-19", async () => {
      const { engine } = makeEngine(vault);
      const res = await engine.createForToday();
      expect(res.created).toBe(false);
      expect(res.message).toContain("주말");
    });
  });

  // 시나리오 15
  it("월 경계: 어제 이벤트는 지난달 종합, 오늘 달 종합 새로 생성", async () => {
    // 2026-10-01 (Thu) 오늘, 어제 = 2026-09-30 (Wed)
    await withFixedToday("2026-10-01", async () => {
      const { engine, settings } = makeEngine(vault);
      vault.seed(
        dailyNotePath(fromIsoDate("2026-09-30"), settings),
        makeDailyNoteMd({ date: "2026-09-30", activeLines: ["- [x] Sep last day task"] }),
      );
      await engine.createForToday();
      const septSummary = vault.peek(monthlySummaryPath(fromIsoDate("2026-09-30"), settings))!;
      expect(septSummary).toContain("- 09-30 Sep last day task (당일)");

      const octSummaryPath = monthlySummaryPath(fromIsoDate("2026-10-01"), settings);
      expect(vault.exists(octSummaryPath)).toBe(true);
    });
  });

  // 시나리오 16
  it("옛 섹션명(## 📌 오늘의 목표) 노트도 파싱해서 이월 처리", async () => {
    await withFixedToday("2026-09-15", async () => {
      const { engine, settings } = makeEngine(vault);
      vault.seed(
        dailyNotePath(fromIsoDate("2026-09-14"), settings),
        makeLegacyDailyNoteMd({
          date: "2026-09-14",
          goalLines: ["- [ ] Old format task"],
        }),
      );
      await engine.createForToday();
      const todayMd = vault.peek(dailyNotePath(fromIsoDate("2026-09-15"), settings))!;
      expect(todayMd).toContain("- [ ] Old format task (1일째 이월, 09-14~)");
      // 오늘 노트는 새 섹션명으로 렌더
      expect(todayMd).toContain("## 📌 할일");
      expect(todayMd).toContain("## ✅ 이월된 할일");
    });
  });

  // idempotent
  it("오늘 노트가 이미 있으면 스킵", async () => {
    await withFixedToday("2026-09-15", async () => {
      const { engine, settings } = makeEngine(vault);
      const todayPath = dailyNotePath(fromIsoDate("2026-09-15"), settings);
      vault.seed(todayPath, "already-exists");
      const res = await engine.createForToday();
      expect(res.created).toBe(false);
      expect(res.message).toContain("이미 존재");
      expect(vault.peek(todayPath)).toBe("already-exists");
    });
  });
});

describe("Engine.forceDate", () => {
  it("기존 노트 지우고 재생성", async () => {
    const vault = new InMemoryVault();
    await withFixedToday("2026-09-15", async () => {
      const { engine, settings } = makeEngine(vault);
      const path = dailyNotePath(fromIsoDate("2026-09-15"), settings);
      vault.seed(path, "stale content");
      const res = await engine.forceDate(fromIsoDate("2026-09-15"));
      expect(res.created).toBe(true);
      expect(vault.peek(path)).not.toBe("stale content");
      expect(vault.peek(path)!).toContain("## 📌 할일");
    });
  });
});

describe("Engine 상단 요약 재계산", () => {
  it("완료·드롭·보관 카운트 반영", async () => {
    const vault = new InMemoryVault();
    await withFixedToday("2026-09-15", async () => {
      const { engine, settings } = makeEngine(vault);
      vault.seed(
        dailyNotePath(fromIsoDate("2026-09-14"), settings),
        makeDailyNoteMd({
          date: "2026-09-14",
          activeLines: ["- [x] A", "- [x] B", "- [-] C"],
        }),
      );
      await engine.createForToday();
      const summary = vault.peek(monthlySummaryPath(fromIsoDate("2026-09-14"), settings))!;
      expect(summary).toContain("- 완료: 2건");
      expect(summary).toContain("- 드롭: 1건");
    });
  });
});
