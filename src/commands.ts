import { App, Modal, Notice, Setting } from "obsidian";
import type DailyNoteManagerPlugin from "./main";
import { fromIsoDate, toIsoDate } from "./engine/dateutil";
import type { CreateResult, DryRunReport, DoctorReport } from "./engine";
import { resolveLocale, t, type Locale } from "./i18n";

export function registerCommands(plugin: DailyNoteManagerPlugin) {
  const locale = resolveLocale(plugin.settings.language);

  plugin.addCommand({
    id: "create-today",
    name: t("cmdCreateToday", locale),
    callback: async () => {
      const lc = resolveLocale(plugin.settings.language);
      try {
        const result = await plugin.engine.createForToday();
        new Notice(formatCreateNotice(result, lc));
      } catch (err) {
        console.error("[daily-note] create-today failed", err);
        new Notice(t("noticeCreateFailed", lc, { msg: (err as Error).message }));
      }
    },
  });

  plugin.addCommand({
    id: "dry-run",
    name: t("cmdDryRun", locale),
    callback: async () => {
      const lc = resolveLocale(plugin.settings.language);
      try {
        const report = await plugin.engine.dryRun();
        new Notice(formatDryRunNotice(report, lc));
        console.debug("[daily-note] dry-run", report);
      } catch (err) {
        console.error("[daily-note] dry-run failed", err);
        new Notice(t("noticeDryRunFailed", lc, { msg: (err as Error).message }));
      }
    },
  });

  plugin.addCommand({
    id: "recompute-current-month",
    name: t("cmdRecompute", locale),
    callback: async () => {
      const lc = resolveLocale(plugin.settings.language);
      const now = new Date();
      const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
      try {
        await plugin.engine.recomputeMonth(ym);
        new Notice(t("noticeRecomputed", lc, { ym }));
      } catch (err) {
        console.error("[daily-note] recompute failed", err);
        new Notice(t("noticeRecomputeFailed", lc, { msg: (err as Error).message }));
      }
    },
  });

  plugin.addCommand({
    id: "refresh-timeline",
    name: t("cmdRefreshTimeline", locale),
    callback: async () => {
      const lc = resolveLocale(plugin.settings.language);
      const now = new Date();
      const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
      try {
        await plugin.engine.refreshTimelineInSummary(ym);
        new Notice(t("noticeTimelineRefreshed", lc, { ym }));
      } catch (err) {
        console.error("[daily-note] timeline failed", err);
        new Notice(t("noticeTimelineFailed", lc, { msg: (err as Error).message }));
      }
    },
  });

  plugin.addCommand({
    id: "force-date",
    name: t("cmdForceDate", locale),
    callback: async () => {
      new DatePromptModal(plugin.app, plugin, async (iso) => {
        const lc = resolveLocale(plugin.settings.language);
        try {
          const result = await plugin.engine.forceDate(fromIsoDate(iso));
          new Notice(formatCreateNotice(result, lc));
        } catch (err) {
          console.error("[daily-note] force failed", err);
          new Notice(t("noticeForceFailed", lc, { msg: (err as Error).message }));
        }
      }).open();
    },
  });

  plugin.addCommand({
    id: "drain-pending-queue",
    name: t("cmdDrainPendingQueue", locale),
    callback: async () => {
      const lc = resolveLocale(plugin.settings.language);
      try {
        const res = await plugin.engine.drainPendingQueue();
        new Notice(
          t("noticeDrainResult", lc, { drained: res.drained, remaining: res.remaining }),
        );
      } catch (err) {
        console.error("[daily-note] drain-pending-queue failed", err);
        new Notice(t("noticeDrainFailed", lc, { msg: (err as Error).message }));
      }
    },
  });

  plugin.addCommand({
    id: "doctor",
    name: t("cmdDoctor", locale),
    callback: async () => {
      const lc = resolveLocale(plugin.settings.language);
      try {
        const diag = await plugin.engine.doctor();
        console.debug("[daily-note] doctor", diag);
        new Notice(formatDoctorNotice(diag, lc));
      } catch (err) {
        console.error("[daily-note] doctor failed", err);
        new Notice(t("noticeDoctorFailed", lc, { msg: (err as Error).message }));
      }
    },
  });
}

function formatCreateNotice(result: CreateResult, locale: Locale): string {
  if (result.status === "skipped_weekend") {
    return t("noticeSkippedWeekend", locale, { date: toIsoDate(result.today) });
  }
  if (result.status === "skipped_exists") {
    return t("noticeAlreadyExists", locale, { path: result.path });
  }
  const head = t("noticeCreatedHead", locale, { path: result.path });
  const counts = t("noticeCountsKo", locale, {
    c: result.carriedOver,
    d: result.completed,
    r: result.dropped,
    a: result.archived,
  });
  return `${head}\n  ${counts}`;
}

function formatDryRunNotice(report: DryRunReport, locale: Locale): string {
  return t("noticeDryRunSummary", locale, {
    date: report.targetDate,
    c: report.carriedOver.length,
    d: report.toComplete.length,
    r: report.toDrop.length,
    a: report.toArchive.length,
  });
}

function formatDoctorNotice(diag: DoctorReport, locale: Locale): string {
  if (diag.ok) return t("noticeDoctorOk", locale, { subdir: diag.notesSubdir });
  return t("noticeDoctorProblem", locale, { issues: diag.issues.join(", ") });
}

class DatePromptModal extends Modal {
  private value: string;
  private locale: Locale;

  constructor(
    app: App,
    plugin: DailyNoteManagerPlugin,
    private onSubmit: (iso: string) => void | Promise<void>,
  ) {
    super(app);
    this.locale = resolveLocale(plugin.settings.language);
    const now = new Date();
    this.value = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(
      now.getDate(),
    ).padStart(2, "0")}`;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.createEl("h3", { text: t("datePromptTitle", this.locale) });
    new Setting(contentEl)
      .setName("YYYY-MM-DD")
      .addText((tf) =>
        tf.setValue(this.value).onChange((v) => {
          this.value = v.trim();
        }),
      );
    new Setting(contentEl).addButton((b) =>
      b
        .setButtonText(t("datePromptSubmit", this.locale))
        .setCta()
        .onClick(() => {
          if (!/^\d{4}-\d{2}-\d{2}$/.test(this.value)) {
            new Notice(t("noticeDateFormat", this.locale));
            return;
          }
          this.close();
          void this.onSubmit(this.value);
        }),
    );
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
