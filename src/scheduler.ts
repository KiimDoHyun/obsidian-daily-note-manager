import type { Plugin } from "obsidian";
import type { Engine } from "./engine";
import { today, toIsoDate } from "./engine/dateutil";

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
    // 로컬 캘린더 기준. UTC 로 뽑으면 KST 새벽에 하루가 밀림.
    const todayIso = toIsoDate(today());
    if (this.lastRunDate === todayIso) return;

    // 어제 노트를 편집 중이고 저장 전이면 롤오버가 옛 스냅샷 기준으로 판정된다.
    // tick 진입 전에 열린 마크다운 뷰를 먼저 저장해 디스크와 편집기 상태를 맞춘다.
    await this.flushOpenEditors();

    try {
      await this.engine.createForToday();
      this.lastRunDate = todayIso;
    } catch (err) {
      console.error("[daily-note] scheduler tick failed", err);
    }
  }

  private async flushOpenEditors(): Promise<void> {
    const app = (this.plugin as { app?: unknown }).app as
      | {
          workspace?: {
            getLeavesOfType?: (t: string) => Array<{ view?: { save?: () => Promise<void> } }>;
          };
        }
      | undefined;
    const leaves = app?.workspace?.getLeavesOfType?.("markdown");
    if (!leaves || leaves.length === 0) return;

    for (const leaf of leaves) {
      const save = leaf.view?.save;
      if (typeof save !== "function") continue;
      try {
        await save.call(leaf.view);
      } catch (err) {
        console.warn("[daily-note] flushOpenEditors save failed", err);
      }
    }
  }
}
