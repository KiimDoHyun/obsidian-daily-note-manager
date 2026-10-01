import { DEFAULT_SETTINGS, type DailyNoteSettings } from "../../src/settings";
import { fromIsoDate } from "../../src/engine/dateutil";
import { parseDailyNoteText } from "../../src/engine/parser";

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

/**
 * 노트를 실제 파서로 다시 읽어 할일·이월 항목의 이름만 뽑는다.
 * "이 항목이 오늘로 넘어왔는가/안 넘어왔는가" 를 줄 모양(체크박스 문자·접두 기호)에
 * 기대지 않고 확인하기 위한 도구. 노트 맨 아래 드롭 참고 칸은 파서가 읽지 않으므로 섞이지 않는다.
 */
export function carriedNames(noteMd: string, isoDate?: string): string[] {
  // 날짜를 안 주면 노트 머리말(date: YYYY-MM-DD)에서 읽는다. 이름만 볼 때는 날짜가 결과에 영향이 없다.
  const iso = isoDate ?? /^date: (\d{4}-\d{2}-\d{2})$/m.exec(noteMd)?.[1] ?? "2026-01-01";
  const parsed = parseDailyNoteText(noteMd, fromIsoDate(iso));
  return [...parsed.activeBlocks, ...parsed.carryoverBlocks]
    .map((b) => b.topText)
    .filter((t) => t.trim() !== "");
}
