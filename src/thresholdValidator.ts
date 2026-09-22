import { DEFAULT_SETTINGS, type DailyNoteSettings } from "./settings";

/**
 * 세 개 임계값의 상호 일관성을 검사하고, 무효하면 안전한 기본값으로 되돌린다.
 *
 * 유효 규칙:
 *   1. warnRedDaysBeforeDrop < warnOrangeDaysBeforeDrop
 *      — 빨강은 주황보다 늦게(=드롭에 더 가깝게) 나와야 한다.
 *   2. warnOrangeDaysBeforeDrop < dropThresholdDays
 *      — 주황은 실제 드롭보다 이르게 나와야 한다.
 *   3. warnRedDaysBeforeDrop >= 0, warnOrangeDaysBeforeDrop >= 0
 *   4. dropThresholdDays >= 1
 *
 * 복구:
 *   - 무효 → 먼저 경고 두 값만 기본값(red=1, orange=2)으로 리셋한다.
 *   - 그래도 무효(예: dropThreshold=2 → orange=2 여전히 rule 2 위반) → dropThreshold 도 기본값(5)으로 리셋.
 *   - `fixed` 는 어느 값이라도 실제로 바뀌었는지, `resetDrop` 은 dropThresholdDays 까지 리셋됐는지를 반환.
 */
export interface ThresholdValidationResult {
  fixed: boolean;
  resetDrop: boolean;
}

function isValidCombination(s: {
  dropThresholdDays: number;
  warnOrangeDaysBeforeDrop: number;
  warnRedDaysBeforeDrop: number;
}): boolean {
  if (!Number.isFinite(s.dropThresholdDays) || s.dropThresholdDays < 1) return false;
  if (!Number.isFinite(s.warnOrangeDaysBeforeDrop) || s.warnOrangeDaysBeforeDrop < 0) return false;
  if (!Number.isFinite(s.warnRedDaysBeforeDrop) || s.warnRedDaysBeforeDrop < 0) return false;
  if (!(s.warnRedDaysBeforeDrop < s.warnOrangeDaysBeforeDrop)) return false;
  if (!(s.warnOrangeDaysBeforeDrop < s.dropThresholdDays)) return false;
  return true;
}

export function validateAndFixThresholds(
  settings: DailyNoteSettings,
): ThresholdValidationResult {
  const before = {
    dropThresholdDays: settings.dropThresholdDays,
    warnOrangeDaysBeforeDrop: settings.warnOrangeDaysBeforeDrop,
    warnRedDaysBeforeDrop: settings.warnRedDaysBeforeDrop,
  };

  if (isValidCombination(before)) {
    return { fixed: false, resetDrop: false };
  }

  // 1단계: 경고 두 값만 기본값으로 리셋
  settings.warnRedDaysBeforeDrop = DEFAULT_SETTINGS.warnRedDaysBeforeDrop;
  settings.warnOrangeDaysBeforeDrop = DEFAULT_SETTINGS.warnOrangeDaysBeforeDrop;

  let resetDrop = false;
  if (!isValidCombination({
    dropThresholdDays: settings.dropThresholdDays,
    warnOrangeDaysBeforeDrop: settings.warnOrangeDaysBeforeDrop,
    warnRedDaysBeforeDrop: settings.warnRedDaysBeforeDrop,
  })) {
    // 2단계: dropThreshold 도 기본값으로 리셋
    settings.dropThresholdDays = DEFAULT_SETTINGS.dropThresholdDays;
    resetDrop = true;
  }

  return { fixed: true, resetDrop };
}

/**
 * 리셋 후 사용자에게 보여줄 알림 문자열을 만든다.
 * 두 언어를 섞은 형태 대신 기존 플러그인 알림과 일관되게 한국어로 낸다.
 */
export function formatThresholdResetNotice(
  settings: DailyNoteSettings,
  resetDrop: boolean,
): string {
  const lines = [
    "경고 색깔 조합이 유효하지 않아 기본값으로 되돌렸습니다.",
    "빨강은 주황보다 늦게, 주황은 드롭보다 먼저 나오게 해야 합니다.",
    "빨강을 크게 바꾸려면 주황을 먼저 크게 바꾼 뒤 조정해주세요.",
    `현재: 드롭 ${settings.dropThresholdDays}일 / 주황 ${settings.warnOrangeDaysBeforeDrop}일 전 / 빨강 ${settings.warnRedDaysBeforeDrop}일 전`,
  ];
  if (resetDrop) {
    lines.push("드롭 임계값도 기본값(5일)으로 함께 되돌렸습니다.");
  }
  return lines.join("\n");
}
