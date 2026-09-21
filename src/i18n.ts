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
  // Timeline view
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
  warnTooltipCountdownMulti: {
    ko: "⚠️ 드롭까지 {highlight} 남음 — 완료하지 않으면 월간 드롭 문서로 자동 이동됩니다",
    en: "⚠️ {highlight} until auto-drop — moves to monthly drop doc if not completed",
  },
  warnTooltipCountdownOne: {
    ko: "⚠️ {highlight}에 드롭 예정 — 오늘 처리하지 않으면 월간 드롭 문서로 이동됩니다",
    en: "⚠️ Will drop on {highlight} — move it forward before end of day",
  },
  warnHighlightDaysMulti: { ko: "{n}영업일", en: "{n} business days" },
  warnHighlightNextDay: { ko: "다음 영업일", en: "the next business day" },
  longTermTooltip: {
    ko: "[장기] 마커 — 드롭 규칙 면제, 무한 이월됩니다",
    en: "Tagged #장기 (long-term) — exempt from the drop rule, carries indefinitely",
  },
  longTermLabel: { ko: "[장기]", en: "[Long]" },
  sameDay: { ko: "당일", en: "Same day" },
  viewDisplayLabel: { ko: "업무 타임라인", en: "Task Timeline" },

  // Ribbon
  ribbonOpenTimeline: { ko: "업무 타임라인 열기", en: "Open task timeline" },

  // Commands
  cmdCreateToday: { ko: "오늘 데일리 노트 생성", en: "Create today's daily note" },
  cmdDryRun: {
    ko: "Dry-run: 예상 동작만 출력",
    en: "Dry-run: preview actions without writing",
  },
  cmdRecompute: { ko: "이번 달 종합 재계산", en: "Recompute this month's summary" },
  cmdRefreshTimeline: {
    ko: "이번 달 타임라인 새로고침 (종합 문서 내부)",
    en: "Refresh this month's timeline (in summary)",
  },
  cmdForceDate: {
    ko: "특정 날짜 노트 강제 재생성",
    en: "Force regenerate a specific date",
  },
  cmdDoctor: { ko: "환경 진단", en: "Environment diagnostics" },
  cmdOpenTimeline: { ko: "타임라인 뷰 열기", en: "Open timeline view" },

  // Date prompt modal
  datePromptTitle: {
    ko: "노트를 강제 재생성할 날짜",
    en: "Date to force regenerate",
  },
  datePromptSubmit: { ko: "실행", en: "Run" },

  // Notice messages
  noticeSkippedWeekend: { ko: "주말 스킵 ({date})", en: "Weekend, skipped ({date})" },
  noticeAlreadyExists: { ko: "이미 존재 ({path})", en: "Already exists ({path})" },
  noticeCreatedHead: {
    ko: "데일리 노트 생성: {path}",
    en: "Daily note created: {path}",
  },
  noticeCountsKo: {
    ko: "이월 {c} · 완료 {d} · 드롭 {r} · 보관 {a}",
    en: "carried {c} · done {d} · dropped {r} · archived {a}",
  },
  noticeCreateFailed: { ko: "생성 실패: {msg}", en: "Create failed: {msg}" },
  noticeDryRunSummary: {
    ko: "[dry-run] {date} — 이월 {c} · 완료 {d} · 드롭 {r} · 보관 {a}",
    en: "[dry-run] {date} — carried {c} · done {d} · dropped {r} · archived {a}",
  },
  noticeDryRunFailed: { ko: "dry-run 실패: {msg}", en: "Dry-run failed: {msg}" },
  noticeRecomputed: {
    ko: "{ym} 종합 재계산 완료",
    en: "{ym} summary recomputed",
  },
  noticeRecomputeFailed: {
    ko: "재계산 실패: {msg}",
    en: "Recompute failed: {msg}",
  },
  noticeTimelineRefreshed: {
    ko: "{ym} 종합 문서의 타임라인 갱신 완료",
    en: "Timeline refreshed in {ym} summary",
  },
  noticeTimelineFailed: {
    ko: "타임라인 갱신 실패: {msg}",
    en: "Timeline refresh failed: {msg}",
  },
  noticeForceFailed: {
    ko: "강제 생성 실패: {msg}",
    en: "Force regenerate failed: {msg}",
  },
  noticeDoctorOk: { ko: "정상 ({subdir})", en: "OK ({subdir})" },
  noticeDoctorProblem: { ko: "문제: {issues}", en: "Problem: {issues}" },
  noticeDoctorFailed: {
    ko: "진단 실패: {msg}",
    en: "Diagnostics failed: {msg}",
  },
  noticeDateFormat: {
    ko: "형식이 YYYY-MM-DD 여야 합니다",
    en: "Date must be in YYYY-MM-DD format",
  },
  noticeLanguageChanged: {
    ko: "언어를 변경했습니다. 리본·명령어까지 완전 반영하려면 옵시디언을 다시 로드하세요.",
    en: "Language changed. Reload Obsidian to fully update ribbon and commands.",
  },

  // Settings
  setLangName: { ko: "언어 / Language", en: "Language / 언어" },
  setLangDesc: {
    ko:
      "이 플러그인은 한국어 워크플로 기반으로 설계됐습니다. 언어 설정은 UI(리본 툴팁·명령어·알림·설정 라벨·타임라인 뷰)만 전환하며, 생성되는 노트 파일 내용(섹션 헤더, 이월 접미사 등)은 언제나 한국어 포맷을 유지합니다.",
    en:
      "This plugin is designed around a Korean daily-note workflow. The language setting only translates the UI (ribbon tooltip, commands, notices, settings labels, timeline view). Generated note contents (section headers, carryover suffixes, monthly summary, etc.) always stay in Korean format.",
  },
  setLangAuto: { ko: "Auto (시스템)", en: "Auto (system)" },
  setSubdirName: { ko: "노트 하위 폴더", en: "Notes subfolder" },
  setSubdirDesc: {
    ko: "볼트 안 데일리 노트 루트 폴더 (기본 Notes)",
    en: "Root folder for daily notes in the vault (default: Notes)",
  },
  setDropThresholdName: { ko: "드롭 임계 (영업일)", en: "Drop threshold (business days)" },
  setDropThresholdDesc: {
    ko: "이월이 이 일수를 넘으면 월간 드롭 문서로 이동 (기본 5)",
    en: "Tasks carrying over more than this many business days move to the monthly drop doc (default 5)",
  },
  setWarnRedName: { ko: "🔴 경고 (드롭 N일 전)", en: "🔴 warning (N days before drop)" },
  setWarnRedDesc: {
    ko: "드롭 임계 N일 전부터 🔴 표시. 기본 1 (드롭 하루 전).",
    en: "Show 🔴 starting N business days before drop. Default 1 (day before drop).",
  },
  setWarnOrangeName: {
    ko: "🟠 경고 (드롭 N일 전)",
    en: "🟠 warning (N days before drop)",
  },
  setWarnOrangeDesc: {
    ko: "드롭 임계 N일 전부터 🟠 표시. 기본 2 (드롭 이틀 전). 🔴 값보다 크게 설정 (더 일찍 시작).",
    en: "Show 🟠 starting N business days before drop. Default 2 (two days before drop). Must be greater than the 🔴 value.",
  },
  setArchiveFilenameName: { ko: "보관함 파일명", en: "Archive filename" },
  setArchiveFilenameDesc: {
    ko: "볼트 내 상시 보관함 파일 이름",
    en: "Filename of the permanent archive file",
  },
  setSummarySuffixName: {
    ko: "월간 종합 파일 접미어",
    en: "Monthly summary filename suffix",
  },
  setSummarySuffixDesc: {
    ko: '예: "종합" → "2026-09 종합.md"',
    en: 'e.g. "Summary" → "2026-09 Summary.md"',
  },
  setDropSuffixName: { ko: "월간 드롭 파일 접미어", en: "Monthly drop filename suffix" },
  setDropSuffixDesc: {
    ko: '예: "드롭" → "2026-09 드롭.md"',
    en: 'e.g. "Drop" → "2026-09 Drop.md"',
  },
  setSkipWeekendName: { ko: "주말 스킵", en: "Skip weekend" },
  setSkipWeekendDesc: {
    ko: "토·일에는 노트 생성하지 않음",
    en: "Do not create notes on Sat/Sun",
  },
  setAutoLoadName: { ko: "실행 시 자동 catch-up", en: "Auto catch-up on load" },
  setAutoLoadDesc: {
    ko: "옵시디언 시작 시 마지막 실행 이후 놓친 날짜를 자동 처리",
    en: "On Obsidian launch, auto-process missed business days since last run",
  },
  setMaxCatchupName: { ko: "Catch-up 최대 일수", en: "Max catch-up days" },
  setMaxCatchupDesc: {
    ko: "이 값보다 오래 옵시디언을 안 켰다가 켜면 그 이후 날짜만 처리 (기본 14)",
    en: "If closed longer than this many days, only process today (default 14)",
  },
} as const;

export type MessageKey = keyof typeof M;

export function t(
  key: MessageKey,
  locale: Locale,
  params?: Record<string, string | number>,
): string {
  let s: string = M[key][locale];
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      s = s.split(`{${k}}`).join(String(v));
    }
  }
  return s;
}

/** dictionary 완전성 확인용. 모든 키가 두 로케일 다 정의됐는지. */
export function allMessageKeys(): MessageKey[] {
  return Object.keys(M) as MessageKey[];
}

export function daysOfWeekChars(locale: Locale): string {
  return locale === "ko" ? "일월화수목금토" : "SMTWTFS";
}

export function dayOfWeekChar(d: number, locale: Locale): string {
  return daysOfWeekChars(locale)[d];
}

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

export function rangeLabel(startIso: string, endIso: string, locale: Locale): string {
  if (startIso === endIso) return `${startIso} (${t("sameDay", locale)})`;
  return `${startIso} ~ ${endIso}`;
}
