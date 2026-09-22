import { describe, it, expect } from "vitest";
import {
  validateAndFixThresholds,
  formatThresholdResetNotice,
} from "../../src/thresholdValidator";
import { DEFAULT_SETTINGS, type DailyNoteSettings } from "../../src/settings";

function makeSettings(overrides: Partial<DailyNoteSettings> = {}): DailyNoteSettings {
  return { ...DEFAULT_SETTINGS, ...overrides };
}

describe("validateAndFixThresholds — 유효한 상태", () => {
  it("기본값(drop=5, orange=2, red=1)은 손대지 않는다", () => {
    const s = makeSettings();
    const r = validateAndFixThresholds(s);
    expect(r).toEqual({ fixed: false, resetDrop: false });
    expect(s.dropThresholdDays).toBe(5);
    expect(s.warnOrangeDaysBeforeDrop).toBe(2);
    expect(s.warnRedDaysBeforeDrop).toBe(1);
  });

  it("drop=10, orange=3, red=1 (모든 규칙 만족) → 손대지 않는다", () => {
    const s = makeSettings({
      dropThresholdDays: 10,
      warnOrangeDaysBeforeDrop: 3,
      warnRedDaysBeforeDrop: 1,
    });
    const r = validateAndFixThresholds(s);
    expect(r).toEqual({ fixed: false, resetDrop: false });
    expect(s.dropThresholdDays).toBe(10);
    expect(s.warnOrangeDaysBeforeDrop).toBe(3);
    expect(s.warnRedDaysBeforeDrop).toBe(1);
  });

  it("경계값: drop=2, orange=1, red=0 (red=0 < orange=1 < drop=2) → 유효", () => {
    const s = makeSettings({
      dropThresholdDays: 2,
      warnOrangeDaysBeforeDrop: 1,
      warnRedDaysBeforeDrop: 0,
    });
    const r = validateAndFixThresholds(s);
    expect(r).toEqual({ fixed: false, resetDrop: false });
  });
});

describe("validateAndFixThresholds — 규칙 위반", () => {
  it("Rule 1 위반: red >= orange (red=3, orange=1, drop=5) → 경고 두 값 리셋", () => {
    const s = makeSettings({
      dropThresholdDays: 5,
      warnOrangeDaysBeforeDrop: 1,
      warnRedDaysBeforeDrop: 3,
    });
    const r = validateAndFixThresholds(s);
    expect(r).toEqual({ fixed: true, resetDrop: false });
    expect(s.warnRedDaysBeforeDrop).toBe(1);
    expect(s.warnOrangeDaysBeforeDrop).toBe(2);
    expect(s.dropThresholdDays).toBe(5);
  });

  it("Rule 1 경계 위반: red == orange (red=2, orange=2, drop=5) → 리셋", () => {
    const s = makeSettings({
      dropThresholdDays: 5,
      warnOrangeDaysBeforeDrop: 2,
      warnRedDaysBeforeDrop: 2,
    });
    const r = validateAndFixThresholds(s);
    expect(r).toEqual({ fixed: true, resetDrop: false });
    expect(s.warnRedDaysBeforeDrop).toBe(1);
    expect(s.warnOrangeDaysBeforeDrop).toBe(2);
  });

  it("Rule 2 위반: orange >= drop (drop=3, orange=3, red=1) → 경고 두 값 리셋 (drop=3 은 유지)", () => {
    const s = makeSettings({
      dropThresholdDays: 3,
      warnOrangeDaysBeforeDrop: 3,
      warnRedDaysBeforeDrop: 1,
    });
    const r = validateAndFixThresholds(s);
    expect(r).toEqual({ fixed: true, resetDrop: false });
    expect(s.dropThresholdDays).toBe(3);
    expect(s.warnOrangeDaysBeforeDrop).toBe(2);
    expect(s.warnRedDaysBeforeDrop).toBe(1);
  });

  it("두 규칙 동시 위반 (red=5, orange=3, drop=3) → 경고 두 값 리셋", () => {
    const s = makeSettings({
      dropThresholdDays: 3,
      warnOrangeDaysBeforeDrop: 3,
      warnRedDaysBeforeDrop: 5,
    });
    const r = validateAndFixThresholds(s);
    expect(r).toEqual({ fixed: true, resetDrop: false });
    expect(s.warnOrangeDaysBeforeDrop).toBe(2);
    expect(s.warnRedDaysBeforeDrop).toBe(1);
    expect(s.dropThresholdDays).toBe(3);
  });
});

describe("validateAndFixThresholds — cascade 리셋", () => {
  it("drop=2, orange=2, red=1 → 경고 리셋 후에도 orange(2)>=drop(2) → drop 도 기본값 리셋", () => {
    const s = makeSettings({
      dropThresholdDays: 2,
      warnOrangeDaysBeforeDrop: 2,
      warnRedDaysBeforeDrop: 1,
    });
    const r = validateAndFixThresholds(s);
    expect(r).toEqual({ fixed: true, resetDrop: true });
    expect(s.dropThresholdDays).toBe(5);
    expect(s.warnOrangeDaysBeforeDrop).toBe(2);
    expect(s.warnRedDaysBeforeDrop).toBe(1);
  });

  it("drop=5, orange=5, red=4 → 경고 리셋만으로 유효 (default 2/1 이 drop=5 안에 들어감)", () => {
    const s = makeSettings({
      dropThresholdDays: 5,
      warnOrangeDaysBeforeDrop: 5,
      warnRedDaysBeforeDrop: 4,
    });
    const r = validateAndFixThresholds(s);
    expect(r).toEqual({ fixed: true, resetDrop: false });
    expect(s.dropThresholdDays).toBe(5);
    expect(s.warnOrangeDaysBeforeDrop).toBe(2);
    expect(s.warnRedDaysBeforeDrop).toBe(1);
  });

  it("drop=1 → 경고 기본값(orange=2)이 안 들어감 → drop 도 기본값 리셋", () => {
    const s = makeSettings({
      dropThresholdDays: 1,
      warnOrangeDaysBeforeDrop: 0,
      warnRedDaysBeforeDrop: 0,
    });
    const r = validateAndFixThresholds(s);
    expect(r).toEqual({ fixed: true, resetDrop: true });
    expect(s.dropThresholdDays).toBe(5);
    expect(s.warnOrangeDaysBeforeDrop).toBe(2);
    expect(s.warnRedDaysBeforeDrop).toBe(1);
  });
});

describe("validateAndFixThresholds — 음수·비정상 값", () => {
  it("red = -1 → 리셋", () => {
    const s = makeSettings({
      dropThresholdDays: 5,
      warnOrangeDaysBeforeDrop: 2,
      warnRedDaysBeforeDrop: -1,
    });
    const r = validateAndFixThresholds(s);
    expect(r.fixed).toBe(true);
    expect(s.warnRedDaysBeforeDrop).toBe(1);
    expect(s.warnOrangeDaysBeforeDrop).toBe(2);
  });

  it("orange = -1 → 리셋", () => {
    const s = makeSettings({
      dropThresholdDays: 5,
      warnOrangeDaysBeforeDrop: -1,
      warnRedDaysBeforeDrop: 1,
    });
    const r = validateAndFixThresholds(s);
    expect(r.fixed).toBe(true);
    expect(s.warnRedDaysBeforeDrop).toBe(1);
    expect(s.warnOrangeDaysBeforeDrop).toBe(2);
  });

  it("drop = 0 → 경고 리셋 후에도 drop 유효성 실패 → drop 도 리셋", () => {
    const s = makeSettings({
      dropThresholdDays: 0,
      warnOrangeDaysBeforeDrop: 2,
      warnRedDaysBeforeDrop: 1,
    });
    const r = validateAndFixThresholds(s);
    expect(r).toEqual({ fixed: true, resetDrop: true });
    expect(s.dropThresholdDays).toBe(5);
  });
});

describe("validateAndFixThresholds — 0 을 포함한 유효 조합", () => {
  it("red=0, orange=1, drop=2 → rule 1 (0<1), rule 2 (1<2) 다 만족 → 손대지 않는다", () => {
    const s = makeSettings({
      dropThresholdDays: 2,
      warnOrangeDaysBeforeDrop: 1,
      warnRedDaysBeforeDrop: 0,
    });
    const r = validateAndFixThresholds(s);
    expect(r).toEqual({ fixed: false, resetDrop: false });
    expect(s.warnRedDaysBeforeDrop).toBe(0);
    expect(s.warnOrangeDaysBeforeDrop).toBe(1);
    expect(s.dropThresholdDays).toBe(2);
  });
});

describe("formatThresholdResetNotice", () => {
  it("resetDrop=false: 현재 값 요약을 포함하되 드롭 리셋 문구는 뺀다", () => {
    const s = makeSettings();
    const msg = formatThresholdResetNotice(s, false);
    expect(msg).toContain("경고 색깔 조합이 유효하지 않아");
    expect(msg).toContain("현재: 드롭 5일 / 주황 2일 전 / 빨강 1일 전");
    expect(msg).not.toContain("드롭 임계값도");
  });

  it("resetDrop=true: 드롭 리셋 안내 문구가 추가된다", () => {
    const s = makeSettings();
    const msg = formatThresholdResetNotice(s, true);
    expect(msg).toContain("드롭 임계값도 기본값(5일)으로 함께 되돌렸습니다.");
  });
});
