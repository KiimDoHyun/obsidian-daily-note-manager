import { describe, it, expect } from "vitest";
import {
  addDays,
  allWeeksOfMonth,
  businessDaysBetween,
  businessDaysInSpan,
  fromIsoDate,
  isWeekend,
  nextBusinessDay,
  previousBusinessDay,
  resolveOriginDate,
  sameYearMonth,
  toIsoDate,
  weekOfMonth,
} from "../../src/engine/dateutil";

const d = fromIsoDate;

describe("isWeekend", () => {
  it("Sat/Sun 은 true", () => {
    expect(isWeekend(d("2026-09-19"))).toBe(true); // Sat
    expect(isWeekend(d("2026-09-20"))).toBe(true); // Sun
  });
  it("월~금은 false", () => {
    expect(isWeekend(d("2026-09-14"))).toBe(false); // Mon
    expect(isWeekend(d("2026-09-18"))).toBe(false); // Fri
  });
});

describe("previousBusinessDay", () => {
  it("화 → 월", () => {
    expect(toIsoDate(previousBusinessDay(d("2026-09-15")))).toBe("2026-09-14");
  });
  it("월 → 지난 금 (주말 스킵)", () => {
    expect(toIsoDate(previousBusinessDay(d("2026-09-21")))).toBe("2026-09-18");
  });
});

describe("nextBusinessDay", () => {
  it("금 → 다음 월 (주말 스킵)", () => {
    expect(toIsoDate(nextBusinessDay(d("2026-09-18")))).toBe("2026-09-21");
  });
});

describe("businessDaysBetween (경과 영업일, 양끝 제외 규칙)", () => {
  it("같은 날 → 0", () => {
    expect(businessDaysBetween(d("2026-09-15"), d("2026-09-15"))).toBe(0);
  });
  it("화(15) → 수(16) → 1", () => {
    expect(businessDaysBetween(d("2026-09-15"), d("2026-09-16"))).toBe(1);
  });
  it("금(18) → 월(21) → 1 (주말 스킵)", () => {
    expect(businessDaysBetween(d("2026-09-18"), d("2026-09-21"))).toBe(1);
  });
  it("월(14) → 금(18) → 4", () => {
    expect(businessDaysBetween(d("2026-09-14"), d("2026-09-18"))).toBe(4);
  });
});

describe("businessDaysInSpan (양끝 포함, Gantt 라벨용)", () => {
  it("같은 날(평일) → 1", () => {
    expect(businessDaysInSpan(d("2026-09-15"), d("2026-09-15"))).toBe(1);
  });
  it("화(15) → 수(16) → 2", () => {
    expect(businessDaysInSpan(d("2026-09-15"), d("2026-09-16"))).toBe(2);
  });
  it("수(16) → 월(21) → 4 (주말 2일 스킵)", () => {
    expect(businessDaysInSpan(d("2026-09-16"), d("2026-09-21"))).toBe(4);
  });
  it("end < start → 0", () => {
    expect(businessDaysInSpan(d("2026-09-20"), d("2026-09-15"))).toBe(0);
  });
});

describe("weekOfMonth (1일 포함 주가 1주차, 월~금 기준)", () => {
  it("2026-09-01 (화) → 1주차", () => {
    expect(weekOfMonth(d("2026-09-01"))).toBe(1);
  });
  it("2026-09-04 (금) → 1주차", () => {
    expect(weekOfMonth(d("2026-09-04"))).toBe(1);
  });
  it("2026-09-07 (월) → 2주차", () => {
    expect(weekOfMonth(d("2026-09-07"))).toBe(2);
  });
  it("2026-09-21 (월) → 4주차", () => {
    expect(weekOfMonth(d("2026-09-21"))).toBe(4);
  });
});

describe("allWeeksOfMonth", () => {
  it("2026-09 주차 목록 (1주차 부분/월경계 클램프, 전체 주는 월~금)", () => {
    // 원본 Python 규약: 부분 1주차는 월 첫날 → 첫 월요일 전날 (일요일까지 포함),
    // 완전한 주는 월~금 5일, 마지막 주는 월요일 → 월말 클램프.
    const weeks = allWeeksOfMonth(d("2026-09-15"));
    expect(weeks.map((w) => [w.num, toIsoDate(w.start), toIsoDate(w.end)])).toEqual([
      [1, "2026-09-01", "2026-09-06"], // Tue 1 → Sun 6 (첫 월요일 7 하루 전)
      [2, "2026-09-07", "2026-09-11"],
      [3, "2026-09-14", "2026-09-18"],
      [4, "2026-09-21", "2026-09-25"],
      [5, "2026-09-28", "2026-09-30"], // Wed 30 월말 클램프
    ]);
  });
});

describe("resolveOriginDate", () => {
  it("note_date 이후로 잡히면 작년으로 해석", () => {
    // 2026-01-05 노트에서 태그가 12-30~ 로 오면 2025-12-30 이어야 함
    expect(toIsoDate(resolveOriginDate(d("2026-01-05"), 12, 30))).toBe("2025-12-30");
  });
  it("note_date 이전이면 같은 해", () => {
    expect(toIsoDate(resolveOriginDate(d("2026-09-21"), 9, 16))).toBe("2026-09-16");
  });
});

describe("sameYearMonth", () => {
  it("같은 년·월", () => {
    expect(sameYearMonth(d("2026-09-01"), d("2026-09-30"))).toBe(true);
  });
  it("월 경계", () => {
    expect(sameYearMonth(d("2026-09-30"), d("2026-10-01"))).toBe(false);
  });
});

describe("addDays", () => {
  it("음수도 동작", () => {
    expect(toIsoDate(addDays(d("2026-09-01"), -1))).toBe("2026-08-31");
  });
});
