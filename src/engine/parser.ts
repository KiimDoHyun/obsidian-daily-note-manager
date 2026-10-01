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

// 옵시디언은 `-`·`*`·`+` 목록 기호와 대괄호 안 아무 한 글자를 모두 체크박스로 렌더한다.
//   - `x`/`X` → 완료, `-` → 즉시 드롭, 그 밖(공백, `/`, `>` 등) → 미완료.
// 편집기가 끝 공백을 지운 빈 체크박스(`- [ ]`) 도 독립 항목으로 잡아 앞 항목 자식으로 흡수되지 않게 한다.
const TOP_LEVEL_LINE_RE = /^(?<warn>🟠 |🔴 )?[-*+] \[(?<check>[^\[\]])\](?: (?<text>.*))?$/;

// 드롭 경고 접미부는 두 포맷을 모두 인정한다.
//   - 옛 포맷: `(드롭 예정입니다)`  (이모지는 라인 맨 앞)
//   - 새 포맷: `(🟠 드롭 예정입니다)` / `(🔴 드롭 예정입니다)`
// 이월 태그 앞머리는 세 포맷을 모두 인정한다.
//   - 최신: `(⏰ N일째 이월, ...)` — 별표 미사용, 사용자 텍스트 별표와 충돌 없음
//   - 중간: `(**N일째** 이월, ...)` — 굵게, 짧게 존재했던 포맷
//   - 옛: `(N일째 이월, ...)` — 최초 포맷
// 시작일을 모를 때 라이터가 쓰는 `??-??` 도 인정한다.
// 줄 끝에 고정하지 않는다. 사용자가 태그 뒤에 글을 덧붙여도 일수를 읽고, 덧붙인 글은 항목 이름에 남긴다.
const CARRYOVER_TAG_RE = new RegExp(
  `\\s*\\((?:${CARRYOVER_TAG_MARKER} )?(?:\\*\\*)?(?<days>\\d+)일째(?:\\*\\*)? 이월, ` +
    `(?:(?<mm>\\d{2})-(?<dd>\\d{2})|\\?\\?-\\?\\?)~\\)(\\s*\\((?:🟠 |🔴 )?드롭 예정입니다\\))?`,
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
    if (stripped.startsWith("## ")) {
      const canonical = canonicalizeHeader(stripped);
      const isKnown = KNOWN_SECTION_HEADERS.includes(canonical);
      // 알려진 canonical 헤더(할일·이월·메모) 는 코드펜스 안에서도 실제 헤더로 인정한다.
      // 사용자가 fence 를 실수로 열고 닫지 않아도 이월 섹션이 소실되지 않도록 방어.
      // 사이드이펙트: 사용자가 코드블록으로 이 플러그인의 헤더 이름을 문서화하면 그것도
      // 헤더로 오인하지만, 미닫힌 fence 로 인한 데이터 손실보다 사소한 트레이드오프.
      if (isKnown || openFence === null) {
        if (isKnown && openFence !== null) openFence = null; // 미닫힌 fence 리셋
        current = canonical;
        if (!sections.has(current)) sections.set(current, []);
        continue;
      }
    }
    if (current !== null) sections.get(current)!.push(line);
  }
  return sections;
}

// 알려진 섹션 이름으로 시작하는 헤더는 canonical 이름으로 정규화한다.
// 사용자가 헤더 뒤에 카운트 `(3)`, 카운트 뒤 코멘트, 공백을 넣은 카운트 `( 3 )`,
// 비숫자 카운트 `(three)`, 공백 없이 붙은 카운트 `(3)` 등 무엇을 덧붙여도 이월 항목이
// 통째로 소실되지 않는다. 알려진 이름과 매칭 안 되면 원문 그대로 반환하여 사용자
// 정의 섹션은 그대로 보존한다.
function canonicalizeHeader(headerLine: string): string {
  for (const known of KNOWN_SECTION_HEADERS) {
    if (headerLine === known) return known;
    if (!headerLine.startsWith(known)) continue;
    const rest = headerLine.slice(known.length);
    // 이름 바로 뒤 문자가 글자/숫자면 별개 헤더로 취급 (예: `## ✅ 이월된 할일FOO`).
    // 공백·구두점(괄호, 대괄호, 대시 등) 이 오면 canonical 로 정규화하여 사용자 편집에 관대.
    if (!/^[\p{L}\p{N}]/u.test(rest)) return known;
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

// 옵시디언 태그는 글자·숫자·`_`·`-` 가 이어지는 한 하나의 태그다. `#장기프로젝트` 는 `#장기` 와 다른 태그.
// `/` 는 하위 태그 구분자라 `#장기/연구` 는 `#장기` 의 하위로 보고 마커로 인정한다.
function hasTag(text: string, tag: string): boolean {
  let from = 0;
  for (let i = text.indexOf(tag, from); i !== -1; i = text.indexOf(tag, from)) {
    const next = text.charAt(i + tag.length);
    if (!/[\p{L}\p{N}_-]/u.test(next)) return true;
    from = i + tag.length;
  }
  return false;
}

function newBlockFromLine(line: string, noteDate: Date, isCarryover: boolean): TaskBlock {
  const m = TOP_LEVEL_LINE_RE.exec(line);
  if (!m || !m.groups) throw new Error(`unexpected top-level line: ${line}`);
  const check = m.groups.check;
  let text = m.groups.text ?? "";

  const isCompleted = check === "x" || check === "X";
  const isDroppedImmediate = check === "-";

  let carryoverDays = 0;
  let originDate: Date | null = null;
  if (isCarryover) {
    const tag = CARRYOVER_TAG_RE.exec(text);
    if (tag && tag.groups) {
      carryoverDays = parseInt(tag.groups.days, 10);
      originDate =
        tag.groups.mm === undefined
          ? null
          : resolveOriginDate(
              noteDate,
              parseInt(tag.groups.mm, 10),
              parseInt(tag.groups.dd, 10),
              carryoverDays,
            );
      // 태그 자리를 걷어내고 앞뒤 사용자 글을 이어 붙인다. 예전 버그로 태그가 겹쳐 쌓인 줄도
      // 나머지 태그까지 걷어내 한 개로 수렴시킨다(일수는 첫 태그 기준).
      const before = text.substring(0, tag.index).replace(/\s+$/, "");
      let after = text.substring(tag.index + tag[0].length);
      for (let extra = CARRYOVER_TAG_RE.exec(after); extra; extra = CARRYOVER_TAG_RE.exec(after)) {
        after = after.substring(0, extra.index) + after.substring(extra.index + extra[0].length);
      }
      after = after.trim();
      text = after ? `${before} ${after}` : before;
    }
  }

  return makeBlock({
    topText: text,
    isCompleted,
    isDroppedImmediate,
    hasArchiveMarker: hasTag(text, MARKER_ARCHIVE),
    hasLongMarker: hasTag(text, MARKER_LONG),
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
