import { Notice, Plugin, WorkspaceLeaf } from "obsidian";
import { DEFAULT_SETTINGS, DailyNoteSettings, DailyNoteSettingTab } from "./settings";
import { registerCommands } from "./commands";
import { Scheduler } from "./scheduler";
import { Engine } from "./engine";
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

    // 노트 생성은 스케줄러 하나로만 진입한다. 첫 tick 이 오늘 노트를 만든다.
    // 볼트 파일 목록이 다 올라온 뒤 시작해야 "이미 있는 노트" 판정이 정확하다.
    this.scheduler = new Scheduler(this.engine, this);
    this.app.workspace.onLayoutReady(() => {
      this.scheduler.start();
    });
  }

  onunload() {
    // Scheduler interval 은 plugin.registerInterval 로 자동 정리됨
  }

  async loadSettings() {
    const data = (await this.loadData()) as (Partial<DailyNoteSettings> & Record<string, unknown>) | null;
    // 0.2.6 까지 있던 설정(autoRunOnLoad, maxCatchUpDays)은 더 이상 쓰지 않으므로 버린다.
    const { autoRunOnLoad: _a, maxCatchUpDays: _m, ...rest } = data ?? {};
    this.settings = Object.assign({}, DEFAULT_SETTINGS, rest);
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
