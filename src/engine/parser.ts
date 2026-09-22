import {
  CARRYOVER_SECTION_HEADERS,
  CARRYOVER_SEPARATOR,
  CARRYOVER_TAG_MARKER,
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
// 이월 태그 앞머리는 세 포맷을 모두 인정한다.
//   - 최신: `(⏰ N일째 이월, ...)` — 별표 미사용, 사용자 텍스트 별표와 충돌 없음
//   - 중간: `(**N일째** 이월, ...)` — 굵게, 짧게 존재했던 포맷
//   - 옛: `(N일째 이월, ...)` — 최초 포맷
const CARRYOVER_TAG_RE = new RegExp(
  `\\s*\\((?:${CARRYOVER_TAG_MARKER} )?(?:\\*\\*)?(?<days>\\d+)일째(?:\\*\\*)? 이월, ` +
    `(?<mm>\\d{2})-(?<dd>\\d{2})~\\)(\\s*\\((?:🟠 |🔴 )?드롭 예정입니다\\))?\\s*$`,
);

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
  // 코드펜스(```, ~~~) 안의 `## ` 는 실제 헤더가 아니라 코드 예시이므로 섹션 경계로 취급 안 함.
  // 백틱과 물결표(tilde) 각각 독립적으로 짝짓지만, 대부분 노트에서는 백틱만 쓴다.
  let openFence: string | null = null;
  for (const line of lines) {
    const stripped = line.replace(/\s+$/, "");
    const fenceMatch = /^(```|~~~)/.exec(stripped);
    if (fenceMatch) {
      const fence = fenceMatch[1];
      if (openFence === null) openFence = fence;
      else if (openFence === fence) openFence = null;
      // 코드펜스 라인 자체도 섹션 내용으로 유지
      if (current !== null) sections.get(current)!.push(line);
      continue;
    }
    if (openFence === null && stripped.startsWith("## ")) {
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
  // 라이터는 이월 블록 사이에 항상 `["", CARRYOVER_SEPARATOR, ""]` 짝으로 삽입한다.
  // 구분선을 만나면 그 앞뒤 구조적 빈 줄도 함께 걷어내야 왕복 시 blank 이 누적되지 않는다.
  // 사용자가 자식 안에 직접 넣은 blank 은 이 처리와 무관하게 그대로 보존된다.
  let skipNextBlank = false;

  const finalizeCurrent = (isLast: boolean) => {
    if (current === null) return;
    // 마지막 블록만 뒤 섹션 헤더 앞의 구조적 blank 1개를 제거.
    // 중간 블록은 구분선 스마트 처리에서 이미 정리되므로 trim 불필요.
    // 그 이상의 trailing blank 은 사용자 편집으로 보고 보존.
    let children = currentChildren;
    if (isLast && children.length > 0 && children[children.length - 1] === "") {
      children = children.slice(0, -1);
    }
    current.children = children;
    blocks.push(current);
  };

  for (const raw of lines) {
    if (isTopLevelLine(raw)) {
      finalizeCurrent(false);
      current = newBlockFromLine(raw, noteDate, isCarryover);
      currentChildren = [];
      skipNextBlank = false;
    } else {
      if (current === null) continue;
      if (isCarryover && raw === CARRYOVER_SEPARATOR) {
        // 구조적 blank 짝의 앞쪽: 마지막 자식이 blank 이면 걷어냄.
        if (currentChildren.length > 0 && currentChildren[currentChildren.length - 1] === "") {
          currentChildren.pop();
        }
        // 구조적 blank 짝의 뒤쪽: 다음 blank 라인을 스킵.
        skipNextBlank = true;
        continue;
      }
      if (skipNextBlank) {
        skipNextBlank = false;
        if (raw === "") continue;
      }
      currentChildren.push(raw);
    }
  }
  finalizeCurrent(true);
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

function stripFooter(memoLines: string[]): string[] {
  const out: string[] = [];
  for (const line of memoLines) {
    if (line.startsWith("---")) break;
    out.push(line);
  }
  while (out.length > 0 && out[out.length - 1].trim() === "") out.pop();
  return out;
}
