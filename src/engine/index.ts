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
import { dailyNotePath } from "./paths";
import { emptyEvents, emptyParsed, type DailyNoteParsed, type Events } from "./types";
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
import { upsertTimelineSection } from "./writers/timeline";

export type RunStatus =
  | "created"
  | "skipped_weekend"
  | "skipped_exists"
  | "dry_run";

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

    for (const t of targets) {
      try {
        await this.runCreate(t, false);
      } catch (err) {
        console.error("[daily-note] catchUp failed for", toIsoDate(t), err);
      }
    }
  }

  // ---------- internal ----------

  private async runCreate(today: Date, dryRun: boolean): Promise<RunResult> {
    if (this.settings.skipWeekend && isWeekend(today)) {
      return this.result("skipped_weekend", today, null, null, null, null, `${toIsoDate(today)} 주말`);
    }

    const todayPath = dailyNotePath(today, this.settings);
    if (this.vault.exists(todayPath)) {
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

    const prevSummaryPath = await ensureSummary(effectivePrevDate!, this.vault, this.settings);
    await this.appendEventsInOrder(events, effectivePrevDate!, prevSummaryPath);

    await this.vault.write(todayPath, renderDailyNote(today, events.carryingOver, this.settings));

    if (!sameYearMonth(today, effectivePrevDate!)) {
      await ensureSummary(today, this.vault, this.settings);
    }

    const thisMonthSummary = await ensureSummary(today, this.vault, this.settings);
    await recomputeHeader(thisMonthSummary, this.vault);
    await upsertTimelineSection(today, this.vault, this.settings);
    if (!sameYearMonth(today, effectivePrevDate!)) {
      await recomputeHeader(prevSummaryPath, this.vault);
      await upsertTimelineSection(effectivePrevDate!, this.vault, this.settings);
    }

    this.settings.lastRunDate = toIsoDate(today);
    await this.saveSettings();

    return this.result("created", today, todayPath, effectivePrevDate, prevPath, events);
  }

  private async appendEventsInOrder(
    events: Events,
    prevDate: Date,
    summaryPath: string,
  ): Promise<void> {
    for (const block of events.completed) {
      await appendSummaryEvent(summaryPath, "completed", prevDate, block, this.vault);
    }
    if (events.dropped.length > 0) {
      const dropPath = await ensureDrop(prevDate, this.vault, this.settings);
      for (const block of events.dropped) {
        await appendDropped(dropPath, prevDate, block, this.vault);
        await appendSummaryEvent(summaryPath, "dropped" as SummaryEventType, prevDate, block, this.vault);
      }
    }
    if (events.archived.length > 0) {
      const arcPath = await ensureArchive(this.vault, this.settings);
      for (const block of events.archived) {
        await appendArchived(arcPath, prevDate, block, this.vault);
        await appendSummaryEvent(summaryPath, "archived" as SummaryEventType, prevDate, block, this.vault);
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
