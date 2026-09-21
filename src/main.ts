import { Plugin } from "obsidian";
import { DEFAULT_SETTINGS, DailyNoteSettings, DailyNoteSettingTab } from "./settings";
import { registerCommands } from "./commands";
import { Scheduler } from "./scheduler";
import { Engine } from "./engine";

export default class DailyNoteManagerPlugin extends Plugin {
  declare settings: DailyNoteSettings;
  declare engine: Engine;
  private scheduler!: Scheduler;

  async onload() {
    await this.loadSettings();

    this.engine = new Engine(this.app, this.settings, () => this.saveData(this.settings));
    this.addSettingTab(new DailyNoteSettingTab(this.app, this));
    registerCommands(this);

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
}
