/**
 * i18n 설계 검증: language 설정과 무관하게 데이터 파일 포맷·파싱·상태 전이는 동일해야 한다.
 * 즉 UI 언어만 스위칭되고 노트 생성 내용은 언어 독립적이어야 함.
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

function makeEngine(vault: InMemoryVault, override: Partial<DailyNoteSettings> = {}) {
  const s = makeSettings({ autoRunOnLoad: false, ...override });
  const engine = new Engine(vault, s, async () => {}, "test-vault");
  return { engine, settings: s };
}

describe("Engine 은 language 설정과 무관하게 동일한 파일 포맷 생성", () => {
  let vault: InMemoryVault;
  beforeEach(() => {
    vault = new InMemoryVault();
  });

  it("language=en 이어도 데일리 노트 섹션은 여전히 '## 📌 할일' 등 한글 포맷", async () => {
    await withFixedToday("2026-09-15", async () => {
      const { engine, settings } = makeEngine(vault, { language: "en" });
      vault.seed(
        dailyNotePath(fromIsoDate("2026-09-14"), settings),
        makeDailyNoteMd({ date: "2026-09-14", activeLines: ["- [ ] Task X"] }),
      );
      await engine.createForToday();
      const md = vault.peek(dailyNotePath(fromIsoDate("2026-09-15"), settings))!;
      expect(md).toContain("## 📌 할일");
      expect(md).toContain("## ✅ 이월된 할일");
      expect(md).toContain("## 💬 메모");
      expect(md).toContain("(1일째 이월, 09-14~)");
    });
  });

  it("language=ko 결과와 language=en 결과가 내용 일치", async () => {
    const vaultKo = new InMemoryVault();
    const vaultEn = new InMemoryVault();
    await withFixedToday("2026-09-15", async () => {
      const { engine: engKo, settings: sKo } = makeEngine(vaultKo, { language: "ko" });
      const { engine: engEn, settings: sEn } = makeEngine(vaultEn, { language: "en" });

      const seed = makeDailyNoteMd({
        date: "2026-09-14",
        activeLines: ["- [x] Done", "- [ ] Carry"],
      });
      vaultKo.seed(dailyNotePath(fromIsoDate("2026-09-14"), sKo), seed);
      vaultEn.seed(dailyNotePath(fromIsoDate("2026-09-14"), sEn), seed);

      await engKo.createForToday();
      await engEn.createForToday();

      const mdKo = vaultKo.peek(dailyNotePath(fromIsoDate("2026-09-15"), sKo))!;
      const mdEn = vaultEn.peek(dailyNotePath(fromIsoDate("2026-09-15"), sEn))!;
      expect(mdKo).toBe(mdEn);

      const sumKo = vaultKo.peek(monthlySummaryPath(fromIsoDate("2026-09-14"), sKo))!;
      const sumEn = vaultEn.peek(monthlySummaryPath(fromIsoDate("2026-09-14"), sEn))!;
      expect(sumKo).toBe(sumEn);
    });
  });

  it("파서는 language 설정을 참조하지 않음 (한글 노트를 language=en 에서도 정상 파싱)", async () => {
    await withFixedToday("2026-09-15", async () => {
      const { engine, settings } = makeEngine(vault, { language: "en" });
      vault.seed(
        dailyNotePath(fromIsoDate("2026-09-14"), settings),
        makeDailyNoteMd({
          date: "2026-09-14",
          activeLines: ["- [x] English mode 완료 처리"],
        }),
      );
      const res = await engine.createForToday();
      expect(res.created).toBe(true);
      expect(res.completed).toBe(1);
      const summary = vault.peek(monthlySummaryPath(fromIsoDate("2026-09-14"), settings))!;
      expect(summary).toContain("English mode 완료 처리");
    });
  });
});

describe("CreateResult 는 구조화된 카운트 반환", () => {
  it("counts 필드가 정확", async () => {
    const vault = new InMemoryVault();
    await withFixedToday("2026-09-15", async () => {
      const { engine, settings } = makeEngine(vault);
      vault.seed(
        dailyNotePath(fromIsoDate("2026-09-14"), settings),
        makeDailyNoteMd({
          date: "2026-09-14",
          activeLines: ["- [x] A", "- [x] B", "- [ ] C", "- [-] D", "- [ ] E #보관"],
        }),
      );
      const res = await engine.createForToday();
      expect(res.completed).toBe(2);
      expect(res.dropped).toBe(1);
      expect(res.archived).toBe(1);
      expect(res.carriedOver).toBe(1);
    });
  });
});
