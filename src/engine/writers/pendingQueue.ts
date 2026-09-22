import type { DailyNoteSettings } from "../../settings";
import { fromIsoDate, toIsoDate } from "../dateutil";
import type { TaskBlock } from "../types";
import type { VaultLike } from "../vault";
import { appendEvent, type SummaryEventType } from "./monthlySummary";

/**
 * 월간 종합·드롭·보관 문서 쓰기가 실패했을 때 이벤트를 임시 보관하는 대기열.
 *
 * 파일 위치: `<notesSubdir>/_대기 완료 로그.md`
 *
 * 저장 형식 결정:
 * - 사용자가 문서를 열어봤을 때 스캔 가능해야 하므로 리스트로 항목을 나열.
 * - 파서가 확실히 왕복 가능해야 하므로 각 항목을 하나의 JSON 라인으로 직렬화하여
 *   ```queue 코드펜스 안에 넣는다. 위쪽 리스트는 사람이 읽을 요약,
 *   아래 코드펜스는 재시도용 원본 데이터를 담는다.
 * - 큐가 비면 파일을 지운다(청결성).
 */

const QUEUE_FILE_BASENAME = "_대기 완료 로그.md";
const CODE_FENCE_START = "```queue";
const CODE_FENCE_END = "```";

export interface PendingEntry {
  eventType: SummaryEventType;
  eventDate: string; // ISO YYYY-MM-DD
  targetSummaryPath: string;
  block: TaskBlock;
}

export function pendingQueuePath(settings: DailyNoteSettings): string {
  return `${settings.notesSubdir}/${QUEUE_FILE_BASENAME}`;
}

export async function enqueue(
  entry: PendingEntry,
  vault: VaultLike,
  settings: DailyNoteSettings,
): Promise<void> {
  const current = await readQueue(vault, settings);
  current.push(entry);
  await writeQueue(current, vault, settings);
}

export async function readQueue(
  vault: VaultLike,
  settings: DailyNoteSettings,
): Promise<PendingEntry[]> {
  const path = pendingQueuePath(settings);
  if (!vault.exists(path)) return [];
  let raw: string;
  try {
    raw = await vault.read(path);
  } catch {
    return [];
  }
  return parseQueueFile(raw);
}

export async function writeQueue(
  entries: PendingEntry[],
  vault: VaultLike,
  settings: DailyNoteSettings,
): Promise<void> {
  const path = pendingQueuePath(settings);
  if (entries.length === 0) {
    if (vault.exists(path)) await vault.remove(path);
    return;
  }
  await vault.write(path, renderQueueFile(entries));
}

export interface DrainResult {
  drained: number;
  remaining: number;
}

export async function drainQueue(
  vault: VaultLike,
  settings: DailyNoteSettings,
): Promise<DrainResult> {
  const entries = await readQueue(vault, settings);
  if (entries.length === 0) return { drained: 0, remaining: 0 };

  const survivors: PendingEntry[] = [];
  let drained = 0;
  for (const entry of entries) {
    try {
      await appendEvent(
        entry.targetSummaryPath,
        entry.eventType,
        fromIsoDate(entry.eventDate),
        entry.block,
        vault,
      );
      drained++;
    } catch (err) {
      console.warn(
        "[daily-note] 대기열 재시도 실패:",
        entry.targetSummaryPath,
        entry.eventType,
        entry.eventDate,
        err,
      );
      survivors.push(entry);
    }
  }
  await writeQueue(survivors, vault, settings);
  return { drained, remaining: survivors.length };
}

// ---------- 직렬화 ----------

function renderQueueFile(entries: PendingEntry[]): string {
  const lines: string[] = [
    "---",
    "tags: [pending-queue]",
    "---",
    "",
    "# 대기 완료 로그",
    "",
    "> [!warning] 이 파일은 플러그인이 자동으로 관리합니다",
    "> 월간 종합/드롭/보관 문서에 로그를 쓰지 못했을 때 임시로 쌓아두는 대기열입니다.",
    "> 각 실행마다 자동 재시도되며, 성공하면 항목이 사라집니다. 큐가 비면 파일 자체가 삭제됩니다.",
    "> 대상 문서의 구조를 직접 고쳤다면 명령어 `대기열 지금 처리`를 실행하세요.",
    "",
    "## 대기 중 항목",
    "",
  ];
  for (const entry of entries) {
    lines.push(renderHumanLine(entry));
  }
  lines.push("");
  lines.push("## 재시도 데이터 (플러그인 전용)");
  lines.push("");
  lines.push(CODE_FENCE_START);
  for (const entry of entries) {
    lines.push(serializeEntry(entry));
  }
  lines.push(CODE_FENCE_END);
  lines.push("");
  return lines.join("\n");
}

function renderHumanLine(entry: PendingEntry): string {
  const label = eventLabelKo(entry.eventType);
  const path = entry.targetSummaryPath;
  const text = entry.block.topText;
  return `- [${entry.eventDate}] ${label} — ${text} → \`${path}\``;
}

function eventLabelKo(t: SummaryEventType): string {
  switch (t) {
    case "completed":
      return "완료";
    case "dropped":
      return "드롭";
    case "archived":
      return "보관";
  }
}

function serializeEntry(entry: PendingEntry): string {
  return JSON.stringify({
    eventType: entry.eventType,
    eventDate: entry.eventDate,
    targetSummaryPath: entry.targetSummaryPath,
    block: serializeBlock(entry.block),
  });
}

interface SerializedBlock {
  topText: string;
  children: string[];
  isCompleted: boolean;
  isDroppedImmediate: boolean;
  hasArchiveMarker: boolean;
  hasLongMarker: boolean;
  carryoverDays: number;
  originDate: string | null;
}

function serializeBlock(b: TaskBlock): SerializedBlock {
  return {
    topText: b.topText,
    children: b.children,
    isCompleted: b.isCompleted,
    isDroppedImmediate: b.isDroppedImmediate,
    hasArchiveMarker: b.hasArchiveMarker,
    hasLongMarker: b.hasLongMarker,
    carryoverDays: b.carryoverDays,
    originDate: b.originDate ? toIsoDate(b.originDate) : null,
  };
}

function deserializeBlock(raw: SerializedBlock): TaskBlock {
  return {
    topText: raw.topText,
    children: Array.isArray(raw.children) ? raw.children : [],
    isCompleted: !!raw.isCompleted,
    isDroppedImmediate: !!raw.isDroppedImmediate,
    hasArchiveMarker: !!raw.hasArchiveMarker,
    hasLongMarker: !!raw.hasLongMarker,
    carryoverDays: typeof raw.carryoverDays === "number" ? raw.carryoverDays : 0,
    originDate: raw.originDate ? fromIsoDate(raw.originDate) : null,
  };
}

export function parseQueueFile(raw: string): PendingEntry[] {
  const lines = raw.split(/\r?\n/);
  const entries: PendingEntry[] = [];
  let inFence = false;
  for (const line of lines) {
    if (!inFence) {
      if (line.trim() === CODE_FENCE_START) inFence = true;
      continue;
    }
    if (line.trim() === CODE_FENCE_END) {
      inFence = false;
      continue;
    }
    const trimmed = line.trim();
    if (!trimmed) continue;
    const parsed = tryParseEntry(trimmed);
    if (parsed) entries.push(parsed);
  }
  return entries;
}

function tryParseEntry(line: string): PendingEntry | null {
  try {
    const obj = JSON.parse(line) as {
      eventType?: SummaryEventType;
      eventDate?: string;
      targetSummaryPath?: string;
      block?: SerializedBlock;
    };
    if (!obj || typeof obj !== "object") return null;
    if (!obj.eventType || !obj.eventDate || !obj.targetSummaryPath || !obj.block) return null;
    if (!isValidType(obj.eventType)) return null;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(obj.eventDate)) return null;
    return {
      eventType: obj.eventType,
      eventDate: obj.eventDate,
      targetSummaryPath: obj.targetSummaryPath,
      block: deserializeBlock(obj.block),
    };
  } catch {
    return null;
  }
}

function isValidType(t: string): t is SummaryEventType {
  return t === "completed" || t === "dropped" || t === "archived";
}
