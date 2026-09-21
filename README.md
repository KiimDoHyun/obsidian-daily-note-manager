# Obsidian Daily Note Manager

[daily-note-system](https://github.com/KiimDoHyun/daily-note-system) 의 Obsidian 플러그인 포트.

옵시디언 앱 안에서 데일리 노트 이월·경고·드롭·보관·월간 종합을 자동 처리한다. Python + launchd 를 쓰지 못하는 환경(Windows/Linux, 또는 macOS 지만 설치 부담을 지고 싶지 않은 사용자)을 위한 대안 채널.

## 상태

**개발 초기.** 골격만 잡혀있고 상태 전이 로직은 미구현. 규칙 명세는 원본 리포의 `docs/design.md` 를 단일 소스로 참조한다. Python 구현과 규칙이 어긋나지 않도록 이식 시 반드시 원본 문서를 기준으로 삼는다.

## 원본과의 차이

| 항목 | 원본 (Python + launchd) | 이 플러그인 |
|---|---|---|
| 실행 조건 | 로그인 시 자동 | 옵시디언 실행 중일 때 |
| OS | macOS 전용 | 크로스 플랫폼 |
| 설치 | git clone + install.sh + TCC 권한 | 커뮤니티 플러그인 or `.obsidian/plugins/` 복사 |
| 놓친 날짜 처리 | 로그인 시 항상 최신 | 앱 로드 시 catch-up |

## 개발

```bash
npm install
npm run dev     # esbuild watch
```

빌드 산출물(`main.js`)을 테스트 볼트에 반영하려면 아래처럼 심볼릭 링크를 걸어두면 편하다.

```bash
ln -s "$PWD" "/path/to/vault/.obsidian/plugins/daily-note-manager"
```

옵시디언에서 **설정 → 커뮤니티 플러그인 → 설치된 플러그인** 목록에 `Daily Note Manager` 가 뜨면 활성화. 코드 변경 시 명령어 팔레트 `Reload app without saving` 로 재로드.

## 프로덕션 빌드

```bash
npm run build
```

`main.js`, `manifest.json`, `styles.css` 세 파일이 배포 대상.

## 폴더 구조

```
src/
├── main.ts              # Plugin 진입점
├── settings.ts          # 설정 스키마 + 설정 탭
├── commands.ts          # 명령어 팔레트 등록
├── scheduler.ts         # 날짜 변경 감지 (1분 tick)
└── engine/
    ├── index.ts         # Engine 파사드
    ├── types.ts         # 공용 타입
    ├── parser.ts        # 마크다운 파싱
    ├── stateTransition.ts # 이월/경고/드롭/보관 판정
    └── noteWriter.ts    # 볼트 쓰기 헬퍼
```

## 이식 로드맵

1. `parser.ts` — 원본 `lib/` 파싱 규칙 이식 + 단위 테스트
2. `stateTransition.ts` — 상태 전이 판정 이식 + 단위 테스트
3. `noteWriter.ts` — 경로 계산·파일 생성/수정 유틸
4. `Engine.createForToday` — 오케스트레이션 완성
5. `Engine.catchUp` — 놓친 날짜 순차 처리
6. `Engine.dryRun` / `recomputeMonth` / `doctor` 채우기
7. 설정 탭 나머지 필드 노출
8. 통합 테스트 (원본 87개 unittest 시나리오 대응)

## 라이센스

MIT
