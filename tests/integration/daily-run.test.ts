/**
 * 하루 실행 흐름(스케줄러 → createForToday) + 중복 실행 방지 + 재실행 멱등성.
 *
 * 배경: 예전에는 스케줄러(오늘만 생성)와 catchUp(놓친 날 + 오늘)이 각자 출발해
 * 어느 쪽이 먼저 끝나느냐에 따라 이월 일수가 달라졌다.
 * 이제 스케줄러는 createForToday 만 부르고 항상 오늘 노트만 만든다(부재 정책은 absence-policy.test.ts).
 * 엔진 내부 잠금으로 어떤 진입점이든 동시에 두 실행이 섞이지 않는다.
 */
import { describe, it, expect } from "vitest";
import { Engine } from "../../src/engine";
import { Scheduler } from "../../src/scheduler";
import { fromIsoDate } from "../../src/engine/dateutil";
import {
  archivePath,
  dailyNotePath,
  monthlyDropPath,
  monthlySummaryPath,
} from "../../src/engine/paths";
import { InMemoryVault } from "../helpers/inMemoryVault";
import { makeDailyNoteMd, makeSettings } from "../helpers/fixtures";
import type { DailyNoteSettings } from "../../src/settings";
import type { Plugin } from "obsidian";
import { withFixedToday } from "../helpers/fixedDate";

function makeEngine(
  vault: InMemoryVault,
  settings?: Partial<DailyNoteSettings>,
): { engine: Engine; settings: DailyNoteSettings } {
  const s = makeSettings({ ...(settings ?? {}) });
  const engine = new Engine(vault, s, async () => {}, "test-vault");
  return { engine, settings: s };
}

const plugin = { registerInterval: () => {} } as unknown as Plugin;
async function tick(scheduler: Scheduler): Promise<void> {
  await (scheduler as unknown as { tick(): Promise<void> }).tick();
}

function notePaths(vault: InMemoryVault): string[] {
  return vault
    .list()
    .filter((p) => p.includes("📅"))
    .map((p) => p.slice(-13, -3));
}

describe("스케줄러가 부르는 하루 실행", () => {
  it("스케줄러 tick 하나로 오늘 노트만 생기고, 그 사이 영업일만큼 이월 일수가 오른다", async () => {
    // 수(09-16) 이후 처음 켠 날이 월(09-21). 목·금·월 = 3일.
    const vault = new InMemoryVault();
    await withFixedToday("2026-09-21", async () => {
      const { engine, settings } = makeEngine(vault, { lastRunDate: "2026-09-16" });
      vault.seed(
        dailyNotePath(fromIsoDate("2026-09-16"), settings),
        makeDailyNoteMd({ date: "2026-09-16", activeLines: ["- [ ] 업무A"] }),
      );

      await tick(new Scheduler(engine, plugin));

      expect(notePaths(vault)).toEqual(["2026-09-16", "2026-09-21"]);
      const mon = vault.peek(dailyNotePath(fromIsoDate("2026-09-21"), settings))!;
      expect(mon).toContain("- [ ] 업무A (⏰ 3일째 이월, 09-16~)");
      expect(settings.lastRunDate).toBe("2026-09-21");
    });
  });
});

describe("엔진 잠금 — 진입점이 겹쳐도 한 번에 하나씩", () => {
  it("스케줄러 실행과 명령 실행이 동시에 불려도 오늘 노트·완료 로그는 한 번만", async () => {
    const vault = new InMemoryVault();
    await withFixedToday("2026-09-18", async () => {
      const { engine, settings } = makeEngine(vault, { lastRunDate: "2026-09-17" });
      vault.seed(
        dailyNotePath(fromIsoDate("2026-09-17"), settings),
        makeDailyNoteMd({ date: "2026-09-17", activeLines: ["- [x] 끝낸일"] }),
      );
      // 읽기·쓰기마다 실제 디스크처럼 매크로태스크 하나씩 양보시켜 interleave 를 유도.
      const slow = <A extends unknown[], R>(f: (...a: A) => Promise<R>) =>
        async (...a: A) => {
          await new Promise((r) => setTimeout(r, 0));
          return f(...a);
        };
      vault.read = slow(vault.read.bind(vault));
      vault.write = slow(vault.write.bind(vault));

      const results = await Promise.all([engine.createForToday(), engine.createForToday()]);

      const statuses = results.map((r) => r.status).sort();
      expect(statuses).toEqual(["created", "skipped_exists"]);
      const sum = vault.peek(monthlySummaryPath(fromIsoDate("2026-09-17"), settings))!;
      expect(sum.split("\n").filter((l) => l.includes("끝낸일"))).toHaveLength(1);
    });
  });
});

describe("재실행 멱등성 — 같은 날을 다시 만들어도 기록이 두 번 쌓이지 않는다", () => {
  it("forceDate 로 오늘을 재생성해도 종합·보관함·드롭 문서에 중복이 없다", async () => {
    const vault = new InMemoryVault();
    await withFixedToday("2026-09-18", async () => {
      const { engine, settings } = makeEngine(vault, {});
      vault.seed(
        dailyNotePath(fromIsoDate("2026-09-17"), settings),
        makeDailyNoteMd({
          date: "2026-09-17",
          activeLines: ["- [x] 끝낸일", "- [ ] 나중에 #보관", "- [-] 안 할 일"],
        }),
      );

      await engine.createForToday();
      await engine.forceDate(fromIsoDate("2026-09-18"));

      const prev = fromIsoDate("2026-09-17");
      const count = (path: string, needle: string) =>
        vault.peek(path)!.split("\n").filter((l) => l.includes(needle)).length;
      expect(count(monthlySummaryPath(prev, settings), "끝낸일")).toBe(1);
      expect(count(monthlySummaryPath(prev, settings), "나중에")).toBe(1);
      expect(count(monthlySummaryPath(prev, settings), "안 할 일")).toBe(1);
      expect(count(archivePath(settings), "- [ ] 나중에")).toBe(1);
      expect(count(monthlyDropPath(prev, settings), "안 할 일")).toBe(1);
      expect(vault.peek(monthlySummaryPath(prev, settings))!).toContain("- 완료: 1건");
    });
  });

  it("어제 노트를 더 체크한 뒤 forceDate 하면 새로 체크한 것만 추가된다", async () => {
    const vault = new InMemoryVault();
    await withFixedToday("2026-09-18", async () => {
      const { engine, settings } = makeEngine(vault, {});
      const prevPath = dailyNotePath(fromIsoDate("2026-09-17"), settings);
      vault.seed(
        prevPath,
        makeDailyNoteMd({ date: "2026-09-17", activeLines: ["- [x] 첫번째", "- [ ] 두번째"] }),
      );
      await engine.createForToday();

      vault.seed(
        prevPath,
        makeDailyNoteMd({ date: "2026-09-17", activeLines: ["- [x] 첫번째", "- [x] 두번째"] }),
      );
      await engine.forceDate(fromIsoDate("2026-09-18"));

      const sum = vault.peek(monthlySummaryPath(fromIsoDate("2026-09-17"), settings))!;
      expect(sum.split("\n").filter((l) => l.includes("첫번째"))).toHaveLength(1);
      expect(sum.split("\n").filter((l) => l.includes("두번째"))).toHaveLength(1);
      const today = vault.peek(dailyNotePath(fromIsoDate("2026-09-18"), settings))!;
      expect(today).not.toContain("두번째");
    });
  });
});
