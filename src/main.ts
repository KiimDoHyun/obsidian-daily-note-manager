import { Plugin, WorkspaceLeaf } from "obsidian";
import { DEFAULT_SETTINGS, DailyNoteSettings, DailyNoteSettingTab } from "./settings";
import { registerCommands } from "./commands";
import { Scheduler } from "./scheduler";
import { Engine } from "./engine";
import { VaultAdapter } from "./engine/vault";
import { resolveLocale, t } from "./i18n";
import { TIMELINE_VIEW_TYPE, TimelineView } from "./view/timelineView";

export default class DailyNoteManagerPlugin extends Plugin {
  declare settings: DailyNoteSettings;
  declare engine: Engine;
  private scheduler!: Scheduler;

  async onload() {
    await this.loadSettings();

    const locale = resolveLocale(this.settings.language);

    this.engine = new Engine(
      new VaultAdapter(this.app),
      this.settings,
      () => this.saveData(this.settings),
      this.app.vault.getName(),
    );
    this.addSettingTab(new DailyNoteSettingTab(this.app, this));
    registerCommands(this);

    this.registerView(TIMELINE_VIEW_TYPE, (leaf) => new TimelineView(leaf, this));

    this.addRibbonIcon("calendar-clock", t("ribbonOpenTimeline", locale), () => {
      void this.activateTimelineView();
    });

    this.addCommand({
      id: "open-timeline-view",
      name: t("cmdOpenTimeline", locale),
      callback: () => this.activateTimelineView(),
    });

    this.scheduler = new Scheduler(this.engine, this);
    this.scheduler.start();

    this.app.workspace.onLayoutReady(() => {
      this.engine
        .catchUp()
        .catch((err) => console.error("[daily-note] catchUp failed", err));
    });
  }

  onunload() {
    // Scheduler interval 은 plugin.registerInterval 로 자동 정리됨
  }

  async loadSettings() {
    const data = (await this.loadData()) as Partial<DailyNoteSettings> | null;
    this.settings = Object.assign({}, DEFAULT_SETTINGS, data ?? {});
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  /**
   * Obsidian 1.13+ 의 선언형 설정 API 가 saveData 를 직접 호출할 때 우리 side effect 도 태우기 위해 override.
   * 값 저장 후 열려 있는 타임라인 뷰를 즉시 갱신해 UX 일관성 유지.
   */
  async saveData(data: unknown): Promise<void> {
    await super.saveData(data);
    if (this.engine) this.rerenderOpenTimelineViews();
  }

  async activateTimelineView(): Promise<void> {
    const existing = this.app.workspace.getLeavesOfType(TIMELINE_VIEW_TYPE);
    let leaf: WorkspaceLeaf | null;
    let reused = false;
    if (existing.length > 0) {
      leaf = existing[0];
      reused = true;
    } else {
      leaf = this.app.workspace.getRightLeaf(false);
      if (leaf) await leaf.setViewState({ type: TIMELINE_VIEW_TYPE, active: true });
    }
    if (leaf) {
      await this.app.workspace.revealLeaf(leaf);
      if (reused && leaf.view instanceof TimelineView) {
        void leaf.view.forceRerender();
      }
    }
  }

  private rerenderOpenTimelineViews(): void {
    this.app.workspace.getLeavesOfType(TIMELINE_VIEW_TYPE).forEach((leaf) => {
      if (leaf.view instanceof TimelineView) void leaf.view.forceRerender();
    });
  }
}
