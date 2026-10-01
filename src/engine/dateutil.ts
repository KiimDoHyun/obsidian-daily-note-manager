/**
 * 모든 날짜 계산은 로컬 캘린더 기준. 시간 부분은 무시.
 * `new Date(y, m-1, d)` 는 로컬 자정을 생성하므로 타임존 함정을 피할 수 있다.
 */

export function today(): Date {
  const n = new Date();
  return new Date(n.getFullYear(), n.getMonth(), n.getDate());
}

export function toIsoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function fromIsoDate(s: string): Date {
  const [y, m, d] = s.split("-").map((n) => parseInt(n, 10));
  return new Date(y, m - 1, d);
}

export function addDays(d: Date, days: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + days);
}

export function isWeekend(d: Date): boolean {
  const w = d.getDay();
  return w === 0 || w === 6;
}

export function previousBusinessDay(d: Date): Date {
  let prev = addDays(d, -1);
  while (isWeekend(prev)) prev = addDays(prev, -1);
  return prev;
}

export function nextBusinessDay(d: Date): Date {
  let nxt = addDays(d, 1);
  while (isWeekend(nxt)) nxt = addDays(nxt, 1);
  return nxt;
}

export function businessDaysBetween(start: Date, end: Date): number {
  if (end <= start) return 0;
  let count = 0;
  let cur = start;
  while (cur < end) {
    cur = addDays(cur, 1);
    if (!isWeekend(cur)) count++;
  }
  return count;
}

/** 양 끝 포함, 주말 제외 영업일 수. Gantt 라벨용. */
export function businessDaysInSpan(start: Date, end: Date): number {
  if (end < start) return 0;
  let count = 0;
  let cur = start;
  while (cur <= end) {
    if (!isWeekend(cur)) count++;
    cur = addDays(cur, 1);
  }
  return count;
}

export function sameYearMonth(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth();
}

export function ymOf(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export function mmddOf(d: Date): string {
  return `${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** 시작 연도를 찾을 때 거슬러 볼 최대 햇수. 윤년 주기(4년)의 두 배라 02-29 도 찾는다. */
const ORIGIN_YEAR_SEARCH_LIMIT = 8;
/**
 * 이월 1일이 달력으로 대략 며칠인지. 주말 제외(영업일 5일 = 달력 7일, 1.4)와
 * 주말 포함(1.0)의 중간값을 써서 두 설정 모두 약 2.5년 이월까지 오차가 반년 안에 든다.
 */
const CALENDAR_DAYS_PER_CARRYOVER_DAY = 1.2;

/**
 * 이월 태그에서 파싱한 MM-DD 로 원본 연도를 유추한다. 태그에는 연도가 없다.
 * 이월 일수로 시작일을 대략 추정하고(note_date − 일수 × 1.2일), note_date 이전의 MM-DD 가운데
 * 그 추정치에 가장 가까운 해를 고른다.
 * - 1년 넘게 이월된 #장기 항목도 올바른 해가 나온다.
 * - 태그 일수가 실제 경과와 하루 이틀 어긋나도(손편집·예전 버전) 해를 잘못 넘기지 않는다.
 * - 02-29 처럼 그해에 없는 날짜는 다음 달로 넘어가 버리므로(3월 1일) 그런 해는 건너뛴다.
 * - 02-31 처럼 어느 해에도 없는 날짜는 후보가 없으므로, note_date 이전의 가장 최근 MM-DD
 *   (Date 가 넘겨 준 날짜)로 돌아간다.
 */
export function resolveOriginDate(
  noteDate: Date,
  mm: number,
  dd: number,
  carryoverDays: number = 0,
): Date {
  const estimate = addDays(noteDate, -Math.round(carryoverDays * CALENDAR_DAYS_PER_CARRYOVER_DAY));
  let best: Date | null = null;
  const y0 = noteDate.getFullYear();
  for (let y = y0; y > y0 - ORIGIN_YEAR_SEARCH_LIMIT; y--) {
    const candidate = new Date(y, mm - 1, dd);
    if (candidate.getMonth() !== mm - 1 || candidate > noteDate) continue;
    const dist = Math.abs(candidate.getTime() - estimate.getTime());
    if (best === null || dist < Math.abs(best.getTime() - estimate.getTime())) best = candidate;
  }
  if (best !== null) return best;
  const fallback = new Date(y0, mm - 1, dd);
  return fallback > noteDate ? new Date(y0 - 1, mm - 1, dd) : fallback;
}

/** JS weekday: Sun=0..Sat=6 → 월요일 기반: Mon=0..Sun=6 */
function mondayBasedWeekday(d: Date): number {
  return (d.getDay() + 6) % 7;
}

export function firstOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

export function lastOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0);
}

/**
 * 월 안의 몇 번째 주인가.
 * 1일이 포함된 주가 1주차, 월~금 기준.
 */
export function weekOfMonth(d: Date): number {
  const first = firstOfMonth(d);
  const firstWd = mondayBasedWeekday(first);
  if (firstWd === 0) return Math.floor((d.getDate() - 1) / 7) + 1;
  const firstMondayDay = 8 - firstWd;
  if (d.getDate() < firstMondayDay) return 1;
  return Math.floor((d.getDate() - firstMondayDay) / 7) + 2;
}

export interface WeekRange {
  num: number;
  start: Date;
  end: Date;
}

/** 한 달의 모든 주차 (월~금 범위, 월경계 잘라냄) */
export function allWeeksOfMonth(anyDay: Date): WeekRange[] {
  const first = firstOfMonth(anyDay);
  const last = lastOfMonth(anyDay);
  const firstWd = mondayBasedWeekday(first);

  const ranges: WeekRange[] = [];
  let cur: Date;
  let weekNum: number;

  if (firstWd === 0) {
    const end = new Date(Math.min(addDays(first, 4).getTime(), last.getTime()));
    ranges.push({ num: 1, start: first, end });
    cur = addDays(first, 7);
    weekNum = 2;
  } else {
    const firstMondayDay = 8 - firstWd;
    if (firstMondayDay > last.getDate()) {
      ranges.push({ num: 1, start: first, end: last });
      return ranges;
    }
    const firstMonday = new Date(first.getFullYear(), first.getMonth(), firstMondayDay);
    ranges.push({ num: 1, start: first, end: addDays(firstMonday, -1) });
    cur = firstMonday;
    weekNum = 2;
  }

  while (cur <= last) {
    const end = new Date(Math.min(addDays(cur, 4).getTime(), last.getTime()));
    ranges.push({ num: weekNum, start: cur, end });
    cur = addDays(cur, 7);
    weekNum++;
  }

  return ranges;
}
