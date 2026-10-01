/**
 * 월간 종합 · 드롭 · 보관함 writer 단위 검증.
 * 형식, 묶음 배치, 평균 계산, 같은 기록 재기록 방지(멱등성).
 */
import { describe, it, expect } from "vitest";
import { fromIsoDate } from "../../src/engine/dateutil";
import { makeBlock } from "../../src/engine/types";
import {
  appendEvent,
  ensureSummary,
  recomputeHeader,
} from "../../src/engine/writers/monthlySummary";
import { appendDropped, ensureDrop } from "../../src/engine/writers/monthlyDrop";
import { appendArchived, ensureArchive } from "../../src/engine/writers/archive";
import { InMemoryVault } from "../helpers/inMemoryVault";
import { makeSettings } from "../helpers/fixtures";

const settings = makeSettings();
const d = fromIsoDate;

describe("monthlySummary — 평균 완료 소요", () => {
  it("당일 완료는 0, 기간 완료는 영업일 수로 평균낸다", async () => {
    const vault = new InMemoryVault();
    const path = await ensureSummary(d("2026-09-01"), vault, settings);
    await appendEvent(path, "completed", d("2026-09-15"), makeBlock({ topText: "당일" }), vault);
    await appendEvent(
      path,
      "completed",
      d("2026-09-16"),
      makeBlock({ topText: "이틀", carryoverDays: 2, originDate: d("2026-09-14") }),
      vault,
    );
    await appendEvent(
      path,
      "completed",
      d("2026-09-17"),
      makeBlock({ topText: "나흘", carryoverDays: 4, originDate: d("2026-09-11") }),
      vault,
    );
    await recomputeHeader(path, vault);
    const out = vault.peek(path)!;
    expect(out).toContain("- 완료: 3건");
    expect(out).toContain("- 평균 완료 소요: 2.0 영업일");
  });

  it("완료가 없으면 평균은 `-`", async () => {
    const vault = new InMemoryVault();
    const path = await ensureSummary(d("2026-09-01"), vault, settings);
    await appendEvent(path, "dropped", d("2026-09-15"), makeBlock({ topText: "x", isDroppedImmediate: true }), vault);
    await recomputeHeader(path, vault);
    expect(vault.peek(path)!).toContain("- 평균 완료 소요: -");
    expect(vault.peek(path)!).toContain("- 드롭: 1건");
  });

  it("같은 날·같은 항목을 두 번 기록해도 한 줄만 남는다", async () => {
    const vault = new InMemoryVault();
    const path = await ensureSummary(d("2026-09-01"), vault, settings);
    const block = makeBlock({ topText: "끝낸일" });
    await appendEvent(path, "completed", d("2026-09-15"), block, vault);
    await appendEvent(path, "completed", d("2026-09-15"), block, vault);
    expect(vault.peek(path)!.split("\n").filter((l) => l.includes("끝낸일"))).toHaveLength(1);
  });

  it("같은 항목이라도 날짜가 다르면 각각 기록한다", async () => {
    const vault = new InMemoryVault();
    const path = await ensureSummary(d("2026-09-01"), vault, settings);
    const block = makeBlock({ topText: "매일 하는 일" });
    await appendEvent(path, "completed", d("2026-09-15"), block, vault);
    await appendEvent(path, "completed", d("2026-09-16"), block, vault);
    expect(vault.peek(path)!.split("\n").filter((l) => l.includes("매일 하는 일"))).toHaveLength(2);
  });
});

describe("monthlyDrop — 형식과 중복 방지", () => {
  it("즉시 드롭과 임계 드롭의 접미부 형식, 하위 메모 보존", async () => {
    const vault = new InMemoryVault();
    const path = await ensureDrop(d("2026-09-01"), vault, settings);
    await appendDropped(
      path,
      d("2026-09-15"),
      makeBlock({ topText: "즉시", isDroppedImmediate: true, children: ["\t- 메모"] }),
      vault,
    );
    await appendDropped(
      path,
      d("2026-09-16"),
      makeBlock({ topText: "오래됨", carryoverDays: 5, originDate: d("2026-09-09") }),
      vault,
    );
    const lines = vault.peek(path)!.split("\n");
    expect(lines).toContain("- [-] 즉시 (09-15 즉시 드롭)");
    expect(lines).toContain("\t- 메모");
    expect(lines).toContain("- [-] 오래됨 (09-09 시작, 09-16 드롭, 5영업일 이월)");
  });

  it("같은 기록을 두 번 넣어도 한 번만 남는다", async () => {
    const vault = new InMemoryVault();
    const path = await ensureDrop(d("2026-09-01"), vault, settings);
    const block = makeBlock({ topText: "즉시", isDroppedImmediate: true, children: ["\t- 메모"] });
    await appendDropped(path, d("2026-09-15"), block, vault);
    await appendDropped(path, d("2026-09-15"), block, vault);
    const lines = vault.peek(path)!.split("\n");
    expect(lines.filter((l) => l.startsWith("- [-] 즉시"))).toHaveLength(1);
    expect(lines.filter((l) => l === "\t- 메모")).toHaveLength(1);
  });
});

describe("monthlyDrop — 같은 항목이라도 날짜가 다르면 각각 기록", () => {
  it("되살렸다가 일주일 뒤 다시 드롭하면 두 번 남는다", async () => {
    const vault = new InMemoryVault();
    const path = await ensureDrop(d("2026-09-01"), vault, settings);
    const block = makeBlock({ topText: "다시 버린 일", isDroppedImmediate: true });
    await appendDropped(path, d("2026-09-15"), block, vault);
    await appendDropped(path, d("2026-09-22"), block, vault);
    expect(vault.peek(path)!.split("\n").filter((l) => l.startsWith("- [-] 다시 버린 일"))).toHaveLength(2);
  });
});

describe("archive — 같은 항목이라도 날짜가 다르면 각각 기록", () => {
  it("다른 날 다시 보관하면 두 번 남는다", async () => {
    const vault = new InMemoryVault();
    const path = await ensureArchive(vault, settings);
    const block = makeBlock({ topText: "다시 보관" });
    await appendArchived(path, d("2026-09-15"), block, vault);
    await appendArchived(path, d("2026-09-22"), block, vault);
    expect(vault.peek(path)!.split("\n").filter((l) => l.startsWith("- [ ] 다시 보관"))).toHaveLength(2);
  });
});

describe("archive — 월별 묶음과 중복 방지", () => {
  it("같은 달은 한 묶음 끝에 이어 붙이고, 새 달은 새 묶음을 만든다", async () => {
    const vault = new InMemoryVault();
    const path = await ensureArchive(vault, settings);
    await appendArchived(path, d("2026-09-15"), makeBlock({ topText: "A", children: ["\t- a1"] }), vault);
    await appendArchived(path, d("2026-10-01"), makeBlock({ topText: "C" }), vault);
    await appendArchived(path, d("2026-09-20"), makeBlock({ topText: "B" }), vault);
    const lines = vault.peek(path)!.split("\n");
    const sep = lines.indexOf("## 2026-09");
    const oct = lines.indexOf("## 2026-10");
    expect(sep).toBeGreaterThan(-1);
    expect(oct).toBeGreaterThan(sep);
    expect(lines.slice(sep + 1, sep + 4)).toEqual([
      "- [ ] A (보관: 09-15)",
      "\t- a1",
      "- [ ] B (보관: 09-20)",
    ]);
    expect(lines[oct + 1]).toBe("- [ ] C (보관: 10-01)");
    expect(lines.filter((l) => l.startsWith("## 2026-09"))).toHaveLength(1);
  });

  it("같은 기록을 두 번 넣어도 한 번만 남는다", async () => {
    const vault = new InMemoryVault();
    const path = await ensureArchive(vault, settings);
    const block = makeBlock({ topText: "A", children: ["\t- a1"] });
    await appendArchived(path, d("2026-09-15"), block, vault);
    await appendArchived(path, d("2026-09-15"), block, vault);
    const lines = vault.peek(path)!.split("\n");
    expect(lines.filter((l) => l.startsWith("- [ ] A"))).toHaveLength(1);
    expect(lines.filter((l) => l === "\t- a1")).toHaveLength(1);
  });
});
