import type { Engine } from "./engine";

/**
 * 1분마다 오늘 날짜가 바뀌었는지 체크한다.
 * launchd 의 RunAtLoad 를 대체하는 역할.
 */
export class Scheduler {
  private timer: number | null = null;
  private lastRunDate: string | null = null;

  constructor(private engine: Engine) {}

  start() {
    void this.tick();
    this.timer = window.setInterval(() => void this.tick(), 60_000);
  }

  stop() {
    if (this.timer !== null) {
      window.clearInterval(this.timer);
      this.timer = null;
    }
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
