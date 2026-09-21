/**
 * 설정 UI 의 '드롭 임계' 와 '경고 임계' 가 실제로 로직에 연결됐는지 검증.
 * 이전에 이 값들이 하드코딩된 상수만 참조하고 있어 설정을 바꿔도 반영되지 않던 버그가 있었음.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { Engine } from "../../src/engine";
import { fromIsoDate } from "../../src/engine/dateutil";
import { dailyNotePath } from "../../src/engine/paths";
import { InMemoryVault } from "../helpers/inMemoryVault";
import { makeDailyNoteMd, makeSettings } from "../helpers/fixtures";
import type { DailyNoteSettings } from "../../src/settings";

function withFixedToday<T>(iso: string, fn: () => T | Promise<T>): Promise<T> {
  const orig = Date;
  const [y, m, d] = iso.split("-").map((n) => parseInt(n, 10));
  const target = new orig(y, m - 1, d).getTime();
  // @ts-expect-error monkey patch
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

function makeEngine(vault: InMemoryVault, override: Partial<DailyNoteSettings> = {}) {
  const s = makeSettings({ autoRunOnLoad: false, ...override });
  const engine = new Engine(vault, s, async () => {}, "test-vault");
  return { engine, settings: s };
}

describe("dropThresholdDays 설정 배선", () => {
  let vault: InMemoryVault;
  beforeEach(() => {
    vault = new InMemoryVault();
  });

  it("기본값 5: 4일째 이월 → 5일째 도달 → 드롭", async () => {
    await withFixedToday("2026-09-15", async () => {
      const { engine, settings } = makeEngine(vault);
      vault.seed(
        dailyNotePath(fromIsoDate("2026-09-14"), settings),
        makeDailyNoteMd({
          date: "2026-09-14",
          activeLines: [],
          carryoverLines: ["- [ ] Old (4일째 이월, 09-08~)"],
        }),
      );
      const res = await engine.createForToday();
      expect(res.dropped).toBe(1);
    });
  });

  it("커스텀 임계 3: 2일째 이월 → 3일째 도달 → 드롭", async () => {
    await withFixedToday("2026-09-15", async () => {
      const { engine, settings } = makeEngine(vault, { dropThresholdDays: 3 });
      vault.seed(
        dailyNotePath(fromIsoDate("2026-09-14"), settings),
        makeDailyNoteMd({
          date: "2026-09-14",
          activeLines: [],
          carryoverLines: ["- [ ] Almost (2일째 이월, 09-11~)"],
        }),
      );
      const res = await engine.createForToday();
      expect(res.dropped).toBe(1);
      expect(res.carriedOver).toBe(0);
    });
  });

  it("커스텀 임계 10: 4일째 이월 → 5일째 도달 → 아직 이월 (드롭 안 됨)", async () => {
    await withFixedToday("2026-09-15", async () => {
      const { engine, settings } = makeEngine(vault, { dropThresholdDays: 10 });
      vault.seed(
        dailyNotePath(fromIsoDate("2026-09-14"), settings),
        makeDailyNoteMd({
          date: "2026-09-14",
          activeLines: [],
          carryoverLines: ["- [ ] Still ok (4일째 이월, 09-08~)"],
        }),
      );
      const res = await engine.createForToday();
      expect(res.dropped).toBe(0);
      expect(res.carriedOver).toBe(1);
    });
  });
});

describe("warnThresholdDays 설정 배선", () => {
  let vault: InMemoryVault;
  beforeEach(() => {
    vault = new InMemoryVault();
  });

  it("기본값 3: 3일째 이월 → 🟠 표시, 4일째 → 🔴 표시", async () => {
    await withFixedToday("2026-09-15", async () => {
      const { engine, settings } = makeEngine(vault);
      vault.seed(
        dailyNotePath(fromIsoDate("2026-09-14"), settings),
        makeDailyNoteMd({
          date: "2026-09-14",
          activeLines: [],
          carryoverLines: [
            "- [ ] Orange (2일째 이월, 09-12~)", // 오늘 3일째
            "- [ ] Red (3일째 이월, 09-11~)", // 오늘 4일째
          ],
        }),
      );
      await engine.createForToday();
      const md = vault.peek(dailyNotePath(fromIsoDate("2026-09-15"), settings))!;
      expect(md).toContain("🟠 - [ ] Orange (3일째 이월, 09-12~) (드롭 예정입니다)");
      expect(md).toContain("🔴 - [ ] Red (4일째 이월, 09-11~) (드롭 예정입니다)");
    });
  });

  it("커스텀 임계 2 + dropThresholdDays 10: 2일째 → 🟠, 3일째 → 🔴, 4일째도 🔴 (아직 드롭 임계 미달)", async () => {
    await withFixedToday("2026-09-15", async () => {
      const { engine, settings } = makeEngine(vault, {
        warnThresholdDays: 2,
        dropThresholdDays: 10,
      });
      vault.seed(
        dailyNotePath(fromIsoDate("2026-09-14"), settings),
        makeDailyNoteMd({
          date: "2026-09-14",
          activeLines: [],
          carryoverLines: [
            "- [ ] Warn1 (1일째 이월, 09-13~)", // 오늘 2일째 → 🟠
            "- [ ] Warn2 (2일째 이월, 09-12~)", // 오늘 3일째 → 🔴
            "- [ ] Warn3 (3일째 이월, 09-11~)", // 오늘 4일째 → 🔴
          ],
        }),
      );
      await engine.createForToday();
      const md = vault.peek(dailyNotePath(fromIsoDate("2026-09-15"), settings))!;
      expect(md).toMatch(/🟠 - \[ \] Warn1 \(2일째 이월/);
      expect(md).toMatch(/🔴 - \[ \] Warn2 \(3일째 이월/);
      expect(md).toMatch(/🔴 - \[ \] Warn3 \(4일째 이월/);
    });
  });

  it("커스텀 임계 5 + dropThresholdDays 10: 3일째·4일째 이월엔 경고 없음 (임계 미달)", async () => {
    await withFixedToday("2026-09-15", async () => {
      const { engine, settings } = makeEngine(vault, {
        warnThresholdDays: 5,
        dropThresholdDays: 10,
      });
      vault.seed(
        dailyNotePath(fromIsoDate("2026-09-14"), settings),
        makeDailyNoteMd({
          date: "2026-09-14",
          activeLines: [],
          carryoverLines: [
            "- [ ] Chill (3일째 이월, 09-09~)", // 오늘 4일째 → 경고 없음
          ],
        }),
      );
      await engine.createForToday();
      const md = vault.peek(dailyNotePath(fromIsoDate("2026-09-15"), settings))!;
      expect(md).not.toContain("🟠");
      expect(md).not.toContain("🔴");
      expect(md).not.toContain("드롭 예정입니다");
      expect(md).toContain("- [ ] Chill (4일째 이월, 09-09~)");
    });
  });
});
