import { describe, it, expect } from "vitest";
import { CARRYOVER_SEPARATOR } from "../../src/engine/constants";
import { fromIsoDate, toIsoDate } from "../../src/engine/dateutil";
import { parseDailyNoteText } from "../../src/engine/parser";
import { makeDailyNoteMd, makeLegacyDailyNoteMd } from "../helpers/fixtures";

describe("parser: section 분리", () => {
  it("빈 노트: 모든 섹션 비어있음", () => {
    const md = makeDailyNoteMd({ date: "2026-09-15", activeLines: [] });
    const p = parseDailyNoteText(md, fromIsoDate("2026-09-15"));
    expect(p.activeBlocks).toHaveLength(0);
    expect(p.carryoverBlocks).toHaveLength(0);
  });

  it("이월 섹션 헤더에 (N) 카운트가 붙어있어도 인식", () => {
    // 라이터가 헤더에 카운트를 붙이므로, 다음날 파서는 카운트 유무와 무관하게 매칭해야 한다.
    const md = [
      "---",
      "date: 2026-09-15",
      "tags: [daily]",
      "---",
      "",
      "## 📌 할일",
      "- [ ] new",
      "",
      "## ✅ 이월된 할일 (2)",
      "- [ ] A (**1일째** 이월, 09-14~)",
      "",
      "---",
      "",
      "- [ ] B (**1일째** 이월, 09-14~)",
      "",
      "## 💬 메모",
      "",
    ].join("\n");
    const p = parseDailyNoteText(md, fromIsoDate("2026-09-15"));
    expect(p.carryoverBlocks).toHaveLength(2);
    expect(p.carryoverBlocks[0].topText).toBe("A");
    expect(p.carryoverBlocks[1].topText).toBe("B");
  });

  it("헤더 뒤에 사용자가 코멘트를 덧붙여도 이월 소실 없이 인식", () => {
    // 사용자가 헤더를 편집해서 뒤에 자유 텍스트를 붙여도 canonical 이름으로 시작하기만 하면
    // 이월 섹션으로 인식되어야 한다. 옛 정책은 정규식 매칭이 실패해서 이월이 통째로 소실됐다.
    const cases = [
      "## ✅ 이월된 할일 (3) — 확인 필요",
      "## ✅ 이월된 할일 ( 3 )", // 카운트 안 공백
      "## ✅ 이월된 할일 (three)", // 비숫자 카운트
      "## ✅ 이월된 할일 오늘 정리", // 카운트 없이 자유 텍스트
      "## ✅ 이월된 할일\t(3)", // 탭 구분
    ];
    for (const header of cases) {
      const md = [
        "---",
        "date: 2026-09-15",
        "tags: [daily]",
        "---",
        "",
        "## 📌 할일",
        "",
        header,
        "- [ ] X (**1일째** 이월, 09-14~)",
        "",
        "## 💬 메모",
        "",
      ].join("\n");
      const p = parseDailyNoteText(md, fromIsoDate("2026-09-15"));
      expect(p.carryoverBlocks, `헤더 "${header}" 에서 이월 인식 실패`).toHaveLength(1);
      expect(p.carryoverBlocks[0].topText).toBe("X");
    }
  });

  it("헤더 이름에 딱 붙는 다른 문자는 별개 섹션으로 취급 (오탐 방지)", () => {
    // canonicalize 는 이름 뒤 공백/탭이 있을 때만 매칭. 이름에 바로 붙은 문자는 다른 헤더.
    const md = [
      "---",
      "date: 2026-09-15",
      "tags: [daily]",
      "---",
      "",
      "## 📌 할일",
      "",
      "## ✅ 이월된 할일FOO", // 이름에 바로 붙음 → 이월 섹션 아님
      "- [ ] should_not_be_carryover",
      "",
      "## 💬 메모",
      "",
    ].join("\n");
    const p = parseDailyNoteText(md, fromIsoDate("2026-09-15"));
    expect(p.carryoverBlocks).toHaveLength(0);
  });

  it("코드블록 안의 canonical 이 아닌 `## ` 라인은 섹션 헤더로 오탐하지 않는다", () => {
    // 사용자가 자기 노트에 임의 헤더 이름을 코드블록으로 문서화하는 케이스.
    // 알려진 canonical 이름이 아니므로 코드펜스 안에서 섹션 경계로 취급되지 않아야 한다.
    const md = [
      "---",
      "date: 2026-09-15",
      "tags: [daily]",
      "---",
      "",
      "## 📌 할일",
      "",
      "## ✅ 이월된 할일",
      "- [ ] real carry (⏰ 1일째 이월, 09-14~)",
      "",
      "## 💬 메모",
      "```",
      "## 다른 헤더 예시",
      "- [ ] example in code",
      "```",
      "",
    ].join("\n");
    const p = parseDailyNoteText(md, fromIsoDate("2026-09-15"));
    // 코드펜스 안 헤더는 canonical 아니라 인식 안 됨. 진짜 이월 항목만.
    expect(p.carryoverBlocks).toHaveLength(1);
    expect(p.carryoverBlocks[0].topText).toBe("real carry");
  });

  it("코드블록(~~~) 안의 canonical 아닌 `## ` 라인도 오탐 방지", () => {
    const md = [
      "---",
      "date: 2026-09-15",
      "tags: [daily]",
      "---",
      "",
      "## 📌 할일",
      "",
      "## ✅ 이월된 할일",
      "- [ ] real carry (⏰ 1일째 이월, 09-14~)",
      "",
      "## 💬 메모",
      "~~~",
      "## 다른 헤더 예시",
      "- [ ] example in tilde code",
      "~~~",
      "",
    ].join("\n");
    const p = parseDailyNoteText(md, fromIsoDate("2026-09-15"));
    expect(p.carryoverBlocks).toHaveLength(1);
    expect(p.carryoverBlocks[0].topText).toBe("real carry");
  });

  it("코드블록 안에 canonical 헤더 이름이 있으면 실제 헤더로 인정 (미닫힌 fence 방어의 부산물)", () => {
    // 트레이드오프: 알려진 헤더 이름은 fence 안에서도 실제 헤더로 인정한다.
    // 사용자가 이 플러그인의 헤더 이름을 정확히 코드블록에 넣어 문서화하는 것은 드물고,
    // 대신 미닫힌 fence 로 인한 이월 소실을 방어하는 게 훨씬 중요.
    const md = [
      "---", "date: 2026-09-15", "tags: [daily]", "---",
      "",
      "## 📌 할일",
      "",
      "## ✅ 이월된 할일",
      "- [ ] real carry (⏰ 1일째 이월, 09-14~)",
      "",
      "## 💬 메모",
      "```",
      "## ✅ 이월된 할일", // 정확히 canonical → 실제 헤더로 인정됨
      "- [ ] appears as carry",
      "```",
      "",
    ].join("\n");
    const p = parseDailyNoteText(md, fromIsoDate("2026-09-15"));
    expect(p.carryoverBlocks).toHaveLength(2);
    expect(p.carryoverBlocks.map(b => b.topText)).toEqual(["real carry", "appears as carry"]);
  });

  it("미닫힌 fence 뒤 이월 섹션 헤더가 여전히 인식된다 (데이터 손실 방어)", () => {
    // 실제 사용자 시나리오: 메모 섹션에서 코드펜스를 열고 닫는 걸 잊음.
    // 옛 fence 추적 방식이면 이후 모든 헤더가 fence 안으로 취급돼 이월이 통째 소실.
    // 새 방식은 canonical 이름 매칭 라인에서 fence 상태를 리셋해 이월을 살린다.
    const md = [
      "---", "date: 2026-09-14", "tags: [daily]", "---",
      "",
      "## 📌 할일",
      "```", // <- 여기서 fence 열고 닫지 않음
      "예시 코드",
      "",
      "## ✅ 이월된 할일",
      "- [ ] 어제 이월 (⏰ 1일째 이월, 09-13~)",
      "",
      "## 💬 메모",
      "",
    ].join("\n");
    const p = parseDailyNoteText(md, fromIsoDate("2026-09-14"));
    expect(p.carryoverBlocks).toHaveLength(1);
    expect(p.carryoverBlocks[0].topText).toBe("어제 이월");
  });

  it("헤더에 공백 없이 카운트가 붙어도 이월 인식 (`## ✅ 이월된 할일(3)`)", () => {
    // 사용자가 옛 스타일 흉내내며 공백을 빠뜨림. 옛 canonicalize 는 공백/탭만 허용해
    // 헤더 인식 실패로 이월이 통째 소실됐다. 새 방식은 이름 뒤 구두점도 허용.
    const md = [
      "---", "date: 2026-09-14", "tags: [daily]", "---",
      "",
      "## 📌 할일",
      "",
      "## ✅ 이월된 할일(3)", // 공백 없음
      "- [ ] X (⏰ 1일째 이월, 09-13~)",
      "",
      "## 💬 메모",
      "",
    ].join("\n");
    const p = parseDailyNoteText(md, fromIsoDate("2026-09-14"));
    expect(p.carryoverBlocks).toHaveLength(1);
    expect(p.carryoverBlocks[0].topText).toBe("X");
  });

  it("헤더 이름 바로 뒤 구두점 다양한 형태 모두 인식", () => {
    // 카운트가 붙는 여러 편집 패턴을 폭넓게 허용.
    const cases = [
      "## ✅ 이월된 할일(3)",
      "## ✅ 이월된 할일[3]",
      "## ✅ 이월된 할일-확인",
      "## ✅ 이월된 할일:주의",
      "## ✅ 이월된 할일•메모",
    ];
    for (const header of cases) {
      const md = [
        "---", "date: 2026-09-14", "tags: [daily]", "---",
        "", "## 📌 할일", "", header,
        "- [ ] X (⏰ 1일째 이월, 09-13~)",
        "", "## 💬 메모", "",
      ].join("\n");
      const p = parseDailyNoteText(md, fromIsoDate("2026-09-14"));
      expect(p.carryoverBlocks, `헤더 "${header}" 에서 이월 인식 실패`).toHaveLength(1);
    }
  });

  it("옛 섹션명(오늘의 목표/미완료 이월)도 하위호환 인식", () => {
    const md = makeLegacyDailyNoteMd({
      date: "2026-09-15",
      goalLines: ["- [ ] 옛 형식 할일"],
      carryoverLines: ["- [ ] 옛 형식 이월 (2일째 이월, 09-11~)"],
    });
    const p = parseDailyNoteText(md, fromIsoDate("2026-09-15"));
    expect(p.activeBlocks).toHaveLength(1);
    expect(p.carryoverBlocks).toHaveLength(1);
    expect(p.activeBlocks[0].topText).toBe("옛 형식 할일");
    expect(p.carryoverBlocks[0].carryoverDays).toBe(2);
  });
});

describe("parser: 최상위 라인 매치", () => {
  it("활성 미완료·완료·즉시 드롭 인식", () => {
    const md = makeDailyNoteMd({
      date: "2026-09-15",
      activeLines: ["- [ ] A", "- [x] B", "- [-] C"],
    });
    const p = parseDailyNoteText(md, fromIsoDate("2026-09-15"));
    expect(p.activeBlocks.map((b) => [b.topText, b.isCompleted, b.isDroppedImmediate])).toEqual([
      ["A", false, false],
      ["B", true, false],
      ["C", false, true],
    ]);
  });

  it("이월 태그 파싱 (일수·시작일)", () => {
    const md = makeDailyNoteMd({
      date: "2026-09-15",
      carryoverLines: ["- [ ] X (3일째 이월, 09-11~)"],
    });
    const p = parseDailyNoteText(md, fromIsoDate("2026-09-15"));
    expect(p.carryoverBlocks[0].topText).toBe("X");
    expect(p.carryoverBlocks[0].carryoverDays).toBe(3);
    expect(toIsoDate(p.carryoverBlocks[0].originDate!)).toBe("2026-09-11");
  });

  it("이월 섹션에서 CARRYOVER_SEPARATOR 정확히 일치하는 라인만 자식으로 삼키지 않는다", () => {
    // 라이터가 블록 사이에 구분선을 넣으므로, 파서가 이를 자식으로 취급하면
    // 다음날 재렌더링 시 라이터가 또 구분선을 붙여 중복이 누적된다.
    const md = makeDailyNoteMd({
      date: "2026-09-15",
      carryoverLines: [
        "- [ ] A (**2일째** 이월, 09-12~)",
        "    - sub note",
        "",
        CARRYOVER_SEPARATOR,
        "",
        "- [ ] B (**1일째** 이월, 09-14~)",
      ],
    });
    const p = parseDailyNoteText(md, fromIsoDate("2026-09-15"));
    expect(p.carryoverBlocks).toHaveLength(2);
    expect(p.carryoverBlocks[0].topText).toBe("A");
    expect(p.carryoverBlocks[0].children).toEqual(["    - sub note"]);
    expect(p.carryoverBlocks[1].topText).toBe("B");
    expect(p.carryoverBlocks[1].children).toEqual([]);
  });

  it("사용자가 자식에 넣은 `---` 는 보존된다 (CARRYOVER_SEPARATOR 정확 일치가 아님)", () => {
    // 이전 정책은 이월 섹션의 모든 `---` 을 자식에서 삼켰다.
    // 새 정책은 라이터가 실제로 삽입한 구분선(정확히 CARRYOVER_SEPARATOR) 만 걸러
    // 사용자가 하위 메모에 손으로 넣은 가로선은 그대로 보존한다.
    const md = makeDailyNoteMd({
      date: "2026-09-15",
      carryoverLines: [
        "- [ ] A (**2일째** 이월, 09-12~)",
        "    - 회의록 요약",
        "    ---",
        "    - 결론",
        "---",
        "    - 후속 조치",
      ],
    });
    const p = parseDailyNoteText(md, fromIsoDate("2026-09-15"));
    expect(p.carryoverBlocks).toHaveLength(1);
    expect(p.carryoverBlocks[0].children).toEqual([
      "    - 회의록 요약",
      "    ---",
      "    - 결론",
      "---",
      "    - 후속 조치",
    ]);
  });

  it("이월 태그 굵게(**N일째**) 새 포맷과 옛 포맷 모두 파싱", () => {
    const md = makeDailyNoteMd({
      date: "2026-09-15",
      carryoverLines: [
        "- [ ] Old (2일째 이월, 09-12~)",
        "- [ ] New (**2일째** 이월, 09-12~)",
        "- [ ] NewWithWarn (**4일째** 이월, 09-10~) (🔴 드롭 예정입니다)",
      ],
    });
    const p = parseDailyNoteText(md, fromIsoDate("2026-09-15"));
    expect(p.carryoverBlocks).toHaveLength(3);
    expect(p.carryoverBlocks[0].topText).toBe("Old");
    expect(p.carryoverBlocks[0].carryoverDays).toBe(2);
    expect(p.carryoverBlocks[1].topText).toBe("New");
    expect(p.carryoverBlocks[1].carryoverDays).toBe(2);
    expect(p.carryoverBlocks[2].topText).toBe("NewWithWarn");
    expect(p.carryoverBlocks[2].carryoverDays).toBe(4);
  });

  it("경고 이모지가 라인 맨 앞(옛 포맷)이든 괄호 안(새 포맷)이든 모두 인식", () => {
    const md = makeDailyNoteMd({
      date: "2026-09-15",
      carryoverLines: [
        // 옛 포맷: 이모지가 라인 맨 앞 + 접미부 이모지 없음
        "🟠 - [ ] Y (3일째 이월, 09-11~) (드롭 예정입니다)",
        "🔴 - [ ] Z (4일째 이월, 09-10~) (드롭 예정입니다)",
        // 새 포맷: 이모지가 접미부 괄호 안
        "- [ ] Y2 (3일째 이월, 09-11~) (🟠 드롭 예정입니다)",
        "- [ ] Z2 (4일째 이월, 09-10~) (🔴 드롭 예정입니다)",
      ],
    });
    const p = parseDailyNoteText(md, fromIsoDate("2026-09-15"));
    expect(p.carryoverBlocks[0].topText).toBe("Y");
    expect(p.carryoverBlocks[0].carryoverDays).toBe(3);
    expect(p.carryoverBlocks[1].topText).toBe("Z");
    expect(p.carryoverBlocks[1].carryoverDays).toBe(4);
    expect(p.carryoverBlocks[2].topText).toBe("Y2");
    expect(p.carryoverBlocks[2].carryoverDays).toBe(3);
    expect(p.carryoverBlocks[3].topText).toBe("Z2");
    expect(p.carryoverBlocks[3].carryoverDays).toBe(4);
  });
});

describe("parser: 마커", () => {
  it("#장기 / #보관 를 텍스트에서 감지", () => {
    const md = makeDailyNoteMd({
      date: "2026-09-15",
      activeLines: ["- [ ] A #장기", "- [ ] B #보관", "- [ ] C 그냥"],
    });
    const p = parseDailyNoteText(md, fromIsoDate("2026-09-15"));
    expect(p.activeBlocks[0].hasLongMarker).toBe(true);
    expect(p.activeBlocks[0].hasArchiveMarker).toBe(false);
    expect(p.activeBlocks[1].hasArchiveMarker).toBe(true);
    expect(p.activeBlocks[1].hasLongMarker).toBe(false);
    expect(p.activeBlocks[2].hasLongMarker).toBe(false);
    expect(p.activeBlocks[2].hasArchiveMarker).toBe(false);
  });
});

describe("parser: 블록 (하위 라인)", () => {
  it("들여쓰기 라인은 상위 블록에 종속", () => {
    const md = makeDailyNoteMd({
      date: "2026-09-15",
      activeLines: [
        "- [ ] Top A",
        "    - sub a1",
        "    - [x] sub a2",
        "        - deeper note",
        "- [ ] Top B",
        "    - sub b1",
      ],
    });
    const p = parseDailyNoteText(md, fromIsoDate("2026-09-15"));
    expect(p.activeBlocks).toHaveLength(2);
    expect(p.activeBlocks[0].topText).toBe("Top A");
    expect(p.activeBlocks[0].children).toEqual([
      "    - sub a1",
      "    - [x] sub a2",
      "        - deeper note",
    ]);
    expect(p.activeBlocks[1].topText).toBe("Top B");
    expect(p.activeBlocks[1].children).toEqual(["    - sub b1"]);
  });

  it("탭 인덴트도 인식", () => {
    const md = makeDailyNoteMd({
      date: "2026-09-15",
      activeLines: ["- [ ] Top", "\t- sub"],
    });
    const p = parseDailyNoteText(md, fromIsoDate("2026-09-15"));
    expect(p.activeBlocks[0].children).toEqual(["\t- sub"]);
  });

  it("중간 블록의 자식 뒤 빈 줄은 보존 (사용자 편집 존중)", () => {
    // 정책 변경: 이전엔 자식 뒤 blank 을 자동 트림했지만, 사용자가 시각적 여백 목적으로
    // 넣은 blank 을 지우는 부작용이 있었다. 이제 중간 블록은 blank 을 그대로 보존하고
    // 왕복 시 축적은 구분선 스마트 처리로 방지한다.
    const md = makeDailyNoteMd({
      date: "2026-09-15",
      activeLines: ["- [ ] A", "    - sub", "", "- [ ] B"],
    });
    const p = parseDailyNoteText(md, fromIsoDate("2026-09-15"));
    expect(p.activeBlocks[0].children).toEqual(["    - sub", ""]);
  });

  it("섹션 마지막 블록만 뒤 구조적 blank 1개를 제거 (축적 방지)", () => {
    // 마지막 블록은 뒤에 섹션 헤더가 오는데, 헤더 앞에는 라이터가 항상 blank 1개를
    // 삽입한다. 이 구조적 blank 을 남기면 왕복마다 blank 이 쌓이므로 정확히 1개 제거.
    // 그 이상의 사용자 편집 blank 은 보존.
    // 아래 fixture 는 사용자 blank 2개 + 라이터 구조적 blank 1개 = 총 3개.
    // 정책상 하나만 pop 하여 사용자 blank 2개는 보존.
    const md = makeDailyNoteMd({
      date: "2026-09-15",
      activeLines: ["- [ ] Only", "    - sub", "", ""],
    });
    const p = parseDailyNoteText(md, fromIsoDate("2026-09-15"));
    expect(p.activeBlocks[0].children).toEqual(["    - sub", "", ""]);
  });
});

describe("parser: 이월 origin 연도 해석", () => {
  it("월경계: 1월 노트에서 12-30 태그 → 작년으로", () => {
    const md = makeDailyNoteMd({
      date: "2026-01-05",
      carryoverLines: ["- [ ] X (3일째 이월, 12-30~)"],
    });
    const p = parseDailyNoteText(md, fromIsoDate("2026-01-05"));
    expect(toIsoDate(p.carryoverBlocks[0].originDate!)).toBe("2025-12-30");
  });
});
