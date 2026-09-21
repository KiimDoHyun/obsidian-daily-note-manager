import { App, Notice, PluginSettingTab, Setting } from "obsidian";
import type DailyNoteManagerPlugin from "./main";
import { resolveLocale, t, type LocaleSetting } from "./i18n";

export interface DailyNoteSettings {
  notesSubdir: string;
  dropThresholdDays: number;
  /** 빨강 경고 시작: 드롭 N일 전. 기본 1 (드롭 하루 전부터 🔴). */
  warnRedDaysBeforeDrop: number;
  /** 주황 경고 시작: 드롭 N일 전. 기본 2 (드롭 이틀 전부터 🟠). red 보다 더 커야 함 (더 이르게 시작). */
  warnOrangeDaysBeforeDrop: number;
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
  warnRedDaysBeforeDrop: 1,
  warnOrangeDaysBeforeDrop: 2,
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

  /**
   * Obsidian 1.13+ 선언형 설정 API.
   * - 값 저장은 Obsidian 이 자동 처리(this.plugin.settings[key] 를 직접 수정 + saveData 호출).
   * - Plugin.saveData 를 override 해서 열린 타임라인 뷰 갱신 side effect 를 태움.
   * - 언어 라벨은 현재 locale 로 렌더. 언어 변경 시 라벨은 설정 탭을 다시 열면 갱신됨.
   * 이 메서드가 비어있지 않은 배열을 반환하면 1.13+ 에서는 display() 가 무시되고 이 정의가 UI 와
   * 설정 검색에 함께 쓰인다. 이전 버전(1.7.2~1.12) 사용자용으로 display() 도 함께 유지.
   */
  getSettingDefinitions() {
    const lc = resolveLocale(this.plugin.settings.language);
    return [
      { name: t("setSubdirName", lc), desc: t("setSubdirDesc", lc),
        control: { type: "text" as const, key: "notesSubdir", placeholder: "Notes" } },
      { name: t("setDropThresholdName", lc), desc: t("setDropThresholdDesc", lc),
        control: { type: "number" as const, key: "dropThresholdDays", min: 1 } },
      { name: t("setWarnRedName", lc), desc: t("setWarnRedDesc", lc),
        control: { type: "number" as const, key: "warnRedDaysBeforeDrop", min: 0 } },
      { name: t("setWarnOrangeName", lc), desc: t("setWarnOrangeDesc", lc),
        control: { type: "number" as const, key: "warnOrangeDaysBeforeDrop", min: 0 } },
      { name: t("setArchiveFilenameName", lc), desc: t("setArchiveFilenameDesc", lc),
        control: { type: "text" as const, key: "archiveFileName", placeholder: "보관함.md" } },
      { name: t("setSummarySuffixName", lc), desc: t("setSummarySuffixDesc", lc),
        control: { type: "text" as const, key: "monthlySummarySuffix", placeholder: "종합" } },
      { name: t("setDropSuffixName", lc), desc: t("setDropSuffixDesc", lc),
        control: { type: "text" as const, key: "monthlyDropSuffix", placeholder: "드롭" } },
      { name: t("setSkipWeekendName", lc), desc: t("setSkipWeekendDesc", lc),
        control: { type: "toggle" as const, key: "skipWeekend" } },
      { name: t("setAutoLoadName", lc), desc: t("setAutoLoadDesc", lc),
        control: { type: "toggle" as const, key: "autoRunOnLoad" } },
      { name: t("setMaxCatchupName", lc), desc: t("setMaxCatchupDesc", lc),
        control: { type: "number" as const, key: "maxCatchUpDays", min: 1 } },
      { name: t("setLangName", lc), desc: t("setLangDesc", lc),
        control: {
          type: "dropdown" as const,
          key: "language",
          options: { auto: t("setLangAuto", lc), en: "English", ko: "한국어" },
        } },
    ];
  }

  /**
   * 1.12 이하 fallback UI. 1.13+ 에서는 getSettingDefinitions() 가 우선 적용되어 이 메서드는 호출되지 않는다.
   */
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
      .setName(t("setWarnRedName", lc))
      .setDesc(t("setWarnRedDesc", lc))
      .addText((text) =>
        text
          .setValue(String(this.plugin.settings.warnRedDaysBeforeDrop))
          .onChange(async (value) => {
            const n = parseInt(value, 10);
            if (Number.isFinite(n) && n >= 0) {
              this.plugin.settings.warnRedDaysBeforeDrop = n;
              await this.plugin.saveSettings();
            }
          }),
      );

    new Setting(containerEl)
      .setName(t("setWarnOrangeName", lc))
      .setDesc(t("setWarnOrangeDesc", lc))
      .addText((text) =>
        text
          .setValue(String(this.plugin.settings.warnOrangeDaysBeforeDrop))
          .onChange(async (value) => {
            const n = parseInt(value, 10);
            if (Number.isFinite(n) && n >= 0) {
              this.plugin.settings.warnOrangeDaysBeforeDrop = n;
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
            if (previous !== value) {
              // 라벨은 설정 탭 재진입 시 갱신됨을 알림.
              new Notice(t("noticeLanguageChanged", resolveLocale(this.plugin.settings.language)));
            }
          }),
      );
  }
}
