import { App, PluginSettingTab, Setting } from "obsidian";
import type DailyNoteManagerPlugin from "./main";
import type { LocaleSetting } from "./i18n";

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

    new Setting(containerEl)
      .setName("노트 하위 폴더")
      .setDesc("볼트 안 데일리 노트 루트 폴더 (기본 Notes)")
      .addText((text) =>
        text
          .setValue(this.plugin.settings.notesSubdir)
          .onChange(async (value) => {
            this.plugin.settings.notesSubdir = value || "Notes";
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("드롭 임계 (영업일)")
      .setDesc("이월이 이 일수를 넘으면 월간 드롭 문서로 이동 (기본 5)")
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
      .setName("경고 임계 (일)")
      .setDesc("이월이 이 일수 이상이면 🟠/🔴 경고 표시 (기본 3)")
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
      .setName("보관함 파일명")
      .setDesc("볼트 내 상시 보관함 파일 이름")
      .addText((text) =>
        text
          .setValue(this.plugin.settings.archiveFileName)
          .onChange(async (value) => {
            this.plugin.settings.archiveFileName = value || "보관함.md";
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("월간 종합 파일 접미어")
      .setDesc('예: "종합" → "2026-09 종합.md"')
      .addText((text) =>
        text
          .setValue(this.plugin.settings.monthlySummarySuffix)
          .onChange(async (value) => {
            this.plugin.settings.monthlySummarySuffix = value || "종합";
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("월간 드롭 파일 접미어")
      .setDesc('예: "드롭" → "2026-09 드롭.md"')
      .addText((text) =>
        text
          .setValue(this.plugin.settings.monthlyDropSuffix)
          .onChange(async (value) => {
            this.plugin.settings.monthlyDropSuffix = value || "드롭";
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("주말 스킵")
      .setDesc("토·일에는 노트 생성하지 않음")
      .addToggle((tg) =>
        tg
          .setValue(this.plugin.settings.skipWeekend)
          .onChange(async (v) => {
            this.plugin.settings.skipWeekend = v;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("실행 시 자동 catch-up")
      .setDesc("옵시디언 시작 시 마지막 실행 이후 놓친 날짜를 자동 처리")
      .addToggle((tg) =>
        tg
          .setValue(this.plugin.settings.autoRunOnLoad)
          .onChange(async (v) => {
            this.plugin.settings.autoRunOnLoad = v;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("Catch-up 최대 일수")
      .setDesc("이 값보다 오래 옵시디언을 안 켰다가 켜면 그 이후 날짜만 처리 (기본 14)")
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
      .setName("Language / 언어")
      .setDesc("Timeline view UI language. Auto detects from system locale.")
      .addDropdown((drop) =>
        drop
          .addOption("auto", "Auto (system)")
          .addOption("en", "English")
          .addOption("ko", "한국어")
          .setValue(this.plugin.settings.language)
          .onChange(async (value) => {
            this.plugin.settings.language = value as DailyNoteSettings["language"];
            await this.plugin.saveSettings();
          }),
      );
  }
}
