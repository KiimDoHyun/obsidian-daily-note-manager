import { App, Notice, PluginSettingTab, Setting } from "obsidian";
import type DailyNoteManagerPlugin from "./main";
import { resolveLocale, t, type LocaleSetting } from "./i18n";

export interface DailyNoteSettings {
  notesSubdir: string;
  dropThresholdDays: number;
  warnThresholdDays: number;
  archiveFileName: string;
  monthlySummarySuffix: string;
  monthlyDropSuffix: string;
  lastRunDate: string | null;
  autoRunOnLoad: boolean;
  skipWeekend: boolean;
  maxCatchUpDays: number;
  /** UI 언어. auto 는 navigator.language 로 감지. */
  language: LocaleSetting;
  /** 타임라인 뷰 좌측 라벨 컬럼 폭 (px). 사용자가 드래그로 변경 가능. */
  timelineLabelWidth: number;
}

export const DEFAULT_SETTINGS: DailyNoteSettings = {
  notesSubdir: "Notes",
  dropThresholdDays: 5,
  warnThresholdDays: 3,
  archiveFileName: "보관함.md",
  monthlySummarySuffix: "종합",
  monthlyDropSuffix: "드롭",
  lastRunDate: null,
  autoRunOnLoad: true,
  skipWeekend: true,
  maxCatchUpDays: 14,
  language: "auto",
  timelineLabelWidth: 220,
};

export class DailyNoteSettingTab extends PluginSettingTab {
  plugin: DailyNoteManagerPlugin;

  constructor(app: App, plugin: DailyNoteManagerPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    const lc = resolveLocale(this.plugin.settings.language);

    new Setting(containerEl)
      .setName(t("setSubdirName", lc))
      .setDesc(t("setSubdirDesc", lc))
      .addText((text) =>
        text
          .setValue(this.plugin.settings.notesSubdir)
          .onChange(async (value) => {
            this.plugin.settings.notesSubdir = value || "Notes";
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName(t("setDropThresholdName", lc))
      .setDesc(t("setDropThresholdDesc", lc))
      .addText((text) =>
        text
          .setValue(String(this.plugin.settings.dropThresholdDays))
          .onChange(async (value) => {
            const n = parseInt(value, 10);
            if (Number.isFinite(n) && n > 0) {
              this.plugin.settings.dropThresholdDays = n;
              await this.plugin.saveSettings();
            }
          }),
      );

    new Setting(containerEl)
      .setName(t("setWarnThresholdName", lc))
      .setDesc(t("setWarnThresholdDesc", lc))
      .addText((text) =>
        text
          .setValue(String(this.plugin.settings.warnThresholdDays))
          .onChange(async (value) => {
            const n = parseInt(value, 10);
            if (Number.isFinite(n) && n > 0) {
              this.plugin.settings.warnThresholdDays = n;
              await this.plugin.saveSettings();
            }
          }),
      );

    new Setting(containerEl)
      .setName(t("setArchiveFilenameName", lc))
      .setDesc(t("setArchiveFilenameDesc", lc))
      .addText((text) =>
        text
          .setValue(this.plugin.settings.archiveFileName)
          .onChange(async (value) => {
            this.plugin.settings.archiveFileName = value || "보관함.md";
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName(t("setSummarySuffixName", lc))
      .setDesc(t("setSummarySuffixDesc", lc))
      .addText((text) =>
        text
          .setValue(this.plugin.settings.monthlySummarySuffix)
          .onChange(async (value) => {
            this.plugin.settings.monthlySummarySuffix = value || "종합";
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName(t("setDropSuffixName", lc))
      .setDesc(t("setDropSuffixDesc", lc))
      .addText((text) =>
        text
          .setValue(this.plugin.settings.monthlyDropSuffix)
          .onChange(async (value) => {
            this.plugin.settings.monthlyDropSuffix = value || "드롭";
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName(t("setSkipWeekendName", lc))
      .setDesc(t("setSkipWeekendDesc", lc))
      .addToggle((tg) =>
        tg.setValue(this.plugin.settings.skipWeekend).onChange(async (v) => {
          this.plugin.settings.skipWeekend = v;
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName(t("setAutoLoadName", lc))
      .setDesc(t("setAutoLoadDesc", lc))
      .addToggle((tg) =>
        tg.setValue(this.plugin.settings.autoRunOnLoad).onChange(async (v) => {
          this.plugin.settings.autoRunOnLoad = v;
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName(t("setMaxCatchupName", lc))
      .setDesc(t("setMaxCatchupDesc", lc))
      .addText((text) =>
        text
          .setValue(String(this.plugin.settings.maxCatchUpDays))
          .onChange(async (value) => {
            const n = parseInt(value, 10);
            if (Number.isFinite(n) && n > 0) {
              this.plugin.settings.maxCatchUpDays = n;
              await this.plugin.saveSettings();
            }
          }),
      );

    new Setting(containerEl)
      .setName(t("setLangName", lc))
      .setDesc(t("setLangDesc", lc))
      .addDropdown((drop) =>
        drop
          .addOption("auto", t("setLangAuto", lc))
          .addOption("en", "English")
          .addOption("ko", "한국어")
          .setValue(this.plugin.settings.language)
          .onChange(async (value) => {
            const previous = this.plugin.settings.language;
            this.plugin.settings.language = value as DailyNoteSettings["language"];
            await this.plugin.saveSettings();
            // 설정 탭 자체를 다시 그려서 라벨 언어 갱신
            this.display();
            if (previous !== value) {
              new Notice(t("noticeLanguageChanged", resolveLocale(this.plugin.settings.language)));
            }
          }),
      );
  }
}
