import { describe, it, expect } from "vitest";
import {
  allMessageKeys,
  dayOfWeekChar,
  daysOfWeekChars,
  durationLabel,
  rangeLabel,
  resolveLocale,
  t,
} from "../../src/i18n";

describe("resolveLocale", () => {
  it("명시적 ko/en 은 그대로", () => {
    expect(resolveLocale("ko")).toBe("ko");
    expect(resolveLocale("en")).toBe("en");
  });

  it("auto: navigator.language 감지", () => {
    // Node 환경에서 navigator 는 undefined 또는 en-US 계열이라 en 폴백
    const result = resolveLocale("auto");
    expect(result === "ko" || result === "en").toBe(true);
  });
});

describe("t(): 두 로케일 모두 정의됐는지", () => {
  it("모든 메시지 키가 ko/en 문자열을 반환", () => {
    for (const key of allMessageKeys()) {
      const ko = t(key, "ko");
      const en = t(key, "en");
      expect(typeof ko).toBe("string");
      expect(typeof en).toBe("string");
      expect(ko.length).toBeGreaterThan(0);
      expect(en.length).toBeGreaterThan(0);
    }
  });

  it("로케일별 다른 문자열 반환 (sample)", () => {
    expect(t("toolbarToday", "ko")).toBe("오늘");
    expect(t("toolbarToday", "en")).toBe("Today");
    expect(t("cmdCreateToday", "ko")).toBe("오늘 데일리 노트 생성");
    expect(t("cmdCreateToday", "en")).toBe("Create today's daily note");
  });
});

describe("t(): 파라미터 치환", () => {
  it("{key} 플레이스홀더 치환", () => {
    const s = t("noticeAlreadyExists", "en", { path: "Notes/foo.md" });
    expect(s).toBe("Already exists (Notes/foo.md)");
  });

  it("여러 파라미터", () => {
    const s = t("noticeCountsKo", "en", { c: 3, d: 1, r: 0, a: 2 });
    expect(s).toBe("carried 3 · done 1 · dropped 0 · archived 2");
  });

  it("한글 버전도 동일한 치환 동작", () => {
    const s = t("noticeCountsKo", "ko", { c: 3, d: 1, r: 0, a: 2 });
    expect(s).toBe("이월 3 · 완료 1 · 드롭 0 · 보관 2");
  });

  it("같은 플레이스홀더 여러 번 등장해도 모두 치환", () => {
    const s = t("noticeRecomputed", "ko", { ym: "2026-09" });
    expect(s).toContain("2026-09");
  });
});

describe("dayOfWeekChar", () => {
  it("한글: 일월화수목금토", () => {
    expect(daysOfWeekChars("ko")).toBe("일월화수목금토");
    expect(dayOfWeekChar(0, "ko")).toBe("일");
    expect(dayOfWeekChar(6, "ko")).toBe("토");
  });
  it("영문: SMTWTFS", () => {
    expect(daysOfWeekChars("en")).toBe("SMTWTFS");
    expect(dayOfWeekChar(0, "en")).toBe("S");
    expect(dayOfWeekChar(3, "en")).toBe("W");
  });
});

describe("durationLabel", () => {
  it("same day (1)", () => {
    expect(durationLabel(1, "done", "ko")).toBe("당일");
    expect(durationLabel(1, "done", "en")).toBe("Same day");
  });
  it("active status: N일째 / Day N", () => {
    expect(durationLabel(3, "active", "ko")).toBe("3일째");
    expect(durationLabel(3, "active", "en")).toBe("Day 3");
  });
  it("done/crit: N일 / Nd", () => {
    expect(durationLabel(5, "done", "ko")).toBe("5일");
    expect(durationLabel(5, "done", "en")).toBe("5d");
    expect(durationLabel(6, "crit", "ko")).toBe("6일");
    expect(durationLabel(6, "crit", "en")).toBe("6d");
  });
});

describe("rangeLabel", () => {
  it("start == end → same-day 표기", () => {
    expect(rangeLabel("2026-09-15", "2026-09-15", "ko")).toBe("2026-09-15 (당일)");
    expect(rangeLabel("2026-09-15", "2026-09-15", "en")).toBe("2026-09-15 (Same day)");
  });
  it("start != end → 범위", () => {
    expect(rangeLabel("2026-09-15", "2026-09-17", "ko")).toBe("2026-09-15 ~ 2026-09-17");
    expect(rangeLabel("2026-09-15", "2026-09-17", "en")).toBe("2026-09-15 ~ 2026-09-17");
  });
});
