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

/**
 * 이월 태그에서 파싱한 MM-DD 로 원본 연도를 유추.
 * 태그에는 연도가 없으므로 note_date 기준으로 판단한다.
 * N일째 이월이면 이월 한 번마다 최소 하루가 지났으므로 시작일은 note_date 보다 최소 N일 앞이다.
 * 그 조건을 만족하는 가장 최근의 MM-DD 를 고른다. 1년 넘게 이월된 #장기 항목도 올바른 해가 나온다.
 */
export function resolveOriginDate(
  noteDate: Date,
  mm: number,
  dd: number,
  carryoverDays: number = 0,
): Date {
  const latest = addDays(noteDate, -carryoverDays);
  // 02-29 처럼 그해에 없는 날짜는 다음 달로 넘어가 버리므로(3월 1일) 그런 해는 건너뛴다.
  // 사용자가 02-31 같은 존재하지 않는 날짜를 적으면 어느 해도 맞지 않으므로 최대 8년만 거슬러 본다
  // (윤년 주기 4년의 두 배). 못 찾으면 예전 규칙(가장 최근의 같은 MM-DD)으로 돌아간다.
  for (let y = latest.getFullYear(); y > latest.getFullYear() - 8; y--) {
    const candidate = new Date(y, mm - 1, dd);
    if (candidate <= latest && candidate.getMonth() === mm - 1) return candidate;
  }
  const fallback = new Date(noteDate.getFullYear(), mm - 1, dd);
  return fallback > noteDate ? new Date(noteDate.getFullYear() - 1, mm - 1, dd) : fallback;
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
