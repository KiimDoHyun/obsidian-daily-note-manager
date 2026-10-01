import type { DailyNoteSettings } from "../settings";
import {
  addDays,
  fromIsoDate,
  isWeekend,
  nextBusinessDay,
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
  type DatedEvent,
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
} from "./writers/monthlySummary";
import { drainQueue, enqueue, type PendingEntry } from "./writers/pendingQueue";
import { stripTimelineSection } from "./writers/timeline";

export type RunStatus =
  | "created"
  | "skipped_weekend"
  | "skipped_exists"
  | "dry_run";

/** 마지막 실행 기록이 없을 때(첫 실행) 이전 노트를 찾아볼 일수. 오래된 노트를 끌어와 한꺼번에 드롭하지 않게. */
const FIRST_RUN_LOOKBACK_DAYS = 14;
/** 마지막 실행 기록이 있을 때 이전 노트를 찾아볼 최대 일수(약 5년). 몇 달을 비워도 이어받기 위함. */
const MAX_LOOKBACK_DAYS = 366 * 5;

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

const TARGET_LABEL: Record<PendingEntry["target"], string> = {
  summary: "월간 종합 문서",
  drop: "월간 드롭 문서",
  archive: "보관함 문서",
};

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
   * 사슬 자체는 실패를 삼켜 늘 성공으로 끝나므로, 한 번 실패해도 다음 작업이 막히지 않는다.
   * 실패는 각 호출자에게 그대로 전달된다.
   */
  private lock: Promise<unknown> = Promise.resolve();

  private serialize<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.lock.then(fn);
    this.lock = run.catch(() => undefined);
    return run;
  }

  /**
   * 오늘 노트 생성. 스케줄러와 "오늘 노트 생성" 명령이 모두 이것을 부른다.
   * 며칠을 비웠든 오늘 노트 하나만 만든다. 그 사이 날짜의 노트는 만들지 않지만,
   * 이월 일수·드롭은 그 사이 날마다 노트가 있었던 것처럼 계산한다(simulate).
   */
  async createForToday(): Promise<CreateResult> {
    return this.serialize(async () => this.toCreateResult(await this.runCreate(todayDate(), false)));
  }

  /** 미리보기. 볼트를 바꾸지 않지만, 쓰는 작업 도중의 어중간한 상태를 읽지 않게 같은 줄에 선다. */
  async dryRun(): Promise<DryRunReport> {
    return this.serialize(async () => this.toDryRunReport(await this.runCreate(todayDate(), true)));
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

  /** 대기 큐를 명시적으로 재시도. 명령어에서 직접 호출. 기록이 들어간 달의 요약 숫자도 다시 센다. */
  async drainPendingQueue(): Promise<{ drained: number; remaining: number }> {
    return this.serialize(async () => {
      const res = await drainQueue(this.vault, this.settings);
      await this.recomputeHeaders(res.writtenSummaryPaths);
      return { drained: res.drained, remaining: res.remaining };
    });
  }

  private async runCreate(today: Date, dryRun: boolean): Promise<RunResult> {
    if (this.settings.skipWeekend && isWeekend(today)) {
      return this.result("skipped_weekend", today, null, null, null, null, `${toIsoDate(today)} 주말`);
    }

    const todayPath = dailyNotePath(today, this.settings);

    // 이미 존재하는 경우에도 대기열은 재시도한다. dry-run 은 순수 조회이므로 큐를 건드리지 않는다.
    if (this.vault.exists(todayPath)) {
      if (!dryRun) await this.recomputeHeaders(await this.tryDrainQueue());
      return this.result("skipped_exists", today, todayPath, null, null, null, "이미 존재");
    }

    const { prevDate, prevPath } = await this.findPreviousNote(today);
    // 이전 노트가 없으면(첫 실행) 어제 날짜의 빈 노트에서 시작한 것으로 본다.
    const sourceDate: Date = prevDate ?? addDays(today, -1);
    const parsed: DailyNoteParsed =
      prevPath !== null
        ? parseDailyNoteText(await this.vault.read(prevPath), sourceDate)
        : emptyParsed(sourceDate);

    const { events, dated } = this.simulate(parsed, sourceDate, today);

    if (dryRun) {
      return this.result("dry_run", today, todayPath, sourceDate, prevPath, events, "dry-run");
    }

    // 실제 실행. 순서 규칙:
    // 1) 대기 큐부터 재시도 (이전 실행 실패분 복구 시도).
    // 2) 오늘 데일리 노트를 먼저 쓴다. 이후 어떤 실패가 나도 오늘 노트는 반드시 남는다.
    // 3) 종합/드롭/보관 쓰기는 실패 시 대기 큐로 밀어 넣는다. 이벤트는 발생한 날짜의 달 문서로 간다.
    // 4) 헤더 재계산·타임라인 후처리는 관련된 달마다 개별 try/catch 로 격리한다.
    const drainedSummaries = await this.tryDrainQueue();

    // 직접 [-] 로 지운 항목은 사용자가 이미 알고 있으므로, 기준일 도달로 자동 드롭된 것만 알린다.
    const autoDropped = dated.filter((e) => e.eventType === "dropped" && !e.block.isDroppedImmediate);
    await this.vault.write(
      todayPath,
      renderDailyNote(today, events.carryingOver, this.settings, autoDropped),
    );

    await this.appendEventsInOrder(dated);

    // 이번 달 + 이전 노트의 달 + 이벤트가 기록된 달 모두 종합 문서를 갖추고 요약 숫자를 다시 센다.
    const months = new Map<string, Date>();
    for (const d of [today, sourceDate, ...dated.map((e) => e.date)]) months.set(ymOf(d), d);
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
    // 대기열이 다른 달(예: 몇 달 전) 문서에 기록했다면 그 달도 요약 숫자를 다시 센다.
    const monthPaths = new Set(
      [...months.values()].map((d) => monthlySummaryPath(d, this.settings)),
    );
    await this.recomputeHeaders(drainedSummaries.filter((p) => !monthPaths.has(p)));

    this.advanceLastRunDate(today);
    try {
      await this.saveSettings();
    } catch (err) {
      console.error("[daily-note] 설정 저장 실패", err);
    }

    return this.result("created", today, todayPath, sourceDate, prevPath, events);
  }

  /**
   * 마지막 실행일은 앞으로만 간다. 단, 실제 오늘을 넘지 않는다.
   * - 과거 날짜를 강제 생성해도 뒤로 가지 않는다.
   * - 미래 날짜를 강제 생성해도(또는 다른 기기에서 미래 값이 동기화돼 와도) 실제 오늘로 묶인다.
   */
  private advanceLastRunDate(target: Date): void {
    const realToday = todayDate();
    const prev = this.settings.lastRunDate ? fromIsoDate(this.settings.lastRunDate) : null;
    let next = prev !== null && prev > target ? prev : target;
    if (next > realToday) next = realToday;
    this.settings.lastRunDate = toIsoDate(next);
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
    const dated: DatedEvent[] = [];
    let state = parsed;
    let cur = prevDate;
    let carrying: TaskBlock[];
    // 노트 하루 분량씩 분류한다. 다음 노트 날이 오늘에 닿거나 넘길 항목이 없으면 멈춘다.
    for (;;) {
      const step = classifyEvents(state, this.settings.dropThresholdDays);
      for (const block of step.completed) dated.push({ eventType: "completed", date: cur, block });
      for (const block of step.dropped) dated.push({ eventType: "dropped", date: cur, block });
      for (const block of step.archived) dated.push({ eventType: "archived", date: cur, block });
      carrying = step.carryingOver;
      const next = nextNoteDay(cur);
      if (next >= today || carrying.length === 0) break;
      state = { ...emptyParsed(next), carryoverBlocks: carrying };
      cur = next;
    }
    const pick = (t: DatedEvent["eventType"]) =>
      dated.filter((e) => e.eventType === t).map((e) => e.block);
    return {
      events: {
        completed: pick("completed"),
        dropped: pick("dropped"),
        archived: pick("archived"),
        carryingOver: carrying,
      },
      dated,
    };
  }

  /** 대기열을 재시도하고, 기록이 들어간 종합 문서 경로들을 돌려준다. 실패해도 노트 생성은 계속한다. */
  private async tryDrainQueue(): Promise<string[]> {
    try {
      return (await drainQueue(this.vault, this.settings)).writtenSummaryPaths;
    } catch (err) {
      console.error("[daily-note] 대기열 처리 중 오류", err);
      return [];
    }
  }

  private async recomputeHeaders(summaryPaths: string[]): Promise<void> {
    for (const path of summaryPaths) {
      try {
        await recomputeHeader(path, this.vault);
      } catch (err) {
        console.error(`[daily-note] 종합 헤더 재계산 실패: ${path}`, err);
      }
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
   */
  private async appendEventsInOrder(dated: DatedEvent[]): Promise<void> {
    // 문서 경로는 문서 종류·달마다 한 번만 준비한다. 준비에 실패하면 null 로 기억해 그 문서의
    // 이벤트를 모두 대기열로 보낸다.
    const prepared = new Map<string, string | null>();
    const prepare = async (key: string, label: string, make: () => Promise<string>) => {
      if (!prepared.has(key)) {
        try {
          prepared.set(key, await make());
        } catch (err) {
          console.error(`[daily-note] ${label} 준비 실패 → 대기열 저장`, err);
          prepared.set(key, null);
        }
      }
      return prepared.get(key) ?? null;
    };

    // 같은 날짜·같은 내용의 이벤트가 몇 번째인지 센다. writer 는 이 수만큼만 같은 줄을 허용하므로
    // 재실행해도 늘지 않고, 이름이 같은 서로 다른 항목은 각각 남는다.
    const seen = new Map<string, number>();
    const occurrenceOf = (e: DatedEvent) => {
      const b = e.block;
      const key = [e.eventType, toIsoDate(e.date), b.topText, b.carryoverDays,
        b.originDate ? toIsoDate(b.originDate) : "", b.isDroppedImmediate].join("|");
      const n = (seen.get(key) ?? 0) + 1;
      seen.set(key, n);
      return n;
    };

    const order: DatedEvent["eventType"][] = ["completed", "dropped", "archived"];
    const sorted = [...dated].sort(
      (a, b) => order.indexOf(a.eventType) - order.indexOf(b.eventType),
    );
    for (const e of sorted) {
      const occurrence = occurrenceOf(e);
      const isoDate = toIsoDate(e.date);
      if (e.eventType === "dropped") {
        const path = await prepare(`drop:${ymOf(e.date)}`, "월간 드롭 문서", () =>
          ensureDrop(e.date, this.vault, this.settings));
        await this.writeOrEnqueue(
          { target: "drop", eventType: "dropped", eventDate: isoDate, block: e.block, occurrence,
            targetPath: path ?? monthlyDropPath(e.date, this.settings) },
          path,
          (p) => appendDropped(p, e.date, e.block, this.vault, occurrence),
        );
      } else if (e.eventType === "archived") {
        const path = await prepare("archive", "보관함 문서", () =>
          ensureArchive(this.vault, this.settings));
        await this.writeOrEnqueue(
          { target: "archive", eventType: "archived", eventDate: isoDate, block: e.block, occurrence,
            targetPath: path ?? archivePath(this.settings) },
          path,
          (p) => appendArchived(p, e.date, e.block, this.vault, occurrence),
        );
      }
      const summary = await prepare(`summary:${ymOf(e.date)}`, "월간 종합 문서", () =>
        ensureSummary(e.date, this.vault, this.settings));
      await this.writeOrEnqueue(
        { target: "summary", eventType: e.eventType, eventDate: isoDate, block: e.block, occurrence,
          targetPath: summary ?? monthlySummaryPath(e.date, this.settings) },
        summary,
        (p) => appendSummaryEvent(p, e.eventType, e.date, e.block, this.vault, occurrence),
      );
    }
  }

  /**
   * 문서 하나에 쓴다. 문서 준비에 실패했거나(path 가 null) 쓰기가 실패하면 원본 블록을
   * 대기열에 보존해 다음 실행에서 다시 시도한다.
   */
  private async writeOrEnqueue(
    entry: PendingEntry,
    path: string | null,
    write: (path: string) => Promise<void>,
  ): Promise<void> {
    if (path !== null) {
      try {
        await write(path);
        return;
      } catch (err) {
        console.error(`[daily-note] ${TARGET_LABEL[entry.target]} 쓰기 실패 → 대기열 저장`, err);
      }
    }
    await this.enqueueEvent(entry);
  }

  /**
   * 오늘 직전부터 거슬러 올라가며 가장 최근 노트를 찾는다.
   * - 마지막 실행 기록이 있으면 최대 MAX_LOOKBACK_DAYS 까지 본다. 몇 달을 비웠어도, 그리고 그날
   *   오늘 노트를 강제로 다시 만들어도(마지막 실행일이 이미 오늘이어도) 이전 노트를 이어받는다.
   * - 첫 실행이면 FIRST_RUN_LOOKBACK_DAYS 까지만 본다.
   * - 주말 제외 설정이면 주말은 건너뛰되, 마지막 실행일 노트는 주말이어도 본다(설정을 바꾸기 전에
   *   주말 노트를 만들었을 수 있다). 주말 제외를 끄면 어제(일요일 포함)부터 본다.
   */
  private async findPreviousNote(
    today: Date,
  ): Promise<{ prevDate: Date | null; prevPath: string | null }> {
    const last = this.settings.lastRunDate ? fromIsoDate(this.settings.lastRunDate) : null;
    const floor = addDays(today, -(last === null ? FIRST_RUN_LOOKBACK_DAYS : MAX_LOOKBACK_DAYS));
    for (let candidate = addDays(today, -1); candidate >= floor; candidate = addDays(candidate, -1)) {
      const isLastRunDay = last !== null && candidate.getTime() === last.getTime();
      if (this.settings.skipWeekend && isWeekend(candidate) && !isLastRunDay) continue;
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
