import type { DailyNoteSettings } from "../settings";
import {
  addDays,
  fromIsoDate,
  isWeekend,
  nextBusinessDay,
  previousBusinessDay,
  today as todayDate,
  toIsoDate,
  ymOf,
} from "./dateutil";
import { classifyEvents } from "./events";
import { parseDailyNoteText } from "./parser";
import { archivePath, dailyNotePath, monthlyDropPath, monthlySummaryPath } from "./paths";
import {
  emptyEvents,
  emptyParsed,
  type DailyNoteParsed,
  type Events,
  type TaskBlock,
} from "./types";
import type { VaultLike } from "./vault";
import { renderDailyNote } from "./writers/dailyNote";
import { appendArchived, ensureArchive } from "./writers/archive";
import { appendDropped, ensureDrop } from "./writers/monthlyDrop";
import {
  appendEvent as appendSummaryEvent,
  ensureSummary,
  recomputeHeader,
  type SummaryEventType,
} from "./writers/monthlySummary";
import { drainQueue, enqueue, type PendingEntry } from "./writers/pendingQueue";
import { stripTimelineSection } from "./writers/timeline";

export type RunStatus =
  | "created"
  | "skipped_weekend"
  | "skipped_exists"
  | "dry_run";

/** 마지막 실행 기록이 없을 때(첫 실행 등) 이전 노트를 찾아볼 최대 일수. */
const FIRST_RUN_LOOKBACK_DAYS = 14;

/** 발생 날짜가 붙은 이벤트. 날짜가 곧 기록될 달 문서를 정한다. */
interface DatedEvent {
  eventType: SummaryEventType;
  date: Date;
  block: TaskBlock;
}

export interface RunResult {
  status: RunStatus;
  today: Date;
  todayPath: string | null;
  prevDate: Date | null;
  prevPath: string | null;
  events: Events | null;
  detail?: string;
}

export interface CreateResult {
  created: boolean;
  status: RunStatus;
  path: string;
  today: Date;
  /** 이월 항목 수 */
  carriedOver: number;
  /** 완료 이벤트 수 */
  completed: number;
  /** 드롭 이벤트 수 */
  dropped: number;
  /** 보관 이벤트 수 */
  archived: number;
  /** 로그·테스트용 한글 요약 문자열 (Notice 표시용 아님, UI 는 locale 별로 별도 포맷) */
  message: string;
}

export interface DryRunReport {
  targetDate: string;
  carriedOver: string[];
  toDrop: string[];
  toArchive: string[];
  toComplete: string[];
  summary: string;
}

export interface DoctorReport {
  ok: boolean;
  issues: string[];
  vaultRoot: string;
  notesSubdir: string;
  todayPath: string;
  lastRunDate: string | null;
}

export class Engine {
  constructor(
    private vault: VaultLike,
    private settings: DailyNoteSettings,
    private saveSettings: () => Promise<void>,
    /** doctor() 용 표시명. 없으면 "(vault)" */
    private vaultDisplayName: string = "(vault)",
  ) {}

  /**
   * 엔진 실행 잠금. 노트 생성·재생성·대기열 처리처럼 볼트를 쓰는 작업은 이 사슬에 줄을 서서
   * 한 번에 하나씩만 돈다. 스케줄러·명령어가 동시에 불러도 "둘 다 오늘 노트가 없다고 보고
   * 같은 기록을 두 번 남기는" 일이 생기지 않는다.
   */
  private lock: Promise<unknown> = Promise.resolve();

  private serialize<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.lock.then(fn, fn);
    this.lock = run.catch(() => undefined);
    return run;
  }

  updateSettings(settings: DailyNoteSettings): void {
    this.settings = settings;
  }

  /**
   * 하루 실행의 단일 진입점. 스케줄러는 이것만 부른다.
   * 며칠을 비웠든 오늘 노트 하나만 만든다. 그 사이 날짜의 노트는 만들지 않지만,
   * 이월 일수·드롭은 그 사이 날마다 노트가 있었던 것처럼 계산한다(runCreate 의 simulate).
   */
  async runDaily(): Promise<CreateResult> {
    return this.createForToday();
  }

  async createForToday(): Promise<CreateResult> {
    return this.serialize(async () => this.toCreateResult(await this.runCreate(todayDate(), false)));
  }

  async dryRun(): Promise<DryRunReport> {
    const result = await this.runCreate(todayDate(), true);
    return this.toDryRunReport(result);
  }

  async forceDate(target: Date): Promise<CreateResult> {
    return this.serialize(async () => {
      const path = dailyNotePath(target, this.settings);
      if (this.vault.exists(path)) await this.vault.remove(path);
      return this.toCreateResult(await this.runCreate(target, false));
    });
  }

  async recomputeMonth(yearMonth: string): Promise<void> {
    return this.serialize(async () => {
      const [y, m] = yearMonth.split("-").map((n) => parseInt(n, 10));
      const monthDate = new Date(y, m - 1, 1);
      const path = await ensureSummary(monthDate, this.vault, this.settings);
      await recomputeHeader(path, this.vault);
    });
  }

  async doctor(): Promise<DoctorReport> {
    const issues: string[] = [];
    const today = todayDate();
    const path = dailyNotePath(today, this.settings);
    if (!this.settings.notesSubdir) issues.push("notesSubdir 미설정");
    else if (!this.vault.exists(this.settings.notesSubdir)) {
      issues.push(`노트 폴더 없음: ${this.settings.notesSubdir}`);
    }
    return {
      ok: issues.length === 0,
      issues,
      vaultRoot: this.vaultDisplayName,
      notesSubdir: this.settings.notesSubdir,
      todayPath: path,
      lastRunDate: this.settings.lastRunDate,
    };
  }

  // ---------- internal ----------

  /** 대기 큐를 명시적으로 재시도. 명령어에서 직접 호출. */
  async drainPendingQueue(): Promise<{ drained: number; remaining: number }> {
    return this.serialize(() => drainQueue(this.vault, this.settings));
  }

  private async runCreate(today: Date, dryRun: boolean): Promise<RunResult> {
    if (this.settings.skipWeekend && isWeekend(today)) {
      return this.result("skipped_weekend", today, null, null, null, null, `${toIsoDate(today)} 주말`);
    }

    const todayPath = dailyNotePath(today, this.settings);

    // 이미 존재하는 경우에도 대기열은 재시도한다. dry-run 은 순수 조회이므로 큐를 건드리지 않는다.
    if (this.vault.exists(todayPath)) {
      if (!dryRun) await this.tryDrainQueue();
      return this.result("skipped_exists", today, todayPath, null, null, null, "이미 존재");
    }

    const { prevDate, prevPath } = await this.findPreviousNote(today);
    let parsed: DailyNoteParsed;
    let effectivePrevDate = prevDate;
    if (prevPath !== null && prevDate !== null) {
      const raw = await this.vault.read(prevPath);
      parsed = parseDailyNoteText(raw, prevDate);
    } else {
      const fallback = addDays(today, -1);
      parsed = emptyParsed(fallback);
      effectivePrevDate = fallback;
    }

    const { events, dated } = this.simulate(parsed, effectivePrevDate!, today);

    if (dryRun) {
      return this.result("dry_run", today, todayPath, effectivePrevDate, prevPath, events, "dry-run");
    }

    // 실제 실행. 순서 규칙:
    // 1) 대기 큐부터 재시도 (이전 실행 실패분 복구 시도).
    // 2) 오늘 데일리 노트를 먼저 쓴다. 이후 어떤 실패가 나도 오늘 노트는 반드시 남는다.
    // 3) 종합/드롭/보관 쓰기는 실패 시 대기 큐로 밀어 넣는다. 이벤트는 발생한 날짜의 달 문서로 간다.
    // 4) 헤더 재계산·타임라인 후처리는 관련된 달마다 개별 try/catch 로 격리한다.
    await this.tryDrainQueue();

    // 직접 [-] 로 지운 항목은 사용자가 이미 알고 있으므로, 기준일 도달로 자동 드롭된 것만 알린다.
    const autoDropped = dated
      .filter((e) => e.eventType === "dropped" && !e.block.isDroppedImmediate)
      .map((e) => ({ block: e.block, date: e.date }));
    await this.vault.write(
      todayPath,
      renderDailyNote(today, events.carryingOver, this.settings, autoDropped),
    );

    const touchedMonths = await this.appendEventsInOrder(dated);

    // 이번 달 + 이전 노트의 달 + 이벤트가 기록된 달 모두 종합 문서를 갖추고 요약 숫자를 다시 센다.
    const months = new Map<string, Date>();
    for (const d of [today, effectivePrevDate!, ...touchedMonths]) months.set(ymOf(d), d);
    for (const d of months.values()) {
      try {
        const path = await ensureSummary(d, this.vault, this.settings);
        await recomputeHeader(path, this.vault);
      } catch (err) {
        console.error(`[daily-note] ${ymOf(d)} 종합 헤더 재계산 실패`, err);
      }
      try {
        await stripTimelineSection(d, this.vault, this.settings);
      } catch (err) {
        console.error(`[daily-note] ${ymOf(d)} 종합 문서 타임라인 섹션 정리 실패`, err);
      }
    }

    this.settings.lastRunDate = toIsoDate(today);
    try {
      await this.saveSettings();
    } catch (err) {
      console.error("[daily-note] 설정 저장 실패", err);
    }

    return this.result("created", today, todayPath, effectivePrevDate, prevPath, events);
  }

  /**
   * 이전 노트 날짜부터 오늘 직전까지, 노트가 있었을 날마다 분류를 한 번씩 돌린다(메모리 안에서만).
   * - 첫 단계: 이전 노트 그대로 → 완료·보관·즉시 드롭·임계 드롭·이월
   * - 다음 단계들: 이월 항목만 담은 가상의 노트 → 임계 드롭·이월
   * 이벤트 날짜는 그 항목이 마지막으로 노트에 있었을 날짜(매일 노트를 만들었을 때와 동일).
   * 평소처럼 어제 노트에서 이어지면 단계는 한 번뿐이라 기존 동작과 같다.
   */
  private simulate(
    parsed: DailyNoteParsed,
    prevDate: Date,
    today: Date,
  ): { events: Events; dated: DatedEvent[] } {
    const nextNoteDay = (d: Date) =>
      this.settings.skipWeekend ? nextBusinessDay(d) : addDays(d, 1);
    const events = emptyEvents();
    const dated: DatedEvent[] = [];
    let state = parsed;
    let cur = prevDate;
    for (;;) {
      const step = classifyEvents(state, this.settings.dropThresholdDays);
      for (const block of step.completed) dated.push({ eventType: "completed", date: cur, block });
      for (const block of step.dropped) dated.push({ eventType: "dropped", date: cur, block });
      for (const block of step.archived) dated.push({ eventType: "archived", date: cur, block });
      events.completed.push(...step.completed);
      events.dropped.push(...step.dropped);
      events.archived.push(...step.archived);

      const next = nextNoteDay(cur);
      if (next >= today || step.carryingOver.length === 0) {
        events.carryingOver = step.carryingOver;
        return { events, dated };
      }
      state = { noteDate: next, activeBlocks: [], carryoverBlocks: step.carryingOver, memoLines: [] };
      cur = next;
    }
  }

  private async tryDrainQueue(): Promise<void> {
    try {
      await drainQueue(this.vault, this.settings);
    } catch (err) {
      console.error("[daily-note] 대기열 처리 중 오류", err);
    }
  }

  private async enqueueEvent(entry: PendingEntry): Promise<void> {
    try {
      await enqueue(entry, this.vault, this.settings);
    } catch (err) {
      console.error(
        "[daily-note] 대기열 저장 실패 — 이벤트 유실",
        entry.eventType,
        entry.eventDate,
        entry.block.topText,
        err,
      );
    }
  }

  /**
   * 이벤트를 발생 날짜의 달 문서에 기록한다. 어느 쓰기든 실패하면 그 건만 대기열로 보낸다.
   * - 완료: 월간 종합
   * - 드롭: 월간 드롭 문서(항목 + 하위 메모) + 월간 종합
   * - 보관: 보관함(항목 + 하위 메모) + 월간 종합
   * 기록한(또는 기록하려 한) 이벤트 날짜들을 돌려준다 — 호출 측이 그 달들의 요약을 다시 센다.
   */
  private async appendEventsInOrder(dated: DatedEvent[]): Promise<Date[]> {
    const summaryPaths = new Map<string, string | null>();
    const dropPaths = new Map<string, string | null>();
    let arcPath: string | null | undefined;

    const prepare = async <T>(
      cache: Map<string, T | null>,
      key: string,
      make: () => Promise<T>,
      label: string,
    ): Promise<T | null> => {
      if (!cache.has(key)) {
        try {
          cache.set(key, await make());
        } catch (err) {
          console.error(`[daily-note] ${label} 준비 실패 → 대기열 저장`, err);
          cache.set(key, null);
        }
      }
      return cache.get(key) ?? null;
    };

    const toSummary = async (e: DatedEvent) => {
      const summaryPath = await prepare(summaryPaths, ymOf(e.date), () =>
        ensureSummary(e.date, this.vault, this.settings), "월간 종합 문서");
      if (summaryPath !== null) {
        try {
          await appendSummaryEvent(summaryPath, e.eventType, e.date, e.block, this.vault);
          return;
        } catch (err) {
          console.error(`[daily-note] 종합 ${e.eventType} 로그 실패 → 대기열 저장`, err);
        }
      }
      await this.enqueueEvent({
        eventType: e.eventType,
        eventDate: toIsoDate(e.date),
        target: "summary",
        targetSummaryPath: summaryPath ?? monthlySummaryPath(e.date, this.settings),
        block: e.block,
      });
    };

    const order: SummaryEventType[] = ["completed", "dropped", "archived"];
    const sorted = [...dated].sort(
      (a, b) => order.indexOf(a.eventType) - order.indexOf(b.eventType),
    );
    for (const e of sorted) {
      if (e.eventType === "dropped") {
        const dropPath = await prepare(dropPaths, ymOf(e.date), () =>
          ensureDrop(e.date, this.vault, this.settings), "월간 드롭 문서");
        await this.writeDocOrEnqueue(
          "drop",
          dropPath ?? monthlyDropPath(e.date, this.settings),
          dropPath !== null,
          toIsoDate(e.date),
          e.block,
          (p) => appendDropped(p, e.date, e.block, this.vault),
        );
      } else if (e.eventType === "archived") {
        if (arcPath === undefined) {
          try {
            arcPath = await ensureArchive(this.vault, this.settings);
          } catch (err) {
            console.error("[daily-note] 보관함 문서 준비 실패 → 대기열 저장", err);
            arcPath = null;
          }
        }
        await this.writeDocOrEnqueue(
          "archive",
          arcPath ?? archivePath(this.settings),
          arcPath !== null,
          toIsoDate(e.date),
          e.block,
          (p) => appendArchived(p, e.date, e.block, this.vault),
        );
      }
      await toSummary(e);
    }
    return dated.map((e) => e.date);
  }

  /** 드롭·보관 문서 쓰기. 문서 준비에 실패했거나 쓰기가 실패하면 원본 블록을 대기열에 보존한다. */
  private async writeDocOrEnqueue(
    target: "drop" | "archive",
    path: string,
    ready: boolean,
    isoDate: string,
    block: TaskBlock,
    write: (path: string) => Promise<void>,
  ): Promise<void> {
    if (ready) {
      try {
        await write(path);
        return;
      } catch (err) {
        console.error(`[daily-note] ${target} 문서 쓰기 실패 → 대기열 저장`, err);
      }
    }
    await this.enqueueEvent({
      eventType: target === "drop" ? "dropped" : "archived",
      eventDate: isoDate,
      target,
      targetSummaryPath: path,
      block,
    });
  }

  private async findPreviousNote(
    today: Date,
  ): Promise<{ prevDate: Date | null; prevPath: string | null }> {
    const first = previousBusinessDay(today);
    const firstPath = dailyNotePath(first, this.settings);
    if (this.vault.exists(firstPath)) return { prevDate: first, prevPath: firstPath };

    // 마지막 실행일까지 거슬러 올라가며 가장 최근 노트를 찾는다. 몇 달을 비웠어도 이어받아야
    // 그 노트의 미완료 항목과 완료 기록이 사라지지 않는다. 마지막 실행 기록이 없거나(첫 실행)
    // 그 노트가 지워졌다면 최근 FIRST_RUN_LOOKBACK_DAYS 일까지만 본다.
    const recentFloor = addDays(today, -FIRST_RUN_LOOKBACK_DAYS);
    const last = this.settings.lastRunDate ? fromIsoDate(this.settings.lastRunDate) : null;
    const floor = last !== null && last < recentFloor ? last : recentFloor;
    for (let candidate = addDays(today, -1); candidate >= floor; candidate = addDays(candidate, -1)) {
      if (this.settings.skipWeekend && isWeekend(candidate) && candidate.getTime() !== last?.getTime()) {
        continue;
      }
      const path = dailyNotePath(candidate, this.settings);
      if (this.vault.exists(path)) return { prevDate: candidate, prevPath: path };
    }
    return { prevDate: null, prevPath: null };
  }

  private result(
    status: RunStatus,
    today: Date,
    todayPath: string | null,
    prevDate: Date | null,
    prevPath: string | null,
    events: Events | null,
    detail?: string,
  ): RunResult {
    return { status, today, todayPath, prevDate, prevPath, events, detail };
  }

  private toCreateResult(result: RunResult): CreateResult {
    const path = result.todayPath ?? "";
    const e = result.events ?? emptyEvents();
    const counts = {
      carriedOver: e.carryingOver.length,
      completed: e.completed.length,
      dropped: e.dropped.length,
      archived: e.archived.length,
    };
    if (result.status === "skipped_weekend") {
      return {
        created: false,
        status: result.status,
        path,
        today: result.today,
        ...counts,
        message: `주말 스킵 (${toIsoDate(result.today)})`,
      };
    }
    if (result.status === "skipped_exists") {
      return {
        created: false,
        status: result.status,
        path,
        today: result.today,
        ...counts,
        message: `이미 존재 (${path})`,
      };
    }
    return {
      created: true,
      status: result.status,
      path,
      today: result.today,
      ...counts,
      message:
        `데일리 노트 생성: ${path}\n` +
        `  이월 ${counts.carriedOver} · 완료 ${counts.completed} · ` +
        `드롭 ${counts.dropped} · 보관 ${counts.archived}`,
    };
  }

  private toDryRunReport(result: RunResult): DryRunReport {
    const e = result.events ?? emptyEvents();
    const carriedOver = e.carryingOver.map((b) => `${b.topText} (${b.carryoverDays}일째)`);
    const toDrop = e.dropped.map((b) => b.topText);
    const toArchive = e.archived.map((b) => b.topText);
    const toComplete = e.completed.map((b) => b.topText);
    const summary =
      `[dry-run] ${toIsoDate(result.today)} — ` +
      `이월 ${carriedOver.length} · 완료 ${toComplete.length} · ` +
      `드롭 ${toDrop.length} · 보관 ${toArchive.length}`;
    return { targetDate: toIsoDate(result.today), carriedOver, toDrop, toArchive, toComplete, summary };
  }
}
