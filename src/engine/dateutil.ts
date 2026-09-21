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
 * 태그에는 연도가 없으므로 note_date 기준으로 판단:
 * 후보 > note_date 면 작년으로 간주.
 */
export function resolveOriginDate(noteDate: Date, mm: number, dd: number): Date {
  const y = noteDate.getFullYear();
  let candidate = new Date(y, mm - 1, dd);
  if (candidate > noteDate) candidate = new Date(y - 1, mm - 1, dd);
  return candidate;
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
