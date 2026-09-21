import { addDays, mmddOf, sameYearMonth, toIsoDate, today as todayDate, ymOf } from "../dateutil";
import { parseDailyNoteText } from "../parser";
import { dailyNotePath, monthlySummaryPath } from "../paths";
import type { DailyNoteSettings } from "../../settings";
import type { VaultLike } from "../vault";

export type TimelineStatus = "done" | "active" | "crit";
export type TimelineSection = "완료" | "진행중" | "드롭";

export interface TimelineItem {
  name: string;
  section: TimelineSection;
  status: TimelineStatus;
  start: Date;
  end: Date;
  /** 원본 데일리 노트에 있던 하위 항목/메모 (들여쓰기 유지된 raw 라인들) */
  children: string[];
}

const COMPLETED_SAMEDAY_RE = /^- (\d{2})-(\d{2}) (.+?) \(당일\)$/;
const COMPLETED_DURATION_RE = /^- (\d{2})-(\d{2}) (.+?) \((\d+)영업일 소요, (\d{2})-(\d{2}) 시작\)$/;
const DROPPED_IMMEDIATE_RE = /^- (\d{2})-(\d{2}) (.+?) \(즉시 드롭\)$/;
const DROPPED_NO_ORIGIN_RE = /^- (\d{2})-(\d{2}) (.+?) \((\d+)영업일 이월 후 드롭\)$/;
const DROPPED_WITH_ORIGIN_RE = /^- (\d{2})-(\d{2}) (.+?) \((\d{2})-(\d{2}) 시작, (\d+)영업일 이월 후 드롭\)$/;

const SUMMARY_COMPLETED_HEADER = "### ✅ 완료";
const SUMMARY_DROPPED_HEADER = "### ⏭️ 드롭";

const TIMELINE_SECTION_HEADER = "## 📊 타임라인";

/**
 * 월간 종합 문서에 `## 📊 타임라인` 섹션을 upsert.
 * 이 섹션이 이미 있으면 다음 `## ` 헤더 직전까지 통째로 교체, 없으면
 * `## 📈 이번 달 요약` 블록 다음(첫 `## N주차` 직전)에 새로 삽입.
 */
export async function upsertTimelineSection(
  month: Date,
  vault: VaultLike,
  settings: DailyNoteSettings,
): Promise<void> {
  const summaryP = monthlySummaryPath(month, settings);
  if (!vault.exists(summaryP)) return;

  const items = await collectTimelineItems(month, vault, settings);
  const raw = await vault.read(summaryP);
  const next = replaceOrInsertTimeline(raw, renderTimelineBlock(month, items));
  await vault.write(summaryP, next);
}

export async function collectTimelineItems(
  month: Date,
  vault: VaultLike,
  settings: DailyNoteSettings,
): Promise<TimelineItem[]> {
  const items: TimelineItem[] = [];

  const summaryP = monthlySummaryPath(month, settings);
  if (vault.exists(summaryP)) {
    const raw = await vault.read(summaryP);
    const summaryItems = extractFromSummary(raw, month.getFullYear());
    for (const item of summaryItems) {
      await attachChildrenFromEventNote(item, vault, settings);
      items.push(item);
    }
  }

  const today = todayDate();
  if (sameYearMonth(today, month)) {
    const todayP = dailyNotePath(today, settings);
    if (vault.exists(todayP)) {
      const raw = await vault.read(todayP);
      const parsed = parseDailyNoteText(raw, today);
      for (const block of parsed.carryoverBlocks) {
        if (block.originDate && !block.isCompleted && !block.isDroppedImmediate) {
          items.push({
            name: block.topText,
            section: "진행중",
            status: "active",
            start: block.originDate,
            end: today,
            children: block.children,
          });
        }
      }
    }
  }
  return items;
}

/**
 * 완료/드롭 이벤트 라인에는 children 정보가 없으므로,
 * 이벤트 발생일의 데일리 노트를 파싱해 같은 name 을 가진 블록의 children 을 복원.
 */
async function attachChildrenFromEventNote(
  item: TimelineItem,
  vault: VaultLike,
  settings: DailyNoteSettings,
): Promise<void> {
  const notePath = dailyNotePath(item.end, settings);
  if (!vault.exists(notePath)) return;
  try {
    const raw = await vault.read(notePath);
    const parsed = parseDailyNoteText(raw, item.end);
    const all = [...parsed.activeBlocks, ...parsed.carryoverBlocks];
    for (const block of all) {
      if (block.topText === item.name) {
        item.children = block.children;
        return;
      }
    }
  } catch (err) {
    console.warn("[daily-note] attachChildrenFromEventNote failed", item.name, err);
  }
}

function replaceOrInsertTimeline(raw: string, block: string[]): string {
  const lines = raw.split(/\r?\n/);
  const out: string[] = [];
  let i = 0;
  const n = lines.length;
  let inserted = false;

  // 이미 있으면 교체
  while (i < n) {
    if (lines[i] === TIMELINE_SECTION_HEADER) {
      out.push(...block);
      i++;
      while (i < n && !lines[i].startsWith("## ")) i++;
      inserted = true;
      continue;
    }
    out.push(lines[i]);
    i++;
  }
  if (inserted) return out.join("\n");

  // 없으면 첫 `## N주차` 직전에 삽입
  const inserted2: string[] = [];
  let done = false;
  for (const line of out) {
    if (!done && /^## \d+주차 /.test(line)) {
      inserted2.push(...block);
      done = true;
    }
    inserted2.push(line);
  }
  if (!done) inserted2.push("", ...block);
  return inserted2.join("\n");
}

function renderTimelineBlock(month: Date, items: TimelineItem[]): string[] {
  const done = items.filter((i) => i.section === "완료");
  const active = items.filter((i) => i.section === "진행중");
  const crit = items.filter((i) => i.section === "드롭");
  const ym = ymOf(month);

  const block: string[] = [
    TIMELINE_SECTION_HEADER,
    `> 완료 ${done.length} · 진행중 ${active.length} · 드롭 ${crit.length}`,
    "",
  ];

  if (items.length === 0) {
    block.push("_이번 달 이벤트 없음._", "");
    return block;
  }

  block.push("```mermaid", "gantt", `    title ${ym} 업무 타임라인`);
  block.push("    dateFormat YYYY-MM-DD");
  block.push("    axisFormat %m-%d");
  block.push("    excludes weekends");
  block.push("");

  const emit = (title: string, list: TimelineItem[]) => {
    if (list.length === 0) return;
    block.push(`    section ${title}`);
    for (const item of list) {
      block.push(`    ${sanitizeName(item.name)} :${item.status}, ${formatRange(item)}`);
    }
    block.push("");
  };
  emit("진행중", active);
  emit("완료", done);
  emit("드롭", crit);
  block.push("```", "");
  return block;
}

function extractFromSummary(text: string, year: number): TimelineItem[] {
  const lines = text.split(/\r?\n/);
  const items: TimelineItem[] = [];
  let section: "completed" | "dropped" | null = null;

  for (const line of lines) {
    if (line.startsWith("## ")) {
      section = null;
      continue;
    }
    if (line.startsWith("### ")) {
      if (line === SUMMARY_COMPLETED_HEADER) section = "completed";
      else if (line === SUMMARY_DROPPED_HEADER) section = "dropped";
      else section = null;
      continue;
    }
    if (!section) continue;

    const item = section === "completed"
      ? parseCompletedLine(line, year)
      : parseDroppedLine(line, year);
    if (item) items.push(item);
  }
  return items;
}

function parseCompletedLine(line: string, year: number): TimelineItem | null {
  const same = COMPLETED_SAMEDAY_RE.exec(line);
  if (same) {
    const end = new Date(year, parseInt(same[1], 10) - 1, parseInt(same[2], 10));
    return { name: same[3], section: "완료", status: "done", start: end, end, children: [] };
  }
  const dur = COMPLETED_DURATION_RE.exec(line);
  if (dur) {
    const end = new Date(year, parseInt(dur[1], 10) - 1, parseInt(dur[2], 10));
    const start = new Date(year, parseInt(dur[5], 10) - 1, parseInt(dur[6], 10));
    return { name: dur[3], section: "완료", status: "done", start, end, children: [] };
  }
  return null;
}

function parseDroppedLine(line: string, year: number): TimelineItem | null {
  const imm = DROPPED_IMMEDIATE_RE.exec(line);
  if (imm) {
    const end = new Date(year, parseInt(imm[1], 10) - 1, parseInt(imm[2], 10));
    return { name: imm[3], section: "드롭", status: "crit", start: end, end, children: [] };
  }
  const withOrigin = DROPPED_WITH_ORIGIN_RE.exec(line);
  if (withOrigin) {
    const end = new Date(year, parseInt(withOrigin[1], 10) - 1, parseInt(withOrigin[2], 10));
    const start = new Date(year, parseInt(withOrigin[4], 10) - 1, parseInt(withOrigin[5], 10));
    return { name: withOrigin[3], section: "드롭", status: "crit", start, end, children: [] };
  }
  const noOrigin = DROPPED_NO_ORIGIN_RE.exec(line);
  if (noOrigin) {
    const end = new Date(year, parseInt(noOrigin[1], 10) - 1, parseInt(noOrigin[2], 10));
    return { name: noOrigin[3], section: "드롭", status: "crit", start: end, end, children: [] };
  }
  return null;
}

/** Mermaid Gantt 태스크명에서 특수문자 제거 (: , # 는 문법 충돌) */
function sanitizeName(name: string): string {
  return name.replace(/[:,#]/g, "").replace(/\s+/g, " ").trim().slice(0, 40);
}

function formatRange(item: TimelineItem): string {
  const s = toIsoDate(item.start);
  if (item.start.getTime() === item.end.getTime()) return `${s}, 1d`;
  // Mermaid 는 end 를 exclusive 로 처리. 완료·드롭일도 시각화에 포함되도록 +1일.
  const endExclusive = toIsoDate(addDays(item.end, 1));
  return `${s}, ${endExclusive}`;
}
