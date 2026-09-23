/**
 * 설정 저장 흐름 통합 테스트.
 *
 * 시뮬레이션 대상: Obsidian 1.13+ 선언형 설정 API 도, 1.12 이하 fallback UI 도 결국
 * plugin.saveData(this.settings) 를 호출한다. 따라서 saveData chokepoint 에서 임계값
 * 유효성이 자동 정정되는지, persist 되는 값이 정정 후 값인지, 유효한 조합에는 정정이
 * 일어나지 않는지, Notice 가 한 번만 뜨는지를 검증한다.
 *
 * 리셋 후의 값(orange=2, red=1, drop=5) 이 실제 엔진에서 3일째 🟠 / 4일째 🔴 를
 * 만들어내는지도 재확인해 리셋이 정상 상태를 복원한다는 것을 회귀 방지.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import DailyNoteManagerPlugin from "../../src/main";
import { DEFAULT_SETTINGS, DailyNoteSettingTab, type DailyNoteSettings } from "../../src/settings";
import { validateAndFixThresholds } from "../../src/thresholdValidator";
import { Engine } from "../../src/engine";
import { fromIsoDate } from "../../src/engine/dateutil";
import { dailyNotePath } from "../../src/engine/paths";
import { InMemoryVault } from "../helpers/inMemoryVault";
import { makeDailyNoteMd, makeSettings } from "../helpers/fixtures";
import * as obsidian from "obsidian";

/**
 * Notice 는 new 로만 호출되는 클래스. vi.spyOn 은 함수로 갈아치우면서 constructor 호환성이
 * 깨지므로, mockImplementation 으로 아무 필드 없는 인스턴스를 반환하게 감싼다.
 */
function spyNoticeCtor(): ReturnType<typeof vi.spyOn> {
  return vi.spyOn(obsidian, "Notice").mockImplementation(
    // @ts-expect-error 반환 타입은 Notice 지만 테스트에서는 참조 안 함
    (_msg: string) => ({}),
  );
}

/**
 * onload 를 건너뛰고 saveData 만 노출하는 최소 세팅. 실 코드의 saveData 가 참조하는
 * 필드(settings / engine / settingTab / app.workspace) 만 채운다. super.saveData 로 넘어간
 * 최종 payload 를 관측하기 위해 stub Plugin 의 saveData 를 spy 로 감싼다.
 */
function makeTestPlugin(): {
  plugin: DailyNoteManagerPlugin;
  persistSpy: ReturnType<typeof vi.fn>;
} {
  const persistSpy = vi.fn(async (_data: unknown) => {});
  // Plugin 생성자에는 아무거나 넘겨도 stub 이 무시한다.
  const plugin = new (DailyNoteManagerPlugin as unknown as new (
    a: unknown,
    m: unknown,
  ) => DailyNoteManagerPlugin)({}, {});
  plugin.settings = { ...DEFAULT_SETTINGS };
  (plugin as unknown as { engine: unknown }).engine = {};
  (plugin as unknown as { app: { workspace: { getLeavesOfType: () => unknown[] } } }).app = {
    workspace: { getLeavesOfType: () => [] },
  };
  // super.saveData 가 흘러들어가는 stub Plugin.prototype.saveData 를 이 인스턴스에 한해 대체.
  // (Plugin 은 stub 이므로 spy 로 갈아끼워도 다른 테스트에 영향 없음.)
  const proto = Object.getPrototypeOf(Object.getPrototypeOf(plugin));
  vi.spyOn(proto, "saveData").mockImplementation(persistSpy);
  return { plugin, persistSpy };
}

describe("plugin.saveData — 무효 조합 저장 시 자동 정정", () => {
  let plugin: DailyNoteManagerPlugin;
  let persistSpy: ReturnType<typeof vi.fn>;
  let noticeSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.restoreAllMocks();
    ({ plugin, persistSpy } = makeTestPlugin());
    noticeSpy = spyNoticeCtor();
  });

  it("red > orange 를 저장하면 saveData 가 정정한 값을 persist 하고 Notice 를 한 번 띄운다", async () => {
    plugin.settings.warnRedDaysBeforeDrop = 4; // orange(2) 보다 큼 → 무효
    await plugin.saveData(plugin.settings);
    expect(persistSpy).toHaveBeenCalledTimes(1);
    const snap = persistSpy.mock.calls[0][0] as DailyNoteSettings;
    expect(snap.warnRedDaysBeforeDrop).toBe(1);
    expect(snap.warnOrangeDaysBeforeDrop).toBe(2);
    expect(snap.dropThresholdDays).toBe(5);
    expect(noticeSpy).toHaveBeenCalledTimes(1);
    // in-memory settings 도 함께 정정돼 있어야 다음 저장에도 유효
    expect(plugin.settings.warnRedDaysBeforeDrop).toBe(1);
  });

  it("orange >= drop 을 저장하면 경고만 리셋되고 drop 은 유지된다", async () => {
    plugin.settings.warnOrangeDaysBeforeDrop = 5; // drop(5) 이상 → 무효
    await plugin.saveData(plugin.settings);
    expect(plugin.settings.dropThresholdDays).toBe(5);
    expect(plugin.settings.warnOrangeDaysBeforeDrop).toBe(2);
    expect(plugin.settings.warnRedDaysBeforeDrop).toBe(1);
    expect(noticeSpy).toHaveBeenCalledTimes(1);
  });

  it("drop 을 너무 작게 바꾸면 경고+drop 함께 정정된다 (cascade)", async () => {
    plugin.settings.dropThresholdDays = 2; // orange(2) >= drop(2) → 무효 → cascade
    await plugin.saveData(plugin.settings);
    expect(plugin.settings.dropThresholdDays).toBe(5);
    expect(plugin.settings.warnOrangeDaysBeforeDrop).toBe(2);
    expect(plugin.settings.warnRedDaysBeforeDrop).toBe(1);
    expect(noticeSpy).toHaveBeenCalledTimes(1);
  });

  it("유효한 조합을 저장하면 정정 없이 그대로 persist 되고 Notice 는 뜨지 않는다", async () => {
    plugin.settings.dropThresholdDays = 10;
    plugin.settings.warnOrangeDaysBeforeDrop = 3;
    plugin.settings.warnRedDaysBeforeDrop = 1;
    await plugin.saveData(plugin.settings);
    expect(plugin.settings.dropThresholdDays).toBe(10);
    expect(plugin.settings.warnOrangeDaysBeforeDrop).toBe(3);
    expect(plugin.settings.warnRedDaysBeforeDrop).toBe(1);
    expect(noticeSpy).not.toHaveBeenCalled();
  });

  it("이미 유효한 상태로 저장을 반복해도 Notice 는 계속 뜨지 않는다 (스팸 방지)", async () => {
    await plugin.saveData(plugin.settings);
    await plugin.saveData(plugin.settings);
    await plugin.saveData(plugin.settings);
    expect(noticeSpy).not.toHaveBeenCalled();
  });

  it("정정이 발생하면 열려 있는 설정 탭을 재렌더한다", async () => {
    const updateSpy = vi.fn();
    const tab = { containerEl: {} as HTMLElement, update: updateSpy } as unknown as DailyNoteSettingTab;
    plugin.settingTab = tab;
    plugin.settings.warnRedDaysBeforeDrop = 4; // 무효
    await plugin.saveData(plugin.settings);
    expect(updateSpy).toHaveBeenCalledTimes(1);
  });

  it("정정이 없으면 설정 탭 재렌더도 없다", async () => {
    const updateSpy = vi.fn();
    const tab = { containerEl: {} as HTMLElement, update: updateSpy } as unknown as DailyNoteSettingTab;
    plugin.settingTab = tab;
    await plugin.saveData(plugin.settings); // 기본값 그대로 → 유효
    expect(updateSpy).not.toHaveBeenCalled();
  });
});

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

describe("정정된 값이 엔진 경고 로직에서 정상 작동", () => {
  it("리셋 후 값(drop=5, orange=2, red=1) → 5일 이월 태스크가 3일째 🟠, 4일째 🔴 로 뜬다", async () => {
    // 사용자가 무효 조합을 저장해 트리거된 리셋 후 상태를 재현
    const settings = makeSettings({
      dropThresholdDays: 2,
      warnOrangeDaysBeforeDrop: 2,
      warnRedDaysBeforeDrop: 1,
      autoRunOnLoad: false,
    });
    const result = validateAndFixThresholds(settings);
    expect(result).toEqual({ fixed: true, resetDrop: true });
    // 이제 settings 는 기본값으로 정정된 상태

    await withFixedToday("2026-09-15", async () => {
      const vault = new InMemoryVault();
      const engine = new Engine(vault, settings, async () => {}, "test-vault");
      vault.seed(
        dailyNotePath(fromIsoDate("2026-09-14"), settings),
        makeDailyNoteMd({
          date: "2026-09-14",
          activeLines: [],
          carryoverLines: [
            "- [ ] Orange (2일째 이월, 09-12~)",
            "- [ ] Red (3일째 이월, 09-11~)",
          ],
        }),
      );
      await engine.createForToday();
      const md = vault.peek(dailyNotePath(fromIsoDate("2026-09-15"), settings))!;
      expect(md).toContain("- [ ] Orange (⏰ 3일째 이월, 09-12~) (🟠 드롭 예정입니다)");
      expect(md).toContain("- [ ] Red (⏰ 4일째 이월, 09-11~) (🔴 드롭 예정입니다)");
    });
  });
});
