import { DEFAULT_SETTINGS, type DailyNoteSettings } from "../../src/settings";

export function makeSettings(overrides: Partial<DailyNoteSettings> = {}): DailyNoteSettings {
  return { ...DEFAULT_SETTINGS, ...overrides };
}

/**
 * 임의의 데일리 노트 마크다운을 만든다. 실제 write_daily_note 포맷을 그대로 시뮬레이션.
 */
export function makeDailyNoteMd(opts: {
  date: string; // YYYY-MM-DD
  activeLines?: string[]; // ## 📌 할일 아래
  carryoverLines?: string[]; // ## ✅ 이월된 할일 아래
  memoLines?: string[];
}): string {
  const active = opts.activeLines ?? ["- [ ] "];
  const carry = opts.carryoverLines ?? [];
  const memo = opts.memoLines ?? [];
  return [
    "---",
    `date: ${opts.date}`,
    "tags: [daily]",
    "---",
    "",
    `# ${opts.date} 데일리`,
    "",
    "## 📌 할일",
    ...active,
    "",
    "## ✅ 이월된 할일",
    ...carry,
    "",
    "## 💬 메모",
    ...memo,
    "",
    "",
    "---",
    "📎 마커 예시",
    "",
  ].join("\n");
}

/** 옛 섹션명 데일리 노트 (하위호환 테스트용). */
export function makeLegacyDailyNoteMd(opts: {
  date: string;
  goalLines?: string[]; // ## 📌 오늘의 목표
  carryoverLines?: string[]; // ## ✅ 미완료 이월
}): string {
  const goal = opts.goalLines ?? ["- [ ] "];
  const carry = opts.carryoverLines ?? [];
  return [
    "---",
    `date: ${opts.date}`,
    "tags: [daily]",
    "---",
    "",
    `# ${opts.date} 데일리`,
    "",
    "## 📌 오늘의 목표",
    ...goal,
    "",
    "## ✅ 미완료 이월",
    ...carry,
    "",
    "## 💬 메모",
    "",
  ].join("\n");
}
