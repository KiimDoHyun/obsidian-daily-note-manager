import {
  CARRYOVER_SECTION_HEADERS,
  MARKER_ARCHIVE,
  MARKER_LONG,
  SECTION_MEMO,
  TODO_SECTION_HEADERS,
} from "./constants";
import { resolveOriginDate } from "./dateutil";
import type { DailyNoteParsed, TaskBlock } from "./types";
import { makeBlock } from "./types";

const TOP_LEVEL_LINE_RE = /^(?<warn>🟠 |🔴 )?- \[(?<check>[ x-])\] (?<text>.*)$/;

// 드롭 경고 접미부는 두 포맷을 모두 인정한다.
//   - 옛 포맷: `(드롭 예정입니다)`  (이모지는 라인 맨 앞)
//   - 새 포맷: `(🟠 드롭 예정입니다)` / `(🔴 드롭 예정입니다)`
// `**N일째**` 굵게 포맷과 옛 `N일째` 포맷 모두 인정한다.
const CARRYOVER_TAG_RE =
  /\s*\((?:\*\*)?(?<days>\d+)일째(?:\*\*)? 이월, (?<mm>\d{2})-(?<dd>\d{2})~\)(\s*\((?:🟠 |🔴 )?드롭 예정입니다\))?\s*$/;

export function parseDailyNoteText(text: string, noteDate: Date): DailyNoteParsed {
  const lines = text.split(/\r?\n/);
  const sections = splitSections(lines);
  const todoLines = pickSection(sections, TODO_SECTION_HEADERS);
  const carryLines = pickSection(sections, CARRYOVER_SECTION_HEADERS);
  const memoLines = pickSection(sections, [SECTION_MEMO]);

  return {
    noteDate,
    activeBlocks: parseBlocks(todoLines, noteDate, false),
    carryoverBlocks: parseBlocks(carryLines, noteDate, true),
    memoLines: stripFooter(memoLines),
  };
}

function splitSections(lines: string[]): Map<string, string[]> {
  const sections = new Map<string, string[]>();
  let current: string | null = null;
  for (const line of lines) {
    const stripped = line.replace(/\s+$/, "");
    if (stripped.startsWith("## ")) {
      // 이월 섹션은 헤더 끝에 ` (N)` 카운트가 붙는다. 매칭 키에서는 카운트를 떼서
      // 카운트 유무와 무관하게 pickSection 이 인식하도록 한다.
      current = stripped.replace(/\s*\(\d+\)$/, "");
      if (!sections.has(current)) sections.set(current, []);
    } else if (current !== null) {
      sections.get(current)!.push(line);
    }
  }
  return sections;
}

function pickSection(sections: Map<string, string[]>, candidates: readonly string[]): string[] {
  for (const header of candidates) {
    const v = sections.get(header);
    if (v) return v;
  }
  return [];
}

function parseBlocks(lines: string[], noteDate: Date, isCarryover: boolean): TaskBlock[] {
  const blocks: TaskBlock[] = [];
  let current: TaskBlock | null = null;
  let currentChildren: string[] = [];

  for (const raw of lines) {
    if (isTopLevelLine(raw)) {
      if (current !== null) {
        current.children = trimTrailingBlank(currentChildren);
        blocks.push(current);
      }
      current = newBlockFromLine(raw, noteDate, isCarryover);
      currentChildren = [];
    } else {
      if (current === null) continue;
      // 이월 섹션의 블록 사이 시각적 구분선(--- 만 있는 라인)은 자식으로 취급하지 않는다.
      // 재렌더링 시 라이터가 다시 구분선을 삽입하므로, 걸러내지 않으면 블록에 눌러붙어 중복된다.
      if (isCarryover && raw.trim() === "---") continue;
      currentChildren.push(raw);
    }
  }
  if (current !== null) {
    current.children = trimTrailingBlank(currentChildren);
    blocks.push(current);
  }
  return blocks;
}

function isTopLevelLine(line: string): boolean {
  if (!line) return false;
  if (line.startsWith(" ") || line.startsWith("\t")) return false;
  return TOP_LEVEL_LINE_RE.test(line);
}

function newBlockFromLine(line: string, noteDate: Date, isCarryover: boolean): TaskBlock {
  const m = TOP_LEVEL_LINE_RE.exec(line);
  if (!m || !m.groups) throw new Error(`unexpected top-level line: ${line}`);
  const check = m.groups.check;
  let text = m.groups.text;

  const isCompleted = check === "x";
  const isDroppedImmediate = check === "-";

  let carryoverDays = 0;
  let originDate: Date | null = null;
  if (isCarryover) {
    const tag = CARRYOVER_TAG_RE.exec(text);
    if (tag && tag.groups) {
      carryoverDays = parseInt(tag.groups.days, 10);
      originDate = resolveOriginDate(
        noteDate,
        parseInt(tag.groups.mm, 10),
        parseInt(tag.groups.dd, 10),
      );
      text = text.substring(0, tag.index).replace(/\s+$/, "");
    }
  }

  return makeBlock({
    topText: text,
    isCompleted,
    isDroppedImmediate,
    hasArchiveMarker: text.includes(MARKER_ARCHIVE),
    hasLongMarker: text.includes(MARKER_LONG),
    carryoverDays,
    originDate,
  });
}

function trimTrailingBlank(children: string[]): string[] {
  let end = children.length;
  while (end > 0 && children[end - 1].trim() === "") end--;
  return children.slice(0, end);
}

function stripFooter(memoLines: string[]): string[] {
  const out: string[] = [];
  for (const line of memoLines) {
    if (line.startsWith("---")) break;
    out.push(line);
  }
  while (out.length > 0 && out[out.length - 1].trim() === "") out.pop();
  return out;
}
