import {
  SUMMARY_ARCHIVED_HEADER,
  SUMMARY_COMPLETED_HEADER,
  SUMMARY_DROPPED_HEADER,
  SUMMARY_HEADER_START,
} from "../constants";
import { allWeeksOfMonth, mmddOf, weekOfMonth, ymOf } from "../dateutil";
import { monthlySummaryPath } from "../paths";
import type { DailyNoteSettings } from "../../settings";
import type { TaskBlock } from "../types";
import type { VaultAdapter } from "../vault";

export type SummaryEventType = "completed" | "dropped" | "archived";

const WEEK_HEADER_RE = /^## (\d+)주차 \(\d{2}-\d{2} ~ \d{2}-\d{2}\)$/;
const EVENT_LINE_RE = /^- (\d{2}-\d{2}) (.+)$/;
const COMPLETED_SAME_DAY_RE = /\(당일\)$/;
const COMPLETED_DURATION_RE = /\((\d+)영업일 소요/;

export async function ensureSummary(
  month: Date,
  vault: VaultAdapter,
  settings: DailyNoteSettings,
): Promise<string> {
  const path = monthlySummaryPath(month, settings);
  if (vault.exists(path)) return path;
  const ym = ymOf(month);
  const parts: string[] = [
    "---",
    `tags: [monthly-summary, ${ym}]`,
    "---",
    "",
    `# ${ym} 월간 종합`,
    "",
    "> 이 문서는 스크립트가 매일 자동 갱신합니다.",
    "",
    SUMMARY_HEADER_START,
    "- 완료: 0건",
    "- 드롭: 0건",
    "- 보관 이동: 0건",
    "- 평균 완료 소요: -",
    "",
  ];
  for (const { num, start, end } of allWeeksOfMonth(month)) {
    parts.push(`## ${num}주차 (${mmddOf(start)} ~ ${mmddOf(end)})`);
    parts.push("");
    parts.push(SUMMARY_COMPLETED_HEADER);
    parts.push("");
    parts.push(SUMMARY_DROPPED_HEADER);
    parts.push("");
    parts.push(SUMMARY_ARCHIVED_HEADER);
    parts.push("");
  }
  await vault.write(path, parts.join("\n"));
  return path;
}

export async function appendEvent(
  summaryPath: string,
  eventType: SummaryEventType,
  eventDate: Date,
  block: TaskBlock,
  vault: VaultAdapter,
): Promise<void> {
  const line = formatEventLine(eventType, eventDate, block);
  const raw = await vault.read(summaryPath);
  const lines = raw.split(/\r?\n/);
  const wk = weekOfMonth(eventDate);
  const insertIdx = findInsertionIndex(lines, wk, eventType);
  if (insertIdx === null) {
    throw new Error(`Cannot find week ${wk} + ${eventType} section in ${summaryPath}`);
  }
  lines.splice(insertIdx, 0, line);
  if (insertIdx + 1 < lines.length && /^(### |## )/.test(lines[insertIdx + 1])) {
    lines.splice(insertIdx + 1, 0, "");
  }
  await vault.write(summaryPath, lines.join("\n") + "\n");
}

function findInsertionIndex(
  lines: string[],
  wk: number,
  eventType: SummaryEventType,
): number | null {
  const subsectionHeader = subsectionHeaderOf(eventType);
  let inWeek = false;
  let inSub = false;
  let subHeaderIdx: number | null = null;
  let lastEventIdx: number | null = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const wm = WEEK_HEADER_RE.exec(line);
    if (wm) {
      if (inSub) return resolveInsert(subHeaderIdx, lastEventIdx, i);
      inWeek = parseInt(wm[1], 10) === wk;
      inSub = false;
      subHeaderIdx = null;
      lastEventIdx = null;
      continue;
    }
    if (inWeek && line.startsWith("### ")) {
      if (inSub) return resolveInsert(subHeaderIdx, lastEventIdx, i);
      inSub = line === subsectionHeader;
      subHeaderIdx = inSub ? i : null;
      lastEventIdx = null;
      continue;
    }
    if (inSub && EVENT_LINE_RE.test(line)) {
      lastEventIdx = i;
    }
  }
  if (inSub) return resolveInsert(subHeaderIdx, lastEventIdx, lines.length);
  return null;
}

function resolveInsert(
  subHeaderIdx: number | null,
  lastEventIdx: number | null,
  boundaryIdx: number,
): number {
  if (lastEventIdx !== null) return lastEventIdx + 1;
  if (subHeaderIdx !== null) return subHeaderIdx + 2;
  return boundaryIdx;
}

function subsectionHeaderOf(eventType: SummaryEventType): string {
  switch (eventType) {
    case "completed":
      return SUMMARY_COMPLETED_HEADER;
    case "dropped":
      return SUMMARY_DROPPED_HEADER;
    case "archived":
      return SUMMARY_ARCHIVED_HEADER;
  }
}

function formatEventLine(
  eventType: SummaryEventType,
  eventDate: Date,
  block: TaskBlock,
): string {
  const md = mmddOf(eventDate);
  const text = block.topText;
  if (eventType === "completed") return `- ${md} ${text} ${formatCompletedSuffix(block, eventDate)}`;
  if (eventType === "dropped") return `- ${md} ${text} ${formatDroppedSuffix(block, eventDate)}`;
  return `- ${md} ${text}`;
}

function formatCompletedSuffix(block: TaskBlock, eventDate: Date): string {
  const days = block.carryoverDays;
  if (
    days <= 0 ||
    block.originDate === null ||
    block.originDate.getTime() === eventDate.getTime()
  ) {
    return "(당일)";
  }
  return `(${days}영업일 소요, ${mmddOf(block.originDate)} 시작)`;
}

function formatDroppedSuffix(block: TaskBlock, _eventDate: Date): string {
  if (block.isDroppedImmediate) return "(즉시 드롭)";
  if (block.originDate === null) return `(${block.carryoverDays}영업일 이월 후 드롭)`;
  return `(${mmddOf(block.originDate)} 시작, ${block.carryoverDays}영업일 이월 후 드롭)`;
}

export async function recomputeHeader(summaryPath: string, vault: VaultAdapter): Promise<void> {
  const raw = await vault.read(summaryPath);
  const lines = raw.split(/\r?\n/);
  const completed = collectEvents(lines, SUMMARY_COMPLETED_HEADER);
  const dropped = collectEvents(lines, SUMMARY_DROPPED_HEADER);
  const archived = collectEvents(lines, SUMMARY_ARCHIVED_HEADER);

  const newHeader = [
    SUMMARY_HEADER_START,
    `- 완료: ${completed.length}건`,
    `- 드롭: ${dropped.length}건`,
    `- 보관 이동: ${archived.length}건`,
    `- 평균 완료 소요: ${computeAverageDays(completed)}`,
  ];

  const out = replaceHeaderBlock(lines, newHeader);
  await vault.write(summaryPath, out.join("\n") + "\n");
}

function collectEvents(lines: string[], subsectionHeader: string): string[] {
  const events: string[] = [];
  let inSub = false;
  for (const line of lines) {
    if (line.startsWith("## ")) {
      inSub = false;
      continue;
    }
    if (line.startsWith("### ")) {
      inSub = line === subsectionHeader;
      continue;
    }
    if (inSub && EVENT_LINE_RE.test(line)) events.push(line);
  }
  return events;
}

function computeAverageDays(completed: string[]): string {
  if (completed.length === 0) return "-";
  let total = 0;
  let count = 0;
  for (const line of completed) {
    if (COMPLETED_SAME_DAY_RE.test(line)) {
      count++;
      continue;
    }
    const m = COMPLETED_DURATION_RE.exec(line);
    if (m) {
      total += parseInt(m[1], 10);
      count++;
    }
  }
  if (count === 0) return "-";
  return `${(total / count).toFixed(1)} 영업일`;
}

function replaceHeaderBlock(lines: string[], newHeader: string[]): string[] {
  const out: string[] = [];
  let i = 0;
  const n = lines.length;
  while (i < n) {
    const line = lines[i];
    if (line === SUMMARY_HEADER_START) {
      out.push(...newHeader);
      i++;
      while (i < n && !lines[i].startsWith("##")) i++;
      out.push("");
      continue;
    }
    out.push(line);
    i++;
  }
  return out;
}
