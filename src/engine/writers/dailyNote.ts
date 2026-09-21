import {
  DROP_WARNING_SUFFIX,
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
  const warnOrange = settings.warnThresholdDays;
  const warnRed = settings.warnThresholdDays + 1;
  const carryBody = sorted
    .map((b) => renderSingleBlock(b, warnOrange, warnRed))
    .flat()
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
    SECTION_CARRYOVER_NEW,
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
  const tag = `(${block.carryoverDays}일째 이월, ${origin}~)`;
  let prefix = "";
  let suffix = "";
  if (!block.hasLongMarker) {
    if (block.carryoverDays === warnOrange) {
      prefix = `${WARN_ORANGE} `;
      suffix = ` ${DROP_WARNING_SUFFIX}`;
    } else if (block.carryoverDays >= warnRed) {
      prefix = `${WARN_RED} `;
      suffix = ` ${DROP_WARNING_SUFFIX}`;
    }
  }
  return `${prefix}- [ ] ${block.topText} ${tag}${suffix}`;
}
