# Obsidian Daily Note Manager

Automates daily note management in Obsidian: carryover of unfinished tasks, aging warnings, auto-drop after threshold, archive, monthly summary, and timeline visualization.

Ported from [daily-note-system](https://github.com/KiimDoHyun/daily-note-system) (Python + macOS launchd) to a cross-platform Obsidian plugin.

## Features

### Daily note automation
- Creates today's note automatically while Obsidian is running (60s tick + on-load catch-up for missed business days).
- Unfinished tasks from yesterday's note are moved to today's "Carried over" section with day counter and origin date.
- After 3~4 business days of carryover, tasks get 🟠/🔴 aging warnings and "will be dropped" hint.
- After 5 business days (configurable), tasks are auto-dropped to a monthly drop document unless marked as long-term.
- Weekends are skipped (Fri → Mon carries +1, no notes on Sat/Sun).

### Markers on task lines
- `#장기` (long-term) — exempt from the drop rule, carries indefinitely.
- `#보관` (archive) — move to `보관함.md` (archive) on next run.
- `[-]` (immediate drop) — move to the monthly drop document on next run.

### Monthly documents
- `YYYY-MM 종합.md` (summary) — completed / dropped / archived events grouped by week, with header stats auto-recomputed.
- `YYYY-MM 드롭.md` (drop) — tasks that exceeded carryover threshold or were immediately dropped.
- `보관함.md` (archive) — permanently archived tasks grouped by month.

### Timeline visualization
- **Custom SVG Gantt view** — left ribbon calendar icon opens a timeline panel.
  - Color-coded by status: in-progress (blue) / completed (green) / dropped (gray).
  - Frozen label column, horizontally scrollable chart, weekend column dividers, today marker.
  - Row hover highlight (label ↔ chart sync).
  - Click a bar → jump to that task's origin daily note.
  - Bar hover → tooltip with full task text and its subtasks/notes.
- **Mermaid Gantt inside the monthly summary doc** — static snapshot auto-refreshed on each daily note creation, renders in Obsidian Reading mode (desktop, mobile, web).

## Commands

- Create today's daily note
- Dry-run (report expected actions without writing files)
- Force regenerate a specific date's note
- Recompute this month's summary header
- Refresh this month's timeline section
- Open timeline view
- Environment diagnostics

## Note structure

The plugin expects and generates daily notes at `<notesSubdir>/YYYY-MM/N주차/📅 YYYY-MM-DD.md` (Korean folder naming) with three sections:

- `## 📌 할일` — today's tasks
- `## ✅ 이월된 할일` — auto-populated carryover section
- `## 💬 메모` — free-form memo

Old section names (`## 📌 오늘의 목표`, `## ✅ 미완료 이월`) are still recognized for backward compatibility.

## Settings

Configurable via Obsidian's settings tab:
- Notes subfolder
- Drop threshold (business days)
- Warning threshold (business days)
- Archive filename / summary suffix / drop suffix
- Skip weekend toggle
- Auto catch-up on load
- Max catch-up days

## Trade-offs vs. the Python original

| Aspect | Python + launchd | This plugin |
|---|---|---|
| Trigger | Runs at login (even if Obsidian is closed) | Runs while Obsidian is open (+ catch-up on next launch) |
| OS | macOS only | Cross-platform (custom timeline view is desktop-only) |
| Install | git clone + install.sh + TCC permission | Community plugin (or BRAT beta) |

## Development

```bash
npm install
npm run dev       # esbuild watch
npm run build     # production build
npm test          # 61 unit + integration tests
npm run typecheck
```

Symlink into a test vault:
```bash
ln -s "$PWD" "/path/to/vault/.obsidian/plugins/daily-note-manager"
```

## License

MIT

---

# 한국어 문서 (Korean)

[daily-note-system](https://github.com/KiimDoHyun/daily-note-system) (Python + launchd) 의 Obsidian 플러그인 포트.

옵시디언 앱 안에서 데일리 노트 이월·경고·드롭·보관·월간 종합·타임라인을 자동 처리한다.

## 현재 상태

**2026-09-21 부터 시범 운영 중.** 코어 규칙(파서·상태 전이·월간 문서 갱신) 이식은 완료.

- 원본 Python 시스템은 launchd plist 이름을 `.disabled` 로 바꿔 자동 실행 중단. 문제가 나면 즉시 원복 가능.
- 시범 운영과 마켓플레이스 심사(1~4주)를 병행. 심사 대기 중 버그 발견 시 패치 릴리스로 대응.

## 주요 기능

### 데일리 노트 자동화
- 옵시디언 실행 중 매일 자정에 오늘 노트 자동 생성
- 앱 로드 시 catch-up: 마지막 실행 이후 놓친 영업일들을 순차 처리 (기본 최대 14일)
- 어제 미완료 항목을 오늘 이월된 할일로 이동, 이월 일수 표기
- 3~4일 이월 시 🟠/🔴 경고, 5영업일 초과 시 자동 드롭
- `#장기`(드롭 면제) · `#보관`(보관함 이동) · `[-]`(즉시 드롭) 마커

### 월간 문서
- `YYYY-MM 종합.md`: 완료·드롭·보관 로그, 상단 요약 매일 재계산
- `YYYY-MM 드롭.md`: 5일 초과 이월 또는 즉시 드롭 항목
- `보관함.md`: 상시 보관 항목

### 타임라인 시각화
- **커스텀 뷰**: 좌측 리본 달력 아이콘 → SVG Gantt 차트
  - 진행중/완료/드롭 색 구분, 오늘 세로 붉은 점선
  - 라벨 컬럼 고정, 우측만 가로 스크롤
  - Row hover 하이라이트, 막대 hover → 하위 항목 상세 툴팁
  - 막대 클릭 → 시작일 데일리 노트로 점프
- **종합 문서 내부 Mermaid Gantt**: 정적 스냅샷, 매일 자동 갱신, 모바일에서도 렌더

## 설치

### 시범 배포 (BRAT)

1. 옵시디언 커뮤니티 플러그인에서 [BRAT](https://github.com/TfTHacker/obsidian42-brat) 설치·활성화
2. 좌측 리본 BRAT 아이콘 → **Add Beta plugin**
3. 저장소 경로 입력: `KiimDoHyun/obsidian-daily-note-manager`
4. 자동 설치 → 설정 → 커뮤니티 플러그인 → **Daily Note Manager** 활성화

### 수동 설치

[Releases](https://github.com/KiimDoHyun/obsidian-daily-note-manager/releases) 에서 최신 버전의 `main.js`, `manifest.json`, `styles.css` 세 파일을 다운로드해 볼트의 `.obsidian/plugins/daily-note-manager/` 폴더에 복사.

## 명령어

- 오늘 데일리 노트 생성
- Dry-run: 파일 수정 없이 예상 동작만 출력
- 특정 날짜 노트 강제 재생성
- 이번 달 종합 재계산
- 이번 달 타임라인 새로고침 (종합 문서 내부)
- 타임라인 뷰 열기
- 환경 진단

## 개발

```bash
npm install
npm run dev       # esbuild watch
npm run build     # production build (main.js 갱신)
npm test          # 61 unit + integration 테스트
npm run typecheck
```

로컬 개발 시 볼트 폴더에 심볼릭 링크로 연결:

```bash
ln -s "$PWD" "/path/to/vault/.obsidian/plugins/daily-note-manager"
```

## 릴리스 절차

```bash
# manifest.json 의 version 수정 (예: 0.1.1 → 0.2.0)
git add manifest.json && git commit -m "chore: bump to 0.2.0" && git push

npm run build

git tag 0.2.0 && git push origin 0.2.0
gh release create 0.2.0 main.js manifest.json styles.css \
  --title "0.2.0 — 요약 제목" \
  --notes "변경 내역..."
```

Obsidian 관례상 태그명에 `v` 접두어 붙이지 않고 `manifest.json` version 과 정확히 일치시킨다 (BRAT 및 마켓 인식용).

## 폴더 구조

```
src/
├── main.ts                      # Plugin 진입점, 리본 아이콘 등록
├── settings.ts                  # 설정 스키마 + 설정 탭
├── commands.ts                  # 명령어 팔레트 등록
├── scheduler.ts                 # 60초 tick 으로 자정 감지
├── view/
│   └── timelineView.ts          # 커스텀 SVG Gantt 뷰
└── engine/
    ├── index.ts                 # Engine 파사드 (오케스트레이션)
    ├── types.ts                 # 공용 타입 (TaskBlock, Events 등)
    ├── constants.ts             # 섹션 헤더, 마커, 임계값
    ├── dateutil.ts              # 영업일·주차 계산
    ├── parser.ts                # 데일리 노트 파싱
    ├── events.ts                # 상태 전이 판정
    ├── paths.ts                 # 파일 경로 계산
    ├── vault.ts                 # VaultLike 인터페이스 + Obsidian 어댑터
    └── writers/
        ├── dailyNote.ts         # 오늘 노트 렌더링
        ├── monthlySummary.ts    # 월간 종합 upsert
        ├── monthlyDrop.ts       # 월간 드롭 append
        ├── archive.ts           # 보관함 append
        └── timeline.ts          # Mermaid Gantt 섹션 + TimelineItem 수집
```

## 알려진 제약

- 옵시디언이 켜져 있어야 노트 생성이 동작 (원본 Python 대비)
- 커스텀 타임라인 뷰는 desktop 전용 (SVG 기반, 모바일에서도 렌더는 되지만 UI 최적화 안 됨)
- 완료/드롭 항목의 하위 정보는 해당 이벤트 발생일 데일리 노트가 남아 있어야 툴팁에서 복구됨

## 라이센스

MIT
