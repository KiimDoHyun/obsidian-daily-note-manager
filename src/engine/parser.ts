import {
  CARRYOVER_SECTION_HEADERS,
  CARRYOVER_SEPARATOR,
  MARKER_ARCHIVE,
  MARKER_LONG,
  SECTION_MEMO,
  TODO_SECTION_HEADERS,
} from "./constants";

// 알려진 섹션 헤더 목록. 사용자가 헤더 뒤에 카운트나 코멘트를 덧붙여도
// 이 접두어로 시작하기만 하면 canonical 이름으로 정규화해 이월 항목이 소실되지 않게 한다.
const KNOWN_SECTION_HEADERS: readonly string[] = [
  ...TODO_SECTION_HEADERS,
  ...CARRYOVER_SECTION_HEADERS,
  SECTION_MEMO,
];
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
      current = canonicalizeHeader(stripped);
      if (!sections.has(current)) sections.set(current, []);
    } else if (current !== null) {
      sections.get(current)!.push(line);
    }
  }
  return sections;
}

// 알려진 섹션 이름으로 시작하는 헤더는 canonical 이름으로 정규화한다.
// 사용자가 헤더 뒤에 카운트 `(3)`, 카운트 뒤 코멘트, 공백을 넣은 카운트 `( 3 )`,
// 비숫자 카운트 `(three)` 등 무엇을 덧붙여도 이월 항목이 통째로 소실되지 않는다.
// 알려진 이름과 매칭 안 되면 원문 그대로 반환하여 사용자 정의 섹션은 그대로 보존한다.
function canonicalizeHeader(headerLine: string): string {
  for (const known of KNOWN_SECTION_HEADERS) {
    if (headerLine === known) return known;
    // 정확히 알려진 이름 뒤에 공백/탭이 있는 경우만 매칭.
    // `## ✅ 이월된 할일FOO` 처럼 이름에 딱 붙는 다른 문자는 별개 헤더로 취급.
    if (headerLine.startsWith(known + " ") || headerLine.startsWith(known + "\t")) {
      return known;
    }
  }
  return headerLine;
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
      // 이월 섹션의 블록 사이 시각적 구분선(정확히 CARRYOVER_SEPARATOR 인 라인) 만 걸러낸다.
      // 사용자가 하위 메모에 `---` 나 다른 형태의 가로선을 손으로 넣은 경우는 그대로 보존.
      // 정확 일치(trim 없음) 로 검사하므로 들여쓴 자식 라인도 영향 없음.
      if (isCarryover && raw === CARRYOVER_SEPARATOR) continue;
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
