import { sameYearMonth, today as todayDate } from "../dateutil";
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
  /** #장기 마커. 진행중 항목 드롭 경고 면제용 */
  hasLongMarker: boolean;
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
 * 과거 버전이 월간 종합 문서에 삽입해두었던 `## 📊 타임라인` 섹션을 제거.
 * 타임라인은 이제 전용 뷰에서만 시각화한다.
 */
export async function stripTimelineSection(
  month: Date,
  vault: VaultLike,
  settings: DailyNoteSettings,
): Promise<void> {
  const summaryP = monthlySummaryPath(month, settings);
  if (!vault.exists(summaryP)) return;
  const raw = await vault.read(summaryP);
  const next = removeTimelineSection(raw);
  if (next !== raw) await vault.write(summaryP, next);
}

export async function collectTimelineItems(
  month: Date,
  vault: VaultLike,
  settings: DailyNoteSettings,
): Promise<TimelineItem[]> {
  const items: TimelineItem[] = [];

  // 월간 종합 문서: 이 달의 완료·드롭 이벤트 (누적 로그)
  const summaryP = monthlySummaryPath(month, settings);
  if (vault.exists(summaryP)) {
    try {
      const raw = await vault.read(summaryP);
      const summaryItems = extractFromSummary(raw, month.getFullYear());
      for (const item of summaryItems) {
        await attachChildrenFromEventNote(item, vault, settings);
        items.push(item);
      }
    } catch (err) {
      console.warn("[daily-note] 월간 종합 파싱 실패:", summaryP, err);
    }
  }

  // 오늘 데일리 노트: 현재 진행중인 이월 항목
  const today = todayDate();
  if (sameYearMonth(today, month)) {
    const todayP = dailyNotePath(today, settings);
    if (vault.exists(todayP)) {
      try {
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
              hasLongMarker: block.hasLongMarker,
            });
          }
        }
      } catch (err) {
        console.warn("[daily-note] 오늘 데일리 노트 파싱 실패:", todayP, err);
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
        item.hasLongMarker = block.hasLongMarker;
        return;
      }
    }
  } catch (err) {
    console.warn("[daily-note] attachChildrenFromEventNote failed", item.name, err);
  }
}

function removeTimelineSection(raw: string): string {
  const lines = raw.split(/\r?\n/);
  const out: string[] = [];
  let i = 0;
  const n = lines.length;
  while (i < n) {
    if (lines[i] === TIMELINE_SECTION_HEADER) {
      i++;
      while (i < n && !lines[i].startsWith("## ")) i++;
      while (out.length > 0 && out[out.length - 1] === "") out.pop();
      if (i < n) out.push("");
      continue;
    }
    out.push(lines[i]);
    i++;
  }
  return out.join("\n");
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
    return { name: same[3], section: "완료", status: "done", start: end, end, children: [], hasLongMarker: false };
  }
  const dur = COMPLETED_DURATION_RE.exec(line);
  if (dur) {
    const end = new Date(year, parseInt(dur[1], 10) - 1, parseInt(dur[2], 10));
    const start = new Date(year, parseInt(dur[5], 10) - 1, parseInt(dur[6], 10));
    return { name: dur[3], section: "완료", status: "done", start, end, children: [], hasLongMarker: false };
  }
  return null;
}

function parseDroppedLine(line: string, year: number): TimelineItem | null {
  const imm = DROPPED_IMMEDIATE_RE.exec(line);
  if (imm) {
    const end = new Date(year, parseInt(imm[1], 10) - 1, parseInt(imm[2], 10));
    return { name: imm[3], section: "드롭", status: "crit", start: end, end, children: [], hasLongMarker: false };
  }
  const withOrigin = DROPPED_WITH_ORIGIN_RE.exec(line);
  if (withOrigin) {
    const end = new Date(year, parseInt(withOrigin[1], 10) - 1, parseInt(withOrigin[2], 10));
    const start = new Date(year, parseInt(withOrigin[4], 10) - 1, parseInt(withOrigin[5], 10));
    return { name: withOrigin[3], section: "드롭", status: "crit", start, end, children: [], hasLongMarker: false };
  }
  const noOrigin = DROPPED_NO_ORIGIN_RE.exec(line);
  if (noOrigin) {
    const end = new Date(year, parseInt(noOrigin[1], 10) - 1, parseInt(noOrigin[2], 10));
    return { name: noOrigin[3], section: "드롭", status: "crit", start: end, end, children: [], hasLongMarker: false };
  }
  return null;
}
