import type { Plugin } from "obsidian";
import type { Engine } from "./engine";

/**
 * 1분마다 오늘 날짜가 바뀌었는지 체크한다.
 * plugin.registerInterval 로 등록해서 unload 시 자동 정리.
 */
export class Scheduler {
  private lastRunDate: string | null = null;

  constructor(private engine: Engine, private plugin: Plugin) {}

  start() {
    void this.tick();
    const id = window.setInterval(() => void this.tick(), 60_000);
    this.plugin.registerInterval(id);
  }

  private async tick() {
    const today = new Date().toISOString().slice(0, 10);
    if (this.lastRunDate === today) return;

    try {
      await this.engine.createForToday();
      this.lastRunDate = today;
    } catch (err) {
      console.error("[daily-note] scheduler tick failed", err);
    }
  }
}
