import { Notice, Plugin, WorkspaceLeaf } from "obsidian";
import { DEFAULT_SETTINGS, DailyNoteSettings, DailyNoteSettingTab } from "./settings";
import { registerCommands } from "./commands";
import { Scheduler } from "./scheduler";
import { Engine, CatchUpError } from "./engine";
import { VaultAdapter } from "./engine/vault";
import { resolveLocale, t } from "./i18n";
import { TIMELINE_VIEW_TYPE, TimelineView } from "./view/timelineView";
import {
  validateAndFixThresholds,
  formatThresholdResetNotice,
} from "./thresholdValidator";

export default class DailyNoteManagerPlugin extends Plugin {
  declare settings: DailyNoteSettings;
  declare engine: Engine;
  private scheduler!: Scheduler;
  /**
   * 설정 탭 인스턴스. saveData 에서 임계값을 자동 정정한 경우 열려 있는 설정 화면을
   * 강제 재렌더해 정정된 값을 즉시 반영하기 위해 저장해 둔다.
   */
  settingTab: DailyNoteSettingTab | null = null;
  /**
   * catchUp 실패 알림의 중복 방지용. 세션 메모리 전용 — persist 하지 않는다.
   * 같은 날짜에 대한 재시도가 계속 실패해도 Notice 는 세션당 한 번만 뜬다.
   * 실패 날짜가 바뀌거나 플러그인이 다시 로드되면 다시 알린다.
   */
  private lastCatchUpFailureDate: string | null = null;

  async onload() {
    await this.loadSettings();

    const locale = resolveLocale(this.settings.language);

    this.engine = new Engine(
      new VaultAdapter(this.app),
      this.settings,
      () => this.saveData(this.settings),
      this.app.vault.getName(),
    );
    this.settingTab = new DailyNoteSettingTab(this.app, this);
    this.addSettingTab(this.settingTab);
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
      void this.runCatchUp();
    });
  }

  /**
   * catchUp 을 래핑해 실패 시 사용자에게 Notice 로 알린다.
   * 같은 실패 날짜에 대해서는 세션당 한 번만 알린다(dedupe).
   * 성공하면 dedupe 상태를 리셋해 다음 실패 때 즉시 다시 알린다.
   */
  async runCatchUp(): Promise<void> {
    try {
      await this.engine.catchUp();
      this.lastCatchUpFailureDate = null;
    } catch (err) {
      if (err instanceof CatchUpError) {
        console.error("[daily-note] catchUp failed at", err.failedDate, err.cause);
        if (this.lastCatchUpFailureDate !== err.failedDate) {
          this.lastCatchUpFailureDate = err.failedDate;
          new Notice(formatCatchUpFailureMessage(err.failedDate), 10000);
        }
      } else {
        console.error("[daily-note] catchUp failed", err);
      }
    }
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
   * Obsidian 1.13+ 의 선언형 설정 API 는 사용자가 UI 를 조작하면 우리 onChange 를 거치지 않고
   * plugin.settings 를 직접 mutate 한 뒤 saveData 를 호출한다. fallback UI(1.12 이하) 도 결국
   * saveData 로 흘러들어오므로, 임계값 유효성 검증은 여기서 단 한 번만 돌린다.
   *
   * 흐름:
   *   1. 저장 직전에 validateAndFixThresholds 로 세 임계값의 조합을 검사.
   *   2. 정정이 일어났으면 super.saveData 는 이미 정정된 값을 그대로 persist.
   *   3. 사용자에게 Notice 로 알리고, 설정 탭이 열려 있으면 재렌더해 화면에도 반영.
   *   4. 저장 후 열려 있는 타임라인 뷰도 갱신 (기존 side effect 유지).
   *
   * 유효한 조합으로 저장하는 경우엔 Notice 도, 재렌더도 없다 — 타이핑 도중 스팸 방지.
   */
  async saveData(data: unknown): Promise<void> {
    const validation =
      data === this.settings
        ? validateAndFixThresholds(this.settings)
        : { fixed: false, resetDrop: false };
    await super.saveData(data);
    if (validation.fixed) {
      new Notice(formatThresholdResetNotice(this.settings, validation.resetDrop));
      this.refreshSettingTab();
    }
    if (this.engine) this.rerenderOpenTimelineViews();
  }

  /**
   * 자동 보정 후 열려 있는 설정 화면을 갱신한다.
   * 1.13+ 의 선언형 재빌드 API 만 사용한다. 이전 버전에서는 화면은 그대로지만
   * Notice 로 정정 사실을 알리고, 사용자가 설정을 다시 열면 정정값을 볼 수 있다.
   */
  private refreshSettingTab(): void {
    const tab = this.settingTab;
    if (!tab?.containerEl) return;
    const maybeUpdate = (tab as unknown as { update?: () => void }).update;
    if (typeof maybeUpdate === "function") maybeUpdate.call(tab);
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

/**
 * catchUp 실패 알림 문자열. ISO(YYYY-MM-DD) → "M월 D일" 로 축약.
 * i18n 은 이 한 문장에 대해 오버엔지니어링이라 한국어 고정.
 */
export function formatCatchUpFailureMessage(failedIsoDate: string): string {
  const parts = failedIsoDate.split("-");
  const month = parts.length >= 2 ? parseInt(parts[1], 10) : NaN;
  const day = parts.length >= 3 ? parseInt(parts[2], 10) : NaN;
  const label =
    Number.isFinite(month) && Number.isFinite(day) ? `${month}월 ${day}일` : failedIsoDate;
  return (
    `Daily Note Manager: ${label} 노트 생성에 실패했습니다.\n` +
    `원인 확인 후 명령 팔레트에서 "오늘 노트 강제 생성" 실행.`
  );
}
