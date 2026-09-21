# Obsidian Daily Note Manager

Automatically carry unfinished tasks between daily notes, warn when they linger, and drop or archive them by a monthly policy.

Every morning when you open Obsidian, today's note is already there. Unfinished tasks from yesterday sit in the "Carried over" section with a counter showing how many days you've been holding them. After five business days, tasks that haven't been finished move out to a monthly drop document. Completed ones log into a monthly summary. A Gantt chart in the ribbon shows the whole month at a glance.

## What a daily note looks like

Yesterday (March 19) had these tasks:

```markdown
## 📌 할일
- [ ] Clean up the API response schema
- [x] PR review
```

Today's note is generated automatically like this:

```markdown
## 📌 할일

## ✅ 이월된 할일
- [ ] Clean up the API response schema (2일째 이월, 03-19~)

## 💬 메모
```

Once "Clean up the API response schema" reaches day 3 or 4, a 🟠 or 🔴 warning appears next to it along with a "will be dropped soon" note. On day 5 it disappears from today's note and moves to `2026-03 드롭.md`. The completed "PR review" is logged in `2026-03 종합.md`, ready for month-end review.

## Overriding the policy

Three markers on a task line change how it's handled:

- `#장기` — never dropped, keeps carrying over. Use for long-running project items.
- `#보관` — on the next run, moves to `보관함.md`. Use for reference items you want to keep without marking complete or cancelled.
- `- [-]` — dropped immediately. Use for tasks you decided not to do.

## Timeline view

Click the calendar icon in the left ribbon to open a Gantt chart of the current month. Bars are colored by status: blue for in-progress, green for complete, gray for dropped. Clicking a bar jumps to the daily note where the task first appeared. Weekends are marked with vertical dividers and today has its own marker.

The monthly summary document also embeds a Mermaid Gantt snapshot that refreshes each day, so you can see the same timeline from Reading mode — including on mobile.

> Screenshot placeholder (`assets/timeline.png`)

## Folder layout

Files the plugin creates and manages:

```
Notes/
└── 2026-03/
    ├── 4주차/
    │   ├── 📅 2026-03-19.md
    │   └── 📅 2026-03-20.md
    ├── 2026-03 종합.md
    └── 2026-03 드롭.md
보관함.md
```

Weeks start on Monday, and the week containing day 1 is week 1. New folders are created when the month rolls over.

## When it runs

While Obsidian is open, the plugin checks every 60 seconds whether today's note exists. If Obsidian was closed for several days, the next launch catches up by processing missed business days one by one (up to 14 by default).

## Install

**Beta via BRAT**

1. Install [BRAT](https://github.com/TfTHacker/obsidian42-brat) from community plugins.
2. Open the BRAT ribbon icon → "Add Beta Plugin" → paste `KiimDoHyun/obsidian-daily-note-manager`.
3. Enable "Daily Note Manager" under Settings → Community plugins.

**Manual**

Download `main.js`, `manifest.json`, and `styles.css` from the [Releases](https://github.com/KiimDoHyun/obsidian-daily-note-manager/releases) page and drop them into `.obsidian/plugins/daily-note-manager/` inside your vault.

## Settings

Under Settings → Community plugins → Daily Note Manager:

- Notes subfolder (default `Notes`)
- Drop threshold in business days (default 5)
- Warning threshold in business days (default 3)
- Skip weekend on/off
- Max catch-up days on app load (default 14)

## Commands

From the command palette (`Cmd/Ctrl+P`):

- Create today's note
- Dry-run today's actions (no file writes)
- Force regenerate a specific date
- Recompute this month's summary header
- Refresh this month's timeline section
- Open timeline view
- Environment diagnostics

## When this plugin isn't a good fit

This plugin assumes daily notes are your task ledger. If that's not how you work:

- You keep long-running project tasks in daily notes — you'd need to tag every one with `#장기`. Query-based tools like [Tasks](https://publish.obsidian.md/tasks/) fit better.
- Files moving on their own makes you uneasy — drop and archive actually move files. If you only want carryover, [Rollover Daily Todos](https://github.com/lumoe/obsidian-rollover-daily-todos) is lighter.
- You manage tasks in project notes rather than daily notes.

## Development

See [CONTRIBUTING.md](./CONTRIBUTING.md).

## License

MIT

---

# 한국어

옵시디언 데일리 노트에 쌓이는 할일을 자동으로 이월하고, 오래 붙들고 있으면 경고하고, 정해진 기준을 넘으면 드롭하거나 보관하는 플러그인.

매일 아침 옵시디언을 열면 오늘 날짜 노트가 이미 만들어져 있다. 어제 끝내지 못한 할일은 새 노트의 "이월된 할일" 자리에 옮겨져 있고, 며칠째 붙들고 있는지 옆에 숫자가 붙는다. 5영업일이 지나도 끝나지 않은 항목은 그 달의 드롭 문서로 알아서 빠져나가고, 완료한 항목은 월간 종합 문서에 로그로 쌓인다. 리본의 달력 아이콘을 누르면 이번 달 할일이 간트 차트로 보인다.

## 실제 노트는 이렇게 생깁니다

어제 3월 19일 노트에 이런 항목이 남아 있었다고 하자.

```markdown
## 📌 할일
- [ ] API 응답 스키마 정리
- [x] PR 리뷰
```

오늘 자동으로 만들어지는 3월 20일 노트는 이렇게 보인다.

```markdown
## 📌 할일

## ✅ 이월된 할일
- [ ] API 응답 스키마 정리 (2일째 이월, 03-19~)

## 💬 메모
```

"API 응답 스키마 정리"가 3~4일째로 넘어가면 앞에 🟠, 🔴 마커가 붙고 "드롭 예정입니다" 경고가 나온다. 5영업일이 지나면 오늘 노트에서 사라지고 `2026-03 드롭.md`로 이동한다. 어제 완료한 "PR 리뷰"는 `2026-03 종합.md`에 기록되어 월말 회고에 쓸 수 있다.

## 자동 처리에 개입하고 싶을 때

기본 정책을 덮어쓰는 마커 세 개.

- `#장기` — 며칠이 지나도 드롭되지 않는다. 오래 걸리는 프로젝트 항목에 붙인다.
- `#보관` — 다음 날 노트를 만들 때 `보관함.md`로 옮겨진다. 완료도 취소도 아닌, 참고용으로 남기고 싶은 항목에 쓴다.
- `- [-]` — 즉시 드롭 처리한다. 하려다 접은 항목을 이월 대상에서 뺄 때.

## 타임라인 뷰

리본의 달력 아이콘을 누르면 이번 달 할일이 간트 차트로 열린다. 진행 중은 파랑, 완료는 초록, 드롭은 회색. 막대를 클릭하면 해당 항목이 처음 등장한 데일리 노트로 이동한다. 주말은 세로선으로 구분되고 오늘 날짜에는 별도 표시가 붙는다.

월간 종합 문서 안에도 Mermaid 간트 스냅샷이 매일 갱신되어 들어간다. 뷰를 열지 않아도 종합 문서 스크롤로 확인할 수 있고, 모바일에서도 렌더링된다.

> 스크린샷 자리 (`assets/timeline.png`)

## 폴더 구조

플러그인이 만들고 관리하는 파일들.

```
Notes/
└── 2026-03/
    ├── 4주차/
    │   ├── 📅 2026-03-19.md
    │   └── 📅 2026-03-20.md
    ├── 2026-03 종합.md
    └── 2026-03 드롭.md
보관함.md
```

주차는 월요일 기준이고, 그 달의 1일이 포함된 주가 1주차다. 월이 바뀌면 새 폴더가 자동으로 만들어진다.

## 언제 실행되나

옵시디언이 켜져 있는 동안 60초마다 오늘 노트가 있는지 확인한다. 며칠 동안 옵시디언을 안 열었다가 다시 열면, 마지막 실행일부터 오늘까지 놓친 영업일(기본 최대 14일)을 순서대로 처리한다.

## 설치

**BRAT (베타)**

1. 커뮤니티 플러그인에서 [BRAT](https://github.com/TfTHacker/obsidian42-brat) 설치·활성화.
2. 좌측 리본의 BRAT 아이콘 → "Add Beta Plugin" → `KiimDoHyun/obsidian-daily-note-manager` 입력.
3. 설정 → 커뮤니티 플러그인에서 "Daily Note Manager" 활성화.

**수동 설치**

[Releases](https://github.com/KiimDoHyun/obsidian-daily-note-manager/releases)에서 `main.js`, `manifest.json`, `styles.css`를 받아 볼트의 `.obsidian/plugins/daily-note-manager/`에 넣는다.

## 설정

설정 → 커뮤니티 플러그인 → Daily Note Manager.

- 노트 하위 폴더 (기본 `Notes`)
- 드롭 임계일 (기본 5영업일)
- 경고 임계일 (기본 3영업일)
- 주말 스킵 여부
- 앱 로드 시 catch-up 최대 일수 (기본 14일)

## 명령어

명령어 팔레트(`Cmd/Ctrl+P`).

- 오늘 노트 생성
- 오늘 실행 결과 미리보기 (dry-run)
- 특정 날짜 강제 재생성
- 이번 달 종합 재계산
- 이번 달 타임라인 새로고침
- 타임라인 뷰 열기
- 환경 진단

## 이 플러그인이 안 맞는 경우

데일리 노트를 태스크 장부처럼 쓰는 워크플로를 전제한다.

- 장기 프로젝트 항목을 데일리 노트에 그대로 두는 스타일 — `#장기`를 매번 붙여야 해서 번거롭다. [Tasks](https://publish.obsidian.md/tasks/)처럼 쿼리 기반 도구가 더 맞다.
- 파일이 자동으로 이동하는 게 불안한 경우 — 드롭·보관 동작이 실제 파일을 옮긴다. 이월만 원한다면 [Rollover Daily Todos](https://github.com/lumoe/obsidian-rollover-daily-todos)가 더 가볍다.
- 데일리 노트가 아니라 프로젝트 노트 중심으로 태스크를 관리하는 경우.

## 개발

개발 환경, 소스 구조, 릴리스 절차는 [CONTRIBUTING.md](./CONTRIBUTING.md) 참조.

## 라이선스

MIT.
