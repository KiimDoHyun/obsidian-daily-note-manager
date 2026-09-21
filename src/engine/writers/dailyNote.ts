import {
  DROP_WARNING_SUFFIX,
  FOOTER_TEMPLATE,
  SECTION_CARRYOVER_NEW,
  SECTION_MEMO,
  SECTION_TODO_NEW,
  WARN_ORANGE,
  WARN_ORANGE_DAY,
  WARN_RED,
  WARN_RED_DAY,
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
  const carryBody = sorted.map(renderSingleBlock).flat().join("\n");
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
    SECTION_CARRYOVER_NEW,
  ];
  if (carryBody) parts.push(carryBody);
  parts.push("", SECTION_MEMO, "", "", footer, "");
  return parts.join("\n");
}

function renderSingleBlock(block: TaskBlock): string[] {
  return [renderTopLine(block), ...block.children];
}

function renderTopLine(block: TaskBlock): string {
  const origin = block.originDate ? mmddOf(block.originDate) : "??-??";
  const tag = `(${block.carryoverDays}일째 이월, ${origin}~)`;
  let prefix = "";
  let suffix = "";
  if (!block.hasLongMarker) {
    if (block.carryoverDays === WARN_ORANGE_DAY) {
      prefix = `${WARN_ORANGE} `;
      suffix = ` ${DROP_WARNING_SUFFIX}`;
    } else if (block.carryoverDays >= WARN_RED_DAY) {
      prefix = `${WARN_RED} `;
      suffix = ` ${DROP_WARNING_SUFFIX}`;
    }
  }
  return `${prefix}- [ ] ${block.topText} ${tag}${suffix}`;
}
