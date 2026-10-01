import {
  CARRYOVER_SEPARATOR,
  CARRYOVER_TAG_MARKER,
  DROP_WARNING_TEXT,
  DROPPED_TODAY_TITLE,
  FOOTER_TEMPLATE,
  SECTION_CARRYOVER_NEW,
  SECTION_MEMO,
  SECTION_TODO_NEW,
  WARN_ORANGE,
  WARN_RED,
} from "../constants";
import { mmddOf, toIsoDate, ymOf } from "../dateutil";
import { monthlyDropWikilink, monthlySummaryWikilink } from "../paths";
import type { DatedEvent, TaskBlock } from "../types";
import type { DailyNoteSettings } from "../../settings";

export function renderDailyNote(
  today: Date,
  carryingOver: TaskBlock[],
  settings: DailyNoteSettings,
  /** 이번 실행에서 자동 드롭된 항목. date 는 드롭 직전 마지막으로 노트에 있었던 날. */
  autoDropped: Pick<DatedEvent, "block" | "date">[] = [],
): string {
  const sorted = [...carryingOver].sort((a, b) => b.carryoverDays - a.carryoverDays);
  const warnOrange = Math.max(1, settings.dropThresholdDays - settings.warnOrangeDaysBeforeDrop);
  const warnRed = Math.max(1, settings.dropThresholdDays - settings.warnRedDaysBeforeDrop);
  // 블록 사이에 빈 줄 + 구분선 + 빈 줄 을 넣어 이월 항목을 시각적으로 구분한다.
  // 파서는 이 구분선(정확히 CARRYOVER_SEPARATOR 문자열) 만 자식에서 걸러내므로
  // 사용자가 하위 메모에 넣은 `---` 등 다른 형태의 구분선은 그대로 보존된다.
  const carryBody = sorted
    .map((b) => renderSingleBlock(b, warnOrange, warnRed))
    .reduce<string[]>((acc, block, i) => {
      if (i > 0) acc.push("", CARRYOVER_SEPARATOR, "");
      acc.push(...block);
      return acc;
    }, [])
    .join("\n");
  const footer = FOOTER_TEMPLATE.replace("{summary_link}", monthlySummaryWikilink(today, settings))
    .replace("{drop_link}", monthlyDropWikilink(today, settings))
    .replace("{drop_days}", String(settings.dropThresholdDays));

  const parts: string[] = [
    "---",
    `date: ${toIsoDate(today)}`,
    "tags: [daily]",
    "---",
    "",
    `# ${toIsoDate(today)} 데일리`,
    "",
    SECTION_TODO_NEW,
    "- [ ] ",
    "- [ ] ",
    "- [ ] ",
    "",
    // 이월 헤더는 canonical 이름으로 고정(아웃라인 뷰에서 매일 이름 안 바뀌게).
    // 카운트는 헤더 바로 아래 blockquote 로 별도 라인 배치.
    SECTION_CARRYOVER_NEW,
    `> 오늘 이월 ${sorted.length}건`,
  ];
  // carryBody 가 있을 때만 blockquote 와 사이에 blank 삽입.
  // 없으면 blockquote 바로 다음에 memo 헤더 앞 구조적 blank 만 들어가도록.
  if (carryBody) parts.push("", carryBody);
  parts.push("", SECTION_MEMO, "", "", footer, "");
  // 오늘 드롭된 업무는 참고용이라 노트 최하단에 둔다. 빈 줄 없이 `---` 를 붙이면 마크다운이
  // 바로 윗줄(링크 줄)을 제목으로 바꿔 버리므로 위의 "" 가 반드시 필요하다.
  if (autoDropped.length > 0) parts.push("---", ...renderDroppedToday(autoDropped, settings), "");
  return parts.join("\n");
}

function renderDroppedToday(
  items: Pick<DatedEvent, "block" | "date">[],
  settings: DailyNoteSettings,
): string[] {
  const sorted = [...items].sort((a, b) => a.date.getTime() - b.date.getTime());
  const months: Date[] = [];
  for (const { date } of sorted) {
    if (!months.some((m) => ymOf(m) === ymOf(date))) months.push(date);
  }
  const links = months.map((m) => monthlyDropWikilink(m, settings)).join(" · ");
  const title =
    `**${DROPPED_TODAY_TITLE} ${sorted.length}건** ` +
    `(이월 ${settings.dropThresholdDays}일째 도달 · ${links})`;
  // 체크박스가 아닌 점 목록: 눌러서 처리할 할 일로 오해하지 않게 하고, 파서가 읽을 일도 없다.
  // 항목 이름이 `[ ]` 처럼 대괄호로 시작하면 점 목록이 체크박스로 렌더되므로 대괄호를 이스케이프한다.
  // 날짜는 마지막으로 노트에 남아 있던 날이라 "~까지 이월 후 드롭" 으로 적는다(제목의 "오늘" 과
  // 헷갈리지 않게). 일수는 주말 제외 설정에 따라 영업일·달력일이 섞이므로 "일" 로만 적는다.
  const lines = sorted.map(({ block, date }) => {
    const name = block.topText.startsWith("[") ? `\\${block.topText}` : block.topText;
    const origin = block.originDate ? `${mmddOf(block.originDate)} 시작, ` : "";
    return `- ${name} (${origin}${mmddOf(date)}까지 ${block.carryoverDays}일 이월 후 드롭)`;
  });
  return [title, ...lines];
}

function renderSingleBlock(block: TaskBlock, warnOrange: number, warnRed: number): string[] {
  return [renderTopLine(block, warnOrange, warnRed), ...block.children];
}

function renderTopLine(block: TaskBlock, warnOrange: number, warnRed: number): string {
  const origin = block.originDate ? mmddOf(block.originDate) : "??-??";
  // 이모지 앞머리로 이월 태그 시작을 표시. 굵게(**) 를 안 써서 사용자 항목 이름의
  // 별표와 짝 어긋남이 발생하지 않는다.
  const tag = `(${CARRYOVER_TAG_MARKER} ${block.carryoverDays}일째 이월, ${origin}~)`;
  // 드롭 경고 이모지는 라인 맨 앞이 아니라 별도 괄호 안에 넣는다.
  // 앞에 붙이면 마크다운 파서가 라인을 리스트로 인식하지 못해 체크박스·하위 항목이 깨진다.
  let suffix = "";
  if (!block.hasLongMarker) {
    if (block.carryoverDays >= warnRed) {
      suffix = ` (${WARN_RED} ${DROP_WARNING_TEXT})`;
    } else if (block.carryoverDays >= warnOrange) {
      suffix = ` (${WARN_ORANGE} ${DROP_WARNING_TEXT})`;
    }
  }
  return `- [ ] ${block.topText} ${tag}${suffix}`;
}
