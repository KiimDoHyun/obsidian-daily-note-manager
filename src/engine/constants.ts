export const SECTION_TODO_NEW = "## 📌 할일";
export const SECTION_TODO_OLD = "## 📌 오늘의 목표";
export const SECTION_CARRYOVER_NEW = "## ✅ 이월된 할일";
export const SECTION_CARRYOVER_OLD = "## ✅ 미완료 이월";
export const SECTION_MEMO = "## 💬 메모";

export const TODO_SECTION_HEADERS = [SECTION_TODO_NEW, SECTION_TODO_OLD] as const;
export const CARRYOVER_SECTION_HEADERS = [
  SECTION_CARRYOVER_NEW,
  SECTION_CARRYOVER_OLD,
] as const;

export const MARKER_ARCHIVE = "#보관";
export const MARKER_LONG = "#장기";

// 이월 블록 사이 시각적 구분선. 옵시디언은 3개 이상의 대시를 모두 가로선으로 렌더하므로
// 사용자 눈에는 일반 `---` 과 동일하지만, 사용자가 실수로 정확히 이 길이의 대시를 손으로
// 입력할 가능성이 사실상 없어 파서에서 "우리가 넣은 구분선" 만 안전하게 걸러낼 수 있다.
export const CARRYOVER_SEPARATOR = "-".repeat(17);

export const WARN_ORANGE = "🟠";
export const WARN_RED = "🔴";
export const DROP_WARNING_TEXT = "드롭 예정입니다";

export const DROP_THRESHOLD_DAYS = 5;
export const WARN_ORANGE_DAY = 3;
export const WARN_RED_DAY = 4;

export const SUMMARY_HEADER_START = "## 📈 이번 달 요약";
export const SUMMARY_COMPLETED_HEADER = "### ✅ 완료";
export const SUMMARY_DROPPED_HEADER = "### ⏭️ 드롭";
export const SUMMARY_ARCHIVED_HEADER = "### 📦 보관 이동";

export const FOOTER_TEMPLATE = `---
📎 마커 예시 (할일 라인에 그대로 붙임):
\`\`\`
- [ ] 할일 텍스트 #장기    → 5일 드롭 규칙 면제, 무한 이월
- [ ] 할일 텍스트 #보관    → 다음 날 보관함으로 이동
- [-] 할일 텍스트          → 다음 날 즉시 드롭 (체크박스를 [-] 로 변경)
\`\`\`
📎 하위 항목·메모는 반드시 들여쓰기(탭 또는 공백) 후 작성.
📂 {summary_link} · {drop_link} · [[보관함]]`;
