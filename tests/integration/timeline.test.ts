/**
 * collectTimelineItems — 월간 종합 파일의 이벤트 라인 5종을 되돌려서 TimelineItem 목록을 만드는 파서.
 * 타임라인 뷰가 화면에 그리는 데이터의 진입점. 여기가 뚫리면 사용자 화면에서 이벤트가 통째로 사라짐.
 */
import { describe, it, expect } from "vitest";
import {
  collectTimelineItems,
  type TimelineItem,
} from "../../src/engine/writers/timeline";
import { fromIsoDate, toIsoDate } from "../../src/engine/dateutil";
import { dailyNotePath, monthlySummaryPath } from "../../src/engine/paths";
import { InMemoryVault } from "../helpers/inMemoryVault";
import { makeDailyNoteMd, makeSettings } from "../helpers/fixtures";

function withFixedToday<T>(iso: string, fn: () => T | Promise<T>): Promise<T> {
  const orig = Date;
  const [y, m, d] = iso.split("-").map((n) => parseInt(n, 10));
  const target = new orig(y, m - 1, d).getTime();
  // @ts-expect-error monkey patch for test determinism
  globalThis.Date = class extends orig {
    constructor(...args: unknown[]) {
      if (args.length === 0) super(target);
      else super(...(args as ConstructorParameters<typeof orig>));
    }
    static now() {
      return target;
    }
  };
  return Promise.resolve(fn()).finally(() => {
    globalThis.Date = orig;
  });
}

function seedSummary(vault: InMemoryVault, month: Date, body: string): void {
  const path = monthlySummaryPath(month, makeSettings());
  vault.seed(path, body);
}

function pickByName(items: TimelineItem[], name: string): TimelineItem | undefined {
  return items.find((i) => i.name === name);
}

describe("collectTimelineItems — 월간 종합 이벤트 5종 파싱", () => {
  it("당일 완료 라인 → status=done, start===end", async () => {
    const vault = new InMemoryVault();
    const month = fromIsoDate("2026-09-01");
    seedSummary(
      vault,
      month,
      [
        "# 2026-09 종합",
        "",
        "### ✅ 완료",
        "- 09-05 Same-day done (당일)",
        "",
      ].join("\n"),
    );
    // 미래 달 조회로 today carryover 병합을 배제 (파싱만 검증).
    await withFixedToday("2027-01-15", async () => {
      const items = await collectTimelineItems(month, vault, makeSettings());
      const it = pickByName(items, "Same-day done");
      expect(it).toBeDefined();
      expect(it!.status).toBe("done");
      expect(it!.section).toBe("완료");
      expect(toIsoDate(it!.start)).toBe("2026-09-05");
      expect(toIsoDate(it!.end)).toBe("2026-09-05");
    });
  });

  it("기간 완료 라인 → status=done, start=시작일, end=완료일", async () => {
    const vault = new InMemoryVault();
    const month = fromIsoDate("2026-09-01");
    seedSummary(
      vault,
      month,
      [
        "### ✅ 완료",
        "- 09-12 Long done (3영업일 소요, 09-08 시작)",
      ].join("\n"),
    );
    await withFixedToday("2027-01-15", async () => {
      const items = await collectTimelineItems(month, vault, makeSettings());
      const it = pickByName(items, "Long done");
      expect(it).toBeDefined();
      expect(it!.status).toBe("done");
      expect(toIsoDate(it!.start)).toBe("2026-09-08");
      expect(toIsoDate(it!.end)).toBe("2026-09-12");
    });
  });

  it("즉시 드롭 라인 → status=crit, start===end", async () => {
    const vault = new InMemoryVault();
    const month = fromIsoDate("2026-09-01");
    seedSummary(
      vault,
      month,
      [
        "### ⏭️ 드롭",
        "- 09-07 Bad idea (즉시 드롭)",
      ].join("\n"),
    );
    await withFixedToday("2027-01-15", async () => {
      const items = await collectTimelineItems(month, vault, makeSettings());
      const it = pickByName(items, "Bad idea");
      expect(it).toBeDefined();
      expect(it!.status).toBe("crit");
      expect(it!.section).toBe("드롭");
      expect(toIsoDate(it!.start)).toBe("2026-09-07");
      expect(toIsoDate(it!.end)).toBe("2026-09-07");
    });
  });

  it("origin 없는 드롭 라인 → status=crit, start===end (드롭일)", async () => {
    const vault = new InMemoryVault();
    const month = fromIsoDate("2026-09-01");
    seedSummary(
      vault,
      month,
      [
        "### ⏭️ 드롭",
        "- 09-15 No origin drop (5영업일 이월 후 드롭)",
      ].join("\n"),
    );
    await withFixedToday("2027-01-15", async () => {
      const items = await collectTimelineItems(month, vault, makeSettings());
      const it = pickByName(items, "No origin drop");
      expect(it).toBeDefined();
      expect(it!.status).toBe("crit");
      expect(toIsoDate(it!.start)).toBe("2026-09-15");
      expect(toIsoDate(it!.end)).toBe("2026-09-15");
    });
  });

  it("origin 있는 드롭 라인 → start=origin, end=드롭일", async () => {
    const vault = new InMemoryVault();
    const month = fromIsoDate("2026-09-01");
    seedSummary(
      vault,
      month,
      [
        "### ⏭️ 드롭",
        "- 09-20 Old drop (09-12 시작, 5영업일 이월 후 드롭)",
      ].join("\n"),
    );
    await withFixedToday("2027-01-15", async () => {
      const items = await collectTimelineItems(month, vault, makeSettings());
      const it = pickByName(items, "Old drop");
      expect(it).toBeDefined();
      expect(it!.status).toBe("crit");
      expect(toIsoDate(it!.start)).toBe("2026-09-12");
      expect(toIsoDate(it!.end)).toBe("2026-09-20");
    });
  });

  it("5종 라인을 모두 섞은 문서 → 정확한 개수·이름 목록으로 복원", async () => {
    const vault = new InMemoryVault();
    const month = fromIsoDate("2026-09-01");
    seedSummary(
      vault,
      month,
      [
        "# 2026-09 종합",
        "",
        "## 1주차 (09-01 ~ 09-04)",
        "",
        "### ✅ 완료",
        "- 09-02 A (당일)",
        "- 09-04 B (3영업일 소요, 09-01 시작)",
        "",
        "### ⏭️ 드롭",
        "- 09-03 C (즉시 드롭)",
        "",
        "## 2주차 (09-07 ~ 09-11)",
        "",
        "### ⏭️ 드롭",
        "- 09-10 D (5영업일 이월 후 드롭)",
        "- 09-11 E (09-04 시작, 6영업일 이월 후 드롭)",
        "",
      ].join("\n"),
    );
    await withFixedToday("2027-01-15", async () => {
      const items = await collectTimelineItems(month, vault, makeSettings());
      const names = items.map((i) => i.name).sort();
      expect(names).toEqual(["A", "B", "C", "D", "E"]);

      const completed = items.filter((i) => i.section === "완료").length;
      const dropped = items.filter((i) => i.section === "드롭").length;
      expect(completed).toBe(2);
      expect(dropped).toBe(3);
    });
  });

  it("오늘 데일리 노트의 이월 항목도 진행중 섹션으로 병합", async () => {
    const vault = new InMemoryVault();
    const settings = makeSettings();
    const month = fromIsoDate("2026-09-01");
    // 종합 문서는 완료 하나만.
    seedSummary(
      vault,
      month,
      ["### ✅ 완료", "- 09-05 done task (당일)", ""].join("\n"),
    );
    // 오늘(9-15) 데일리에 이월 항목 하나.
    await withFixedToday("2026-09-15", async () => {
      vault.seed(
        dailyNotePath(fromIsoDate("2026-09-15"), settings),
        makeDailyNoteMd({
          date: "2026-09-15",
          carryoverLines: ["- [ ] active carry (2일째 이월, 09-11~)"],
        }),
      );
      const items = await collectTimelineItems(month, vault, settings);
      const active = items.filter((i) => i.section === "진행중");
      expect(active.map((i) => i.name)).toContain("active carry");
      const carry = pickByName(items, "active carry")!;
      expect(carry.status).toBe("active");
      expect(toIsoDate(carry.start)).toBe("2026-09-11");
      expect(toIsoDate(carry.end)).toBe("2026-09-15");
    });
  });

  it("완료·드롭 항목은 발생일 데일리에서 children 자동 부착", async () => {
    const vault = new InMemoryVault();
    const settings = makeSettings();
    const month = fromIsoDate("2026-09-01");
    seedSummary(
      vault,
      month,
      ["### ✅ 완료", "- 09-05 Rich task (당일)", ""].join("\n"),
    );
    // 발생일(09-05) 데일리에 같은 이름의 활성 블록 + 하위 메모.
    vault.seed(
      dailyNotePath(fromIsoDate("2026-09-05"), settings),
      makeDailyNoteMd({
        date: "2026-09-05",
        activeLines: [
          "- [x] Rich task",
          "    - context line",
          "    - [x] sub done",
        ],
      }),
    );
    await withFixedToday("2027-01-15", async () => {
      const items = await collectTimelineItems(month, vault, settings);
      const it = pickByName(items, "Rich task")!;
      expect(it.children).toContain("    - context line");
      expect(it.children).toContain("    - [x] sub done");
    });
  });
});
