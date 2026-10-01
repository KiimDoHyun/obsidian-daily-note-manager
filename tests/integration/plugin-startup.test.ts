/**
 * 플러그인 시작 시뮬레이션 — 실제 옵시디언을 켜지 않고 onload 전체 흐름을 돌린다.
 *
 * 엔진만 따로 검증하는 다른 테스트와 달리, 여기서는 실제 코드 경로 그대로 간다.
 *   onload → 레이아웃 준비 신호 → 스케줄러 첫 tick → engine.createForToday
 *   → VaultAdapter(실제 어댑터) → 가짜 Obsidian Vault API
 *
 * 가짜 Vault 는 실제 옵시디언이 엄격하게 구는 지점을 그대로 흉내 낸다.
 *   - 이미 있는 경로에 create 하면 에러 ("File already exists.")
 *   - 이미 있는 폴더에 createFolder 하면 에러
 *   - 상위 폴더가 없는 곳에 create 하면 에러
 * 날짜는 Date 를 고정해 흉내 내므로 "휴가 다녀온 월요일" 같은 상황도 즉시 재현된다.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as obsidian from "obsidian";
import { TFile, TFolder } from "obsidian";
import { fromIsoDate } from "../../src/engine/dateutil";
import { dailyNotePath, monthlySummaryPath } from "../../src/engine/paths";
import { makeDailyNoteMd, makeSettings } from "../helpers/fixtures";
import type { DailyNoteSettings } from "../../src/settings";
import { withFixedToday } from "../helpers/fixedDate";

/** 실제 옵시디언 Vault API 의 엄격한 동작을 흉내 내는 가짜. */
class FakeObsidianVault {
  files = new Map<string, string>();
  folders = new Set<string>();

  getName(): string {
    return "fake-vault";
  }
  getAbstractFileByPath(p: string): TFile | TFolder | null {
    if (this.files.has(p)) return Object.assign(new TFile(), { path: p });
    if (this.folders.has(p)) return Object.assign(new TFolder(), { path: p });
    return null;
  }
  async read(f: TFile & { path: string }): Promise<string> {
    // 실제 디스크처럼 한 번 양보해 비동기 interleave 가 드러나게 한다.
    await new Promise((r) => setTimeout(r, 0));
    const c = this.files.get(f.path);
    if (c === undefined) throw new Error(`ENOENT ${f.path}`);
    return c;
  }
  async modify(f: TFile & { path: string }, content: string): Promise<void> {
    await new Promise((r) => setTimeout(r, 0));
    this.files.set(f.path, content);
  }
  async create(p: string, content: string): Promise<TFile> {
    await new Promise((r) => setTimeout(r, 0));
    if (this.files.has(p)) throw new Error("File already exists.");
    const parent = p.substring(0, p.lastIndexOf("/"));
    if (parent && !this.folders.has(parent)) throw new Error(`ENOENT parent ${parent}`);
    this.files.set(p, content);
    return Object.assign(new TFile(), { path: p });
  }
  async createFolder(p: string): Promise<void> {
    if (this.folders.has(p) || this.files.has(p)) throw new Error("Folder already exists.");
    this.folders.add(p);
  }
  /** 테스트 시드: 파일과 상위 폴더를 한 번에 만든다. */
  seed(p: string, content: string): void {
    const parts = p.split("/");
    for (let i = 1; i < parts.length; i++) this.folders.add(parts.slice(0, i).join("/"));
    this.files.set(p, content);
  }
}

interface Harness {
  vault: FakeObsidianVault;
  plugin: {
    settings: DailyNoteSettings;
    onload(): Promise<void>;
  };
  layoutReady(): void;
  commands: Map<string, () => Promise<void>>;
}

async function bootPlugin(initial: Partial<DailyNoteSettings>, seed: (v: FakeObsidianVault, s: DailyNoteSettings) => void): Promise<Harness> {
  const vault = new FakeObsidianVault();
  seed(vault, makeSettings(initial));
  let readyCb: (() => void) | null = null;
  const app = {
    vault,
    fileManager: {
      trashFile: async (f: { path: string }) => {
        vault.files.delete(f.path);
      },
    },
    workspace: {
      onLayoutReady: (cb: () => void) => {
        readyCb = cb;
      },
      getLeavesOfType: () => [],
    },
  };
  const { default: DailyNoteManagerPlugin } = await import("../../src/main");
  const plugin = new (DailyNoteManagerPlugin as unknown as new (a: unknown, m: unknown) => Harness["plugin"] & {
    loadData(): Promise<unknown>;
    addCommand(c: { id: string; callback: () => Promise<void> }): void;
  })(app, {});
  const commands = new Map<string, () => Promise<void>>();
  plugin.loadData = async () => ({ ...initial });
  plugin.addCommand = (c) => {
    commands.set(c.id, c.callback);
  };
  await plugin.onload();
  return {
    vault,
    plugin,
    layoutReady: () => readyCb?.(),
    commands,
  };
}

/** 대기 중인 비동기 작업(첫 tick 등)이 모두 끝날 때까지 기다린다. */
async function settle(): Promise<void> {
  for (let i = 0; i < 200; i++) await new Promise((r) => setTimeout(r, 0));
}

function notes(vault: FakeObsidianVault): string[] {
  return [...vault.files.keys()].filter((p) => p.includes("📅")).map((p) => p.slice(-13, -3)).sort();
}

describe("플러그인 시작 시뮬레이션 (onload → 스케줄러 → 엔진 → 실제 VaultAdapter)", () => {
  beforeEach(() => {
    (globalThis as unknown as { window: unknown }).window = { setInterval: () => 1 };
  });
  afterEach(() => {
    delete (globalThis as unknown as { window?: unknown }).window;
    vi.restoreAllMocks();
  });

  it("레이아웃 준비 전에는 아무 파일도 쓰지 않는다", async () => {
    await withFixedToday("2026-09-21", async () => {
      const h = await bootPlugin({ lastRunDate: "2026-09-16" }, (v, s) =>
        v.seed(dailyNotePath(fromIsoDate("2026-09-16"), s), makeDailyNoteMd({ date: "2026-09-16", activeLines: ["- [ ] 업무A"] })),
      );
      await settle();
      expect(notes(h.vault)).toEqual(["2026-09-16"]);
    });
  });

  it("수요일 이후 처음 켠 월요일: 오늘(월) 노트만 만들고 이월 일수는 목·금·월 3일", async () => {
    await withFixedToday("2026-09-21", async () => {
      const s = makeSettings();
      const h = await bootPlugin({ lastRunDate: "2026-09-16" }, (v) =>
        v.seed(dailyNotePath(fromIsoDate("2026-09-16"), s), makeDailyNoteMd({ date: "2026-09-16", activeLines: ["- [ ] 업무A"] })),
      );
      const created: string[] = [];
      const origCreate = h.vault.create.bind(h.vault);
      h.vault.create = async (p: string, c: string) => {
        if (p.includes("📅")) created.push(p.slice(-13, -3));
        return origCreate(p, c);
      };

      h.layoutReady();
      await settle();

      expect(created).toEqual(["2026-09-21"]);
      const mon = h.vault.files.get(dailyNotePath(fromIsoDate("2026-09-21"), s))!;
      expect(mon).toContain("- [ ] 업무A (⏰ 3일째 이월, 09-16~)");
      expect(h.plugin.settings.lastRunDate).toBe("2026-09-21");
    });
  });

  it("시작과 동시에 '오늘 노트 생성' 명령을 눌러도 중복 생성·중복 기록이 없다", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    await withFixedToday("2026-09-18", async () => {
      const s = makeSettings();
      const h = await bootPlugin({ lastRunDate: "2026-09-17" }, (v) =>
        v.seed(dailyNotePath(fromIsoDate("2026-09-17"), s), makeDailyNoteMd({ date: "2026-09-17", activeLines: ["- [x] 끝낸일"] })),
      );

      h.layoutReady();
      await Promise.all([h.commands.get("create-today")!(), settle()]);
      await settle();

      expect(notes(h.vault)).toEqual(["2026-09-17", "2026-09-18"]);
      const sum = h.vault.files.get(monthlySummaryPath(fromIsoDate("2026-09-17"), s))!;
      expect(sum.split("\n").filter((l) => l.includes("끝낸일"))).toHaveLength(1);
      // 실제 어댑터가 "이미 있는 파일 create" 에러를 한 번도 내지 않았어야 한다.
      expect(console.error).not.toHaveBeenCalled();
    });
  });

  it("앱을 켜둔 채 자정을 넘기면 다음 tick 에서 새 날 노트를 만든다", async () => {
    let intervalCb: (() => void) | null = null;
    (globalThis as unknown as { window: unknown }).window = {
      setInterval: (cb: () => void) => {
        intervalCb = cb;
        return 1;
      },
    };
    const s = makeSettings();
    let h!: Harness;
    await withFixedToday("2026-09-17", async () => {
      h = await bootPlugin({ lastRunDate: "2026-09-16" }, (v) =>
        v.seed(dailyNotePath(fromIsoDate("2026-09-16"), s), makeDailyNoteMd({ date: "2026-09-16", activeLines: ["- [ ] 업무A"] })),
      );
      h.layoutReady();
      await settle();
    });
    await withFixedToday("2026-09-18", async () => {
      intervalCb!();
      await settle();
    });
    expect(notes(h.vault)).toEqual(["2026-09-16", "2026-09-17", "2026-09-18"]);
    expect(h.vault.files.get(dailyNotePath(fromIsoDate("2026-09-18"), s))!).toContain("업무A (⏰ 2일째 이월, 09-16~)");
  });

  it("예전 버전 설정 파일(자동 catch-up 끔, 최대 일수 3)을 읽어도 옛 항목은 버리고 오늘 노트를 만든다", async () => {
    await withFixedToday("2026-09-21", async () => {
      const s = makeSettings();
      const old = { lastRunDate: "2026-09-16", autoRunOnLoad: false, maxCatchUpDays: 3 };
      const h = await bootPlugin(old as Partial<DailyNoteSettings>, (v) =>
        v.seed(dailyNotePath(fromIsoDate("2026-09-16"), s), makeDailyNoteMd({ date: "2026-09-16", activeLines: ["- [ ] 업무A"] })),
      );
      expect(h.plugin.settings).not.toHaveProperty("autoRunOnLoad");
      expect(h.plugin.settings).not.toHaveProperty("maxCatchUpDays");
      h.layoutReady();
      await settle();
      expect(h.vault.files.get(dailyNotePath(fromIsoDate("2026-09-21"), s))!).toContain("업무A (⏰ 3일째 이월, 09-16~)");
    });
  });

  it("오늘 노트 자동 생성이 실패하면 알림을 날짜당 한 번만 띄우고, 다음 tick 에 다시 시도한다", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const notices: string[] = [];
    vi.spyOn(obsidian, "Notice").mockImplementation(
      // @ts-expect-error 반환 타입은 Notice 지만 테스트에서 참조 안 함
      (msg: string) => {
        notices.push(msg);
        return {};
      },
    );
    let intervalCb: (() => void) | null = null;
    (globalThis as unknown as { window: unknown }).window = {
      setInterval: (cb: () => void) => {
        intervalCb = cb;
        return 1;
      },
    };
    await withFixedToday("2026-09-18", async () => {
      const s = makeSettings();
      const h = await bootPlugin({ lastRunDate: "2026-09-17" }, () => {});
      const todayPath = dailyNotePath(fromIsoDate("2026-09-18"), s);
      const create = h.vault.create.bind(h.vault);
      let blocked = true;
      h.vault.create = async (p: string, c: string) => {
        if (p === todayPath && blocked) throw new Error("disk busy");
        return create(p, c);
      };

      h.layoutReady();
      await settle();
      intervalCb!();
      await settle();
      expect(notices).toHaveLength(1);
      expect(notices[0]).toContain("disk busy");
      expect(h.vault.files.has(todayPath)).toBe(false);

      blocked = false;
      intervalCb!();
      await settle();
      expect(h.vault.files.has(todayPath)).toBe(true);
      expect(notices).toHaveLength(1);
    });
  });
});

