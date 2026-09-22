import {
  CARRYOVER_SEPARATOR,
  DROP_WARNING_TEXT,
  FOOTER_TEMPLATE,
  SECTION_CARRYOVER_NEW,
  SECTION_MEMO,
  SECTION_TODO_NEW,
  WARN_ORANGE,
  WARN_RED,
} from "../constants";
import { mmddOf, toIsoDate } from "../dateutil";
import { monthlyDropWikilink, monthlySummaryWikilink } from "../paths";
import type { TaskBlock } from "../types";
import type { DailyNoteSettings } from "../../settings";

export function renderDailyNote(
  today: Date,
  carryingOver: TaskBlock[],
  settings: DailyNoteSettings,
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
    .replace("{drop_link}", monthlyDropWikilink(today, settings));

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
    `${SECTION_CARRYOVER_NEW} (${sorted.length})`,
  ];
  if (carryBody) parts.push(carryBody);
  parts.push("", SECTION_MEMO, "", "", footer, "");
  return parts.join("\n");
}

function renderSingleBlock(block: TaskBlock, warnOrange: number, warnRed: number): string[] {
  return [renderTopLine(block, warnOrange, warnRed), ...block.children];
}

function renderTopLine(block: TaskBlock, warnOrange: number, warnRed: number): string {
  const origin = block.originDate ? mmddOf(block.originDate) : "??-??";
  const tag = `(**${block.carryoverDays}일째** 이월, ${origin}~)`;
  // 마커 이모지는 라인 맨 앞이 아니라 드롭 경고 괄호 안에 넣는다.
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
