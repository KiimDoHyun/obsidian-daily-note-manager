import { App, Modal, Notice, Setting } from "obsidian";
import type DailyNoteManagerPlugin from "./main";
import { fromIsoDate } from "./engine/dateutil";

export function registerCommands(plugin: DailyNoteManagerPlugin) {
  plugin.addCommand({
    id: "create-today",
    name: "오늘 데일리 노트 생성",
    callback: async () => {
      try {
        const result = await plugin.engine.createForToday();
        new Notice(result.message);
      } catch (err) {
        console.error("[daily-note] create-today failed", err);
        new Notice(`생성 실패: ${(err as Error).message}`);
      }
    },
  });

  plugin.addCommand({
    id: "dry-run",
    name: "Dry-run: 예상 동작만 출력",
    callback: async () => {
      try {
        const report = await plugin.engine.dryRun();
        new Notice(report.summary);
        console.log("[daily-note] dry-run", report);
      } catch (err) {
        console.error("[daily-note] dry-run failed", err);
        new Notice(`dry-run 실패: ${(err as Error).message}`);
      }
    },
  });

  plugin.addCommand({
    id: "recompute-current-month",
    name: "이번 달 종합 재계산",
    callback: async () => {
      const now = new Date();
      const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
      try {
        await plugin.engine.recomputeMonth(ym);
        new Notice(`${ym} 종합 재계산 완료`);
      } catch (err) {
        console.error("[daily-note] recompute failed", err);
        new Notice(`재계산 실패: ${(err as Error).message}`);
      }
    },
  });

  plugin.addCommand({
    id: "force-date",
    name: "특정 날짜 노트 강제 재생성",
    callback: async () => {
      new DatePromptModal(plugin.app, async (iso) => {
        try {
          const result = await plugin.engine.forceDate(fromIsoDate(iso));
          new Notice(result.message);
        } catch (err) {
          console.error("[daily-note] force failed", err);
          new Notice(`강제 생성 실패: ${(err as Error).message}`);
        }
      }).open();
    },
  });

  plugin.addCommand({
    id: "doctor",
    name: "환경 진단",
    callback: async () => {
      try {
        const diag = await plugin.engine.doctor();
        console.log("[daily-note] doctor", diag);
        new Notice(diag.ok ? `정상 (${diag.notesSubdir})` : `문제: ${diag.issues.join(", ")}`);
      } catch (err) {
        console.error("[daily-note] doctor failed", err);
        new Notice(`진단 실패: ${(err as Error).message}`);
      }
    },
  });
}

class DatePromptModal extends Modal {
  private value: string;

  constructor(app: App, private onSubmit: (iso: string) => void) {
    super(app);
    const t = new Date();
    this.value = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(
      t.getDate(),
    ).padStart(2, "0")}`;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.createEl("h3", { text: "노트를 강제 재생성할 날짜" });
    new Setting(contentEl)
      .setName("YYYY-MM-DD")
      .addText((t) =>
        t.setValue(this.value).onChange((v) => {
          this.value = v.trim();
        }),
      );
    new Setting(contentEl).addButton((b) =>
      b
        .setButtonText("실행")
        .setCta()
        .onClick(() => {
          if (!/^\d{4}-\d{2}-\d{2}$/.test(this.value)) {
            new Notice("형식이 YYYY-MM-DD 여야 합니다");
            return;
          }
          this.close();
          this.onSubmit(this.value);
        }),
    );
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
