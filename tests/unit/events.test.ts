import { describe, it, expect } from "vitest";
import { fromIsoDate, toIsoDate } from "../../src/engine/dateutil";
import { classifyEvents } from "../../src/engine/events";
import { makeBlock, type DailyNoteParsed } from "../../src/engine/types";

const noteDate = (iso: string) => fromIsoDate(iso);

function parsedWith(overrides: Partial<DailyNoteParsed>): DailyNoteParsed {
  return {
    noteDate: noteDate("2026-09-15"),
    activeBlocks: [],
    carryoverBlocks: [],
    memoLines: [],
    ...overrides,
  };
}

describe("classifyEvents: 활성 블록", () => {
  it("[-] 우선 → dropped", () => {
    const e = classifyEvents(
      parsedWith({
        activeBlocks: [makeBlock({ topText: "X", isDroppedImmediate: true })],
      }),
    );
    expect(e.dropped).toHaveLength(1);
    expect(e.carryingOver).toHaveLength(0);
  });

  it("[x] → completed (당일, origin = source note date)", () => {
    const e = classifyEvents(
      parsedWith({
        activeBlocks: [makeBlock({ topText: "X", isCompleted: true })],
      }),
    );
    expect(e.completed).toHaveLength(1);
    expect(e.completed[0].carryoverDays).toBe(0);
    expect(toIsoDate(e.completed[0].originDate!)).toBe("2026-09-15");
  });

  it("#보관 → archived", () => {
    const e = classifyEvents(
      parsedWith({
        activeBlocks: [makeBlock({ topText: "X #보관", hasArchiveMarker: true })],
      }),
    );
    expect(e.archived).toHaveLength(1);
  });

  it("그 외 → 1일째로 carryingOver, origin = source note date", () => {
    const e = classifyEvents(
      parsedWith({
        activeBlocks: [makeBlock({ topText: "X" })],
      }),
    );
    expect(e.carryingOver).toHaveLength(1);
    expect(e.carryingOver[0].carryoverDays).toBe(1);
    expect(toIsoDate(e.carryingOver[0].originDate!)).toBe("2026-09-15");
  });

  it("우선순위: [x] #보관 이면 completed (체크가 보관보다 우선)", () => {
    const e = classifyEvents(
      parsedWith({
        activeBlocks: [
          makeBlock({
            topText: "X #보관",
            isCompleted: true,
            hasArchiveMarker: true,
          }),
        ],
      }),
    );
    expect(e.completed).toHaveLength(1);
    expect(e.archived).toHaveLength(0);
  });
});

describe("classifyEvents: 이월 블록 카운터", () => {
  it("2일째 이월 → 3일째로 carryingOver (origin 유지)", () => {
    const e = classifyEvents(
      parsedWith({
        carryoverBlocks: [
          makeBlock({
            topText: "X",
            carryoverDays: 2,
            originDate: fromIsoDate("2026-09-11"),
          }),
        ],
      }),
    );
    expect(e.carryingOver).toHaveLength(1);
    expect(e.carryingOver[0].carryoverDays).toBe(3);
    expect(toIsoDate(e.carryingOver[0].originDate!)).toBe("2026-09-11");
  });

  it("4일째 이월 → 5일째 도달 → 드롭 (#장기 없음)", () => {
    const e = classifyEvents(
      parsedWith({
        carryoverBlocks: [
          makeBlock({
            topText: "X",
            carryoverDays: 4,
            originDate: fromIsoDate("2026-09-09"),
          }),
        ],
      }),
    );
    expect(e.dropped).toHaveLength(1);
    expect(e.dropped[0].carryoverDays).toBe(5);
    expect(e.carryingOver).toHaveLength(0);
  });

  it("4일째 이월 + #장기 → 5일째 도달해도 계속 carryingOver", () => {
    const e = classifyEvents(
      parsedWith({
        carryoverBlocks: [
          makeBlock({
            topText: "X #장기",
            hasLongMarker: true,
            carryoverDays: 4,
            originDate: fromIsoDate("2026-09-09"),
          }),
        ],
      }),
    );
    expect(e.carryingOver).toHaveLength(1);
    expect(e.carryingOver[0].carryoverDays).toBe(5);
    expect(e.dropped).toHaveLength(0);
  });

  it("이월 [x] 체크 → completed (원본 카운터/원본 origin 유지)", () => {
    const e = classifyEvents(
      parsedWith({
        carryoverBlocks: [
          makeBlock({
            topText: "X",
            isCompleted: true,
            carryoverDays: 3,
            originDate: fromIsoDate("2026-09-10"),
          }),
        ],
      }),
    );
    expect(e.completed).toHaveLength(1);
    expect(e.completed[0].carryoverDays).toBe(3);
    expect(toIsoDate(e.completed[0].originDate!)).toBe("2026-09-10");
  });

  it("이월 #보관 → archived", () => {
    const e = classifyEvents(
      parsedWith({
        carryoverBlocks: [
          makeBlock({
            topText: "X #보관",
            hasArchiveMarker: true,
            carryoverDays: 2,
            originDate: fromIsoDate("2026-09-11"),
          }),
        ],
      }),
    );
    expect(e.archived).toHaveLength(1);
    expect(e.archived[0].carryoverDays).toBe(2);
  });
});

describe("classifyEvents: children 보존", () => {
  it("이월된 블록의 children 이 그대로 유지", () => {
    const e = classifyEvents(
      parsedWith({
        carryoverBlocks: [
          makeBlock({
            topText: "X",
            children: ["    - sub", "    - [x] done sub"],
            carryoverDays: 1,
            originDate: fromIsoDate("2026-09-12"),
          }),
        ],
      }),
    );
    expect(e.carryingOver[0].children).toEqual(["    - sub", "    - [x] done sub"]);
  });
});
