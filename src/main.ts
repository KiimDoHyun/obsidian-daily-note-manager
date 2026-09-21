import { Plugin, WorkspaceLeaf } from "obsidian";
import { DEFAULT_SETTINGS, DailyNoteSettings, DailyNoteSettingTab } from "./settings";
import { registerCommands } from "./commands";
import { Scheduler } from "./scheduler";
import { Engine } from "./engine";
import { VaultAdapter } from "./engine/vault";
import { TIMELINE_VIEW_TYPE, TimelineView } from "./view/timelineView";

export default class DailyNoteManagerPlugin extends Plugin {
  declare settings: DailyNoteSettings;
  declare engine: Engine;
  private scheduler!: Scheduler;

  async onload() {
    await this.loadSettings();

    this.engine = new Engine(
      new VaultAdapter(this.app),
      this.settings,
      () => this.saveData(this.settings),
      this.app.vault.getName(),
    );
    this.addSettingTab(new DailyNoteSettingTab(this.app, this));
    registerCommands(this);

    this.registerView(TIMELINE_VIEW_TYPE, (leaf) => new TimelineView(leaf, this));

    this.addRibbonIcon("calendar-clock", "업무 타임라인 열기", () => {
      this.activateTimelineView();
    });

    this.addCommand({
      id: "open-timeline-view",
      name: "타임라인 뷰 열기",
      callback: () => this.activateTimelineView(),
    });

    this.scheduler = new Scheduler(this.engine);
    this.scheduler.start();

    this.app.workspace.onLayoutReady(() => {
      this.engine
        .catchUp()
        .catch((err) => console.error("[daily-note] catchUp failed", err));
    });
  }

  onunload() {
    this.scheduler?.stop();
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
    this.engine.updateSettings(this.settings);
  }

  async activateTimelineView(): Promise<void> {
    const existing = this.app.workspace.getLeavesOfType(TIMELINE_VIEW_TYPE);
    let leaf: WorkspaceLeaf | null;
    if (existing.length > 0) {
      leaf = existing[0];
    } else {
      leaf = this.app.workspace.getRightLeaf(false);
      if (leaf) await leaf.setViewState({ type: TIMELINE_VIEW_TYPE, active: true });
    }
    if (leaf) this.app.workspace.revealLeaf(leaf);
  }
}
