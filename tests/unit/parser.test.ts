import { describe, it, expect } from "vitest";
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

  it("블록 뒤 빈 줄은 트림", () => {
    const md = makeDailyNoteMd({
      date: "2026-09-15",
      activeLines: ["- [ ] A", "    - sub", "", "- [ ] B"],
    });
    const p = parseDailyNoteText(md, fromIsoDate("2026-09-15"));
    expect(p.activeBlocks[0].children).toEqual(["    - sub"]);
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
