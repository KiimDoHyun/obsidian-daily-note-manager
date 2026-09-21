export type Locale = "ko" | "en";
export type LocaleSetting = "auto" | Locale;

export function resolveLocale(setting: LocaleSetting): Locale {
  if (setting !== "auto") return setting;
  if (typeof navigator !== "undefined" && navigator.language.toLowerCase().startsWith("ko")) {
    return "ko";
  }
  return "en";
}

const M = {
  toolbarToday: { ko: "오늘", en: "Today" },
  toolbarRefresh: { ko: "↻ 새로고침", en: "↻ Refresh" },
  legendActive: { ko: "진행중", en: "In progress" },
  legendDone: { ko: "완료", en: "Done" },
  legendDropped: { ko: "드롭", en: "Dropped" },
  legendHint: {
    ko: "· 막대 클릭 시 시작일 데일리 노트로 이동",
    en: "· Click a bar to jump to the origin daily note",
  },
  sectionActive: { ko: "진행중", en: "In progress" },
  sectionDone: { ko: "완료", en: "Done" },
  sectionDropped: { ko: "드롭", en: "Dropped" },
  todayLabel: { ko: "오늘", en: "Today" },
  emptyMonth: { ko: "이번 달 이벤트가 없습니다.", en: "No events this month." },
  noChildren: { ko: "하위 항목 없음", en: "No sub-items" },
  clickHint: {
    ko: "클릭하면 시작일 데일리 노트로 이동",
    en: "Click to jump to the origin daily note",
  },
  sameDay: { ko: "당일", en: "Same day" },
} as const;

type MessageKey = keyof typeof M;

export function t(key: MessageKey, locale: Locale): string {
  return M[key][locale];
}

/** 요일 헤더 문자 (7자, 일~토 순) */
export function daysOfWeekChars(locale: Locale): string {
  return locale === "ko" ? "일월화수목금토" : "SMTWTFS";
}

/** 요일 헤더 문자 (single). d = 0(일)..6(토) */
export function dayOfWeekChar(d: number, locale: Locale): string {
  return daysOfWeekChars(locale)[d];
}

/** 소요일 텍스트 (막대 안에 표시). */
export function durationLabel(
  days: number,
  status: "active" | "done" | "crit",
  locale: Locale,
): string {
  if (days <= 1) return t("sameDay", locale);
  if (status === "active") {
    return locale === "ko" ? `${days}일째` : `Day ${days}`;
  }
  return locale === "ko" ? `${days}일` : `${days}d`;
}

/** 툴팁 메타 라인. iso 는 YYYY-MM-DD. */
export function rangeLabel(
  startIso: string,
  endIso: string,
  locale: Locale,
): string {
  if (startIso === endIso) {
    return `${startIso} (${t("sameDay", locale)})`;
  }
  return `${startIso} ~ ${endIso}`;
}
