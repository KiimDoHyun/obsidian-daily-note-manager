import type { DailyNoteSettings } from "../settings";
import {
  addDays,
  fromIsoDate,
  isWeekend,
  previousBusinessDay,
  sameYearMonth,
  today as todayDate,
  toIsoDate,
} from "./dateutil";
import { classifyEvents } from "./events";
import { parseDailyNoteText } from "./parser";
import { dailyNotePath, monthlySummaryPath } from "./paths";
import { emptyEvents, emptyParsed, type DailyNoteParsed, type Events } from "./types";
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
import { upsertTimelineSection } from "./writers/timeline";

export type RunStatus =
  | "created"
  | "skipped_weekend"
  | "skipped_exists"
  | "dry_run";

/**
 * catchUp 도중 특정 날짜의 runCreate 가 실패했음을 알리는 에러.
 * 실패 순간 즉시 throw 되어 뒤이은 날짜 처리는 중단된다. lastRunDate 는
 * 마지막으로 성공한 날짜에서 멈추므로 다음 재실행이 실패 날짜부터 자연스레 재시도한다.
 */
export class CatchUpError extends Error {
  constructor(public readonly failedDate: string, public readonly cause: unknown) {
    super(`catchUp failed at ${failedDate}: ${(cause as Error)?.message ?? String(cause)}`);
    this.name = "CatchUpError";
  }
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

  updateSettings(settings: DailyNoteSettings): void {
    this.settings = settings;
  }

  async createForToday(): Promise<CreateResult> {
    const result = await this.runCreate(todayDate(), false);
    return this.toCreateResult(result);
  }

  async dryRun(): Promise<DryRunReport> {
    const result = await this.runCreate(todayDate(), true);
    return this.toDryRunReport(result);
  }

  async forceDate(target: Date): Promise<CreateResult> {
    const path = dailyNotePath(target, this.settings);
    if (this.vault.exists(path)) await this.vault.remove(path);
    const result = await this.runCreate(target, false);
    return this.toCreateResult(result);
  }

  async recomputeMonth(yearMonth: string): Promise<void> {
    const [y, m] = yearMonth.split("-").map((n) => parseInt(n, 10));
    const monthDate = new Date(y, m - 1, 1);
    const path = await ensureSummary(monthDate, this.vault, this.settings);
    await recomputeHeader(path, this.vault);
  }

  async refreshTimelineInSummary(yearMonth: string): Promise<void> {
    const [y, m] = yearMonth.split("-").map((n) => parseInt(n, 10));
    await upsertTimelineSection(new Date(y, m - 1, 1), this.vault, this.settings);
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

  /**
   * 옵시디언 로드 시 호출.
   * lastRunDate 다음 영업일부터 오늘까지 순차 처리. 없으면 오늘만.
   * maxCatchUpDays 를 넘는 부재는 오늘만 처리(원본 Python 의 "긴 부재 후 복귀" 정책).
   */
  async catchUp(): Promise<void> {
    if (!this.settings.autoRunOnLoad) return;

    const today = todayDate();
    const last = this.settings.lastRunDate ? fromIsoDate(this.settings.lastRunDate) : null;

    const targets: Date[] = [];
    if (last === null) {
      targets.push(today);
    } else {
      const gap = Math.floor((today.getTime() - last.getTime()) / (1000 * 60 * 60 * 24));
      if (gap <= 0) return;
      if (gap > this.settings.maxCatchUpDays) {
        targets.push(today);
      } else {
        let cur = addDays(last, 1);
        while (cur <= today) {
          if (!(this.settings.skipWeekend && isWeekend(cur))) targets.push(cur);
          cur = addDays(cur, 1);
        }
      }
    }

    // 한 날짜라도 실패하면 즉시 중단하고 CatchUpError 를 던진다.
    // 계속 진행하면 뒤이은 날짜가 실패한 날의 노트를 읽지 못해 이월 카운터 체인이 끊긴다.
    // lastRunDate 는 runCreate 성공 시에만 갱신되므로, 다음 실행이 실패 날짜부터 재시도한다.
    for (const t of targets) {
      try {
        await this.runCreate(t, false);
      } catch (err) {
        throw new CatchUpError(toIsoDate(t), err);
      }
    }
  }

  // ---------- internal ----------

  /** 대기 큐를 명시적으로 재시도. 명령어에서 직접 호출. */
  async drainPendingQueue(): Promise<{ drained: number; remaining: number }> {
    return drainQueue(this.vault, this.settings);
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

    const events = classifyEvents(parsed, this.settings.dropThresholdDays);

    if (dryRun) {
      return this.result("dry_run", today, todayPath, effectivePrevDate, prevPath, events, "dry-run");
    }

    // 실제 실행. 순서 규칙:
    // 1) 대기 큐부터 재시도 (이전 실행 실패분 복구 시도).
    // 2) 오늘 데일리 노트를 먼저 쓴다. 이후 어떤 실패가 나도 오늘 노트는 반드시 남는다.
    // 3) 종합/드롭/보관 쓰기는 실패 시 대기 큐로 밀어 넣는다.
    // 4) 헤더 재계산·타임라인·크로스먼스 후처리는 각각 개별 try/catch 로 격리한다.
    await this.tryDrainQueue();

    await this.vault.write(todayPath, renderDailyNote(today, events.carryingOver, this.settings));

    let prevSummaryPath: string | null = null;
    try {
      prevSummaryPath = await ensureSummary(effectivePrevDate!, this.vault, this.settings);
    } catch (err) {
      console.error("[daily-note] 이전 달 종합 문서 준비 실패", err);
    }
    if (prevSummaryPath !== null) {
      await this.appendEventsInOrder(events, effectivePrevDate!, prevSummaryPath);
    } else {
      // 종합 문서 경로조차 확보 못한 경우: 모든 이벤트를 큐로 밀어 넣는다.
      await this.enqueueAllEvents(events, effectivePrevDate!);
    }

    if (!sameYearMonth(today, effectivePrevDate!)) {
      try {
        await ensureSummary(today, this.vault, this.settings);
      } catch (err) {
        console.error("[daily-note] 이번 달 종합 문서 생성 실패", err);
      }
    }

    try {
      const thisMonthSummary = await ensureSummary(today, this.vault, this.settings);
      await recomputeHeader(thisMonthSummary, this.vault);
    } catch (err) {
      console.error("[daily-note] 이번 달 종합 헤더 재계산 실패", err);
    }
    try {
      await upsertTimelineSection(today, this.vault, this.settings);
    } catch (err) {
      console.error("[daily-note] 이번 달 타임라인 갱신 실패", err);
    }
    if (!sameYearMonth(today, effectivePrevDate!) && prevSummaryPath !== null) {
      try {
        await recomputeHeader(prevSummaryPath, this.vault);
      } catch (err) {
        console.error("[daily-note] 이전 달 종합 헤더 재계산 실패", err);
      }
      try {
        await upsertTimelineSection(effectivePrevDate!, this.vault, this.settings);
      } catch (err) {
        console.error("[daily-note] 이전 달 타임라인 갱신 실패", err);
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

  private async tryDrainQueue(): Promise<void> {
    try {
      const res = await drainQueue(this.vault, this.settings);
      if (res.drained > 0 || res.remaining > 0) {
        console.log(
          `[daily-note] 대기열 처리: ${res.drained}건 완료, ${res.remaining}건 남음`,
        );
      }
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

  private async enqueueAllEvents(events: Events, prevDate: Date): Promise<void> {
    const isoDate = toIsoDate(prevDate);
    const targetPath = monthlySummaryPath(prevDate, this.settings);
    for (const block of events.completed) {
      await this.enqueueEvent({ eventType: "completed", eventDate: isoDate, targetSummaryPath: targetPath, block });
    }
    for (const block of events.dropped) {
      await this.enqueueEvent({ eventType: "dropped", eventDate: isoDate, targetSummaryPath: targetPath, block });
    }
    for (const block of events.archived) {
      await this.enqueueEvent({ eventType: "archived", eventDate: isoDate, targetSummaryPath: targetPath, block });
    }
  }

  private async appendEventsInOrder(
    events: Events,
    prevDate: Date,
    summaryPath: string,
  ): Promise<void> {
    const isoDate = toIsoDate(prevDate);

    for (const block of events.completed) {
      try {
        await appendSummaryEvent(summaryPath, "completed", prevDate, block, this.vault);
      } catch (err) {
        console.error("[daily-note] 완료 로그 실패 → 대기열 저장", err);
        await this.enqueueEvent({
          eventType: "completed",
          eventDate: isoDate,
          targetSummaryPath: summaryPath,
          block,
        });
      }
    }

    if (events.dropped.length > 0) {
      let dropPath: string | null = null;
      try {
        dropPath = await ensureDrop(prevDate, this.vault, this.settings);
      } catch (err) {
        console.error("[daily-note] 월간 드롭 문서 준비 실패", err);
      }
      for (const block of events.dropped) {
        if (dropPath !== null) {
          try {
            await appendDropped(dropPath, prevDate, block, this.vault);
          } catch (err) {
            console.error("[daily-note] 월간 드롭 문서 쓰기 실패", err);
          }
        }
        try {
          await appendSummaryEvent(summaryPath, "dropped", prevDate, block, this.vault);
        } catch (err) {
          console.error("[daily-note] 드롭 로그 실패 → 대기열 저장", err);
          await this.enqueueEvent({
            eventType: "dropped",
            eventDate: isoDate,
            targetSummaryPath: summaryPath,
            block,
          });
        }
      }
    }

    if (events.archived.length > 0) {
      let arcPath: string | null = null;
      try {
        arcPath = await ensureArchive(this.vault, this.settings);
      } catch (err) {
        console.error("[daily-note] 보관함 문서 준비 실패", err);
      }
      for (const block of events.archived) {
        if (arcPath !== null) {
          try {
            await appendArchived(arcPath, prevDate, block, this.vault);
          } catch (err) {
            console.error("[daily-note] 보관함 쓰기 실패", err);
          }
        }
        try {
          await appendSummaryEvent(summaryPath, "archived", prevDate, block, this.vault);
        } catch (err) {
          console.error("[daily-note] 보관 로그 실패 → 대기열 저장", err);
          await this.enqueueEvent({
            eventType: "archived",
            eventDate: isoDate,
            targetSummaryPath: summaryPath,
            block,
          });
        }
      }
    }
  }

  private async findPreviousNote(
    today: Date,
  ): Promise<{ prevDate: Date | null; prevPath: string | null }> {
    const first = previousBusinessDay(today);
    const firstPath = dailyNotePath(first, this.settings);
    if (this.vault.exists(firstPath)) return { prevDate: first, prevPath: firstPath };

    for (let i = 1; i <= this.settings.maxCatchUpDays; i++) {
      const candidate = addDays(today, -i);
      if (this.settings.skipWeekend && isWeekend(candidate)) continue;
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
