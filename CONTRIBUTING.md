# Contributing

## 개발 환경

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

## 소스 구조

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

Obsidian 관례상 태그명에 `v` 접두어를 붙이지 않고 `manifest.json` version 과 정확히 일치시킨다 (BRAT 및 마켓 인식용).
