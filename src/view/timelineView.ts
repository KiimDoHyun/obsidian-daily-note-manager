import { ItemView, WorkspaceLeaf } from "obsidian";
import type DailyNoteManagerPlugin from "../main";
import {
  addDays,
  businessDaysInSpan,
  firstOfMonth,
  isWeekend,
  lastOfMonth,
  toIsoDate,
  today as todayDate,
  ymOf,
} from "../engine/dateutil";
import { dailyNotePath } from "../engine/paths";
import { VaultAdapter } from "../engine/vault";
import { collectTimelineItems, type TimelineItem } from "../engine/writers/timeline";
import {
  dayOfWeekChar,
  durationLabel,
  rangeLabel,
  resolveLocale,
  t,
  type Locale,
} from "../i18n";

export const TIMELINE_VIEW_TYPE = "daily-note-timeline-view";

const COLOR_ACTIVE = "#3b82f6";
const COLOR_DONE = "#22c55e";
const COLOR_DROPPED = "#9ca3af";
const COLOR_TODAY = "#ef4444";

const DAY_WIDTH = 32;
const HEADER_HEIGHT = 40;
const ROW_HEIGHT = 28;
const BAR_HEIGHT = 18;
const SECTION_GAP = 8;
const LABEL_WIDTH_MIN = 100;
const LABEL_WIDTH_MAX = 600;

export class TimelineView extends ItemView {
  private currentMonth: Date;
  private tooltipEl: HTMLDivElement | null = null;
  private locale: Locale = "en";

  constructor(leaf: WorkspaceLeaf, private plugin: DailyNoteManagerPlugin) {
    super(leaf);
    this.currentMonth = firstOfMonth(todayDate());
  }

  getViewType(): string {
    return TIMELINE_VIEW_TYPE;
  }
  getDisplayText(): string {
    const label = this.locale === "ko" ? "업무 타임라인" : "Task Timeline";
    return `${label} (${ymOf(this.currentMonth)})`;
  }
  getIcon(): string {
    return "calendar-clock";
  }

  async onOpen(): Promise<void> {
    await this.rerender();
  }

  async onClose(): Promise<void> {
    this.contentEl.empty();
  }

  /** 외부(플러그인 설정 저장, 리본 재클릭 등)에서 강제 재렌더링. */
  async forceRerender(): Promise<void> {
    await this.rerender();
  }

  private async rerender(): Promise<void> {
    this.locale = resolveLocale(this.plugin.settings.language);
    const vault = new VaultAdapter(this.app);
    const items = await collectTimelineItems(this.currentMonth, vault, this.plugin.settings);
    this.contentEl.empty();
    this.contentEl.addClass("dnm-timeline-view");
    this.renderToolbar();
    this.renderLegend();
    this.renderChart(items);
    this.tooltipEl = this.contentEl.createDiv({ cls: "dnm-tooltip" });
    this.tooltipEl.style.display = "none";
  }

  private renderToolbar(): void {
    const bar = this.contentEl.createDiv({ cls: "dnm-toolbar" });
    const prev = bar.createEl("button", { text: "◀" });
    prev.onclick = async () => {
      this.currentMonth = firstOfMonth(addDays(this.currentMonth, -1));
      await this.rerender();
    };

    bar.createEl("span", { text: ymOf(this.currentMonth), cls: "dnm-ym" });

    const next = bar.createEl("button", { text: "▶" });
    next.onclick = async () => {
      this.currentMonth = firstOfMonth(addDays(lastOfMonth(this.currentMonth), 1));
      await this.rerender();
    };

    const todayBtn = bar.createEl("button", { text: t("toolbarToday", this.locale) });
    todayBtn.onclick = async () => {
      this.currentMonth = firstOfMonth(todayDate());
      await this.rerender();
    };

    bar.createDiv({ cls: "dnm-spacer" });

    const refresh = bar.createEl("button", { text: t("toolbarRefresh", this.locale) });
    refresh.onclick = () => this.rerender();
  }

  private renderLegend(): void {
    const legend = this.contentEl.createDiv({ cls: "dnm-legend" });
    const item = (color: string, label: string) => {
      const wrap = legend.createDiv({ cls: "dnm-legend-item" });
      const swatch = wrap.createDiv({ cls: "dnm-legend-swatch" });
      swatch.style.background = color;
      wrap.createSpan({ text: label });
    };
    item(COLOR_ACTIVE, t("legendActive", this.locale));
    item(COLOR_DONE, t("legendDone", this.locale));
    item(COLOR_DROPPED, t("legendDropped", this.locale));
    legend.createSpan({ text: t("legendHint", this.locale), cls: "dnm-legend-hint" });
  }

  private renderChart(items: TimelineItem[]): void {
    const wrap = this.contentEl.createDiv({ cls: "dnm-chart-wrap" });

    if (items.length === 0) {
      wrap.createEl("p", { text: t("emptyMonth", this.locale), cls: "dnm-empty" });
      return;
    }

    const sorted = this.sortItems(items);
    const first = firstOfMonth(this.currentMonth);
    const daysInMonth = lastOfMonth(this.currentMonth).getDate();

    const rowLayout = this.computeRowLayout(sorted);
    const totalRowsHeight = rowLayout[rowLayout.length - 1].y + ROW_HEIGHT;
    const chartWidth = daysInMonth * DAY_WIDTH;
    const chartTotalHeight = HEADER_HEIGHT + totalRowsHeight;

    // 좌: 라벨 컬럼 (가로 스크롤 영향 없음, 사용자 리사이즈 가능)
    const labelsCol = wrap.createDiv({ cls: "dnm-labels-col" });
    labelsCol.style.width = `${this.plugin.settings.timelineLabelWidth}px`;
    const labelsHeader = labelsCol.createDiv({ cls: "dnm-labels-header" });
    labelsHeader.style.height = `${HEADER_HEIGHT}px`;
    const labelsBody = labelsCol.createDiv({ cls: "dnm-labels-body" });

    // 드래그 핸들
    const handle = wrap.createDiv({ cls: "dnm-drag-handle" });
    this.setupDragHandle(handle, labelsCol);

    // 우: 차트 (가로 스크롤)
    const chartCol = wrap.createDiv({ cls: "dnm-chart-col" });
    const svg = svgEl("svg");
    svg.setAttribute("width", String(chartWidth));
    svg.setAttribute("height", String(chartTotalHeight));
    svg.classList.add("dnm-svg");
    chartCol.appendChild(svg);

    this.defineWeekendStripePattern(svg);
    this.drawWeekendBackgrounds(svg, first, daysInMonth, chartTotalHeight);
    this.drawWeekendBorders(svg, first, daysInMonth, chartTotalHeight);
    this.drawDayHeaders(svg, first, daysInMonth);
    this.drawTodayLine(svg, first, daysInMonth, chartTotalHeight);

    sorted.forEach((item, idx) => {
      const y = HEADER_HEIGHT + rowLayout[idx].y;

      // 라벨 — CSS ellipsis 로 오버플로 처리 (컬럼 폭 조정 시 자동 반영)
      const labelDiv = labelsBody.createDiv({ cls: "dnm-row-label" });
      labelDiv.style.height = `${ROW_HEIGHT}px`;
      if (rowLayout[idx].extraTop > 0) {
        labelDiv.style.marginTop = `${rowLayout[idx].extraTop}px`;
      }
      labelDiv.setAttr("title", item.name); // 브라우저 native tooltip (fallback)
      labelDiv.setText(item.name);
      labelDiv.addEventListener("mouseenter", (e) => this.showTooltip(item, e as MouseEvent));
      labelDiv.addEventListener("mousemove", (e) => this.positionTooltip(e as MouseEvent));
      labelDiv.addEventListener("mouseleave", () => this.hideTooltip());
      labelDiv.addEventListener("click", () => this.openDailyNoteFor(item));
      labelDiv.style.cursor = "pointer";

      // 차트 row 그룹
      const rowGroup = svgEl("g");
      rowGroup.classList.add("dnm-row");
      svg.appendChild(rowGroup);

      const bg = svgEl("rect");
      bg.classList.add("dnm-row-bg");
      bg.setAttribute("x", "0");
      bg.setAttribute("y", String(y));
      bg.setAttribute("width", String(chartWidth));
      bg.setAttribute("height", String(ROW_HEIGHT));
      rowGroup.appendChild(bg);

      const range = this.clipRangeToMonth(item, first, daysInMonth);
      if (range !== null) {
        const { startDay, endDay } = range;
        const x = (startDay - 1) * DAY_WIDTH + 2;
        const w = Math.max((endDay - startDay + 1) * DAY_WIDTH - 4, 4);
        const barY = y + (ROW_HEIGHT - BAR_HEIGHT) / 2;

        // 1) 연속 막대 (캘린더 스팬)
        const bar = svgEl("rect");
        bar.classList.add("dnm-bar");
        bar.setAttribute("x", String(x));
        bar.setAttribute("y", String(barY));
        bar.setAttribute("width", String(w));
        bar.setAttribute("height", String(BAR_HEIGHT));
        bar.setAttribute("rx", "3");
        bar.setAttribute("fill", this.colorFor(item.status));
        bar.addEventListener("click", () => this.openDailyNoteFor(item));
        bar.addEventListener("mouseenter", (e) => this.showTooltip(item, e as MouseEvent));
        bar.addEventListener("mousemove", (e) => this.positionTooltip(e as MouseEvent));
        bar.addEventListener("mouseleave", () => this.hideTooltip());
        rowGroup.appendChild(bar);

        // 2) 막대 안에 낀 주말 컬럼 위에 대각 줄무늬 오버레이
        //    → "이 부분은 주말이라 실제로는 진행 안 됨" 을 시각적으로 표현
        for (let d = startDay; d <= endDay; d++) {
          const day = new Date(first.getFullYear(), first.getMonth(), d);
          if (!isWeekend(day)) continue;
          const ox = (d - 1) * DAY_WIDTH;
          const overlay = svgEl("rect");
          overlay.classList.add("dnm-bar-weekend");
          overlay.setAttribute("x", String(ox));
          overlay.setAttribute("y", String(barY));
          overlay.setAttribute("width", String(DAY_WIDTH));
          overlay.setAttribute("height", String(BAR_HEIGHT));
          overlay.setAttribute("fill", "url(#dnm-weekend-stripes)");
          overlay.style.pointerEvents = "none";
          rowGroup.appendChild(overlay);
        }

        const duration = this.durationDisplay(item, w);
        if (duration) {
          const dur = svgEl("text");
          dur.classList.add("dnm-duration");
          dur.setAttribute("x", String(x + w / 2));
          dur.setAttribute("y", String(barY + BAR_HEIGHT / 2 + 4));
          dur.setAttribute("text-anchor", "middle");
          dur.setAttribute("font-size", "11");
          dur.textContent = duration;
          rowGroup.appendChild(dur);
        }
      }

      const setHover = (on: boolean) => {
        labelDiv.classList.toggle("dnm-hovered", on);
        rowGroup.classList.toggle("dnm-hovered", on);
      };
      labelDiv.addEventListener("mouseenter", () => setHover(true));
      labelDiv.addEventListener("mouseleave", () => setHover(false));
      rowGroup.addEventListener("mouseenter", () => setHover(true));
      rowGroup.addEventListener("mouseleave", () => setHover(false));
    });
  }

  private setupDragHandle(handle: HTMLElement, labelsCol: HTMLElement): void {
    handle.addEventListener("mousedown", (e) => {
      e.preventDefault();
      const startX = e.clientX;
      const startWidth = labelsCol.offsetWidth;
      document.body.style.cursor = "col-resize";

      const onMove = (evt: MouseEvent) => {
        const delta = evt.clientX - startX;
        const w = Math.max(LABEL_WIDTH_MIN, Math.min(LABEL_WIDTH_MAX, startWidth + delta));
        labelsCol.style.width = `${w}px`;
      };
      const onUp = () => {
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
        document.body.style.cursor = "";
        this.plugin.settings.timelineLabelWidth = labelsCol.offsetWidth;
        void this.plugin.saveSettings();
      };
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    });
  }

  private computeRowLayout(items: TimelineItem[]): { y: number; extraTop: number }[] {
    const result: { y: number; extraTop: number }[] = [];
    let y = 0;
    let lastSection: TimelineItem["section"] | null = null;
    for (const item of items) {
      let extra = 0;
      if (lastSection !== null && lastSection !== item.section) {
        extra = SECTION_GAP;
        y += SECTION_GAP;
      }
      result.push({ y, extraTop: extra });
      lastSection = item.section;
      y += ROW_HEIGHT;
    }
    return result;
  }

  private sortItems(items: TimelineItem[]): TimelineItem[] {
    const sectionRank = { 진행중: 0, 완료: 1, 드롭: 2 } as const;
    return [...items].sort((a, b) => {
      if (a.section !== b.section) return sectionRank[a.section] - sectionRank[b.section];
      return a.start.getTime() - b.start.getTime();
    });
  }

  private drawWeekendBackgrounds(
    svg: SVGSVGElement,
    first: Date,
    daysInMonth: number,
    height: number,
  ): void {
    for (let d = 1; d <= daysInMonth; d++) {
      const day = new Date(first.getFullYear(), first.getMonth(), d);
      if (!isWeekend(day)) continue;
      const rect = svgEl("rect");
      rect.classList.add("dnm-weekend");
      rect.setAttribute("x", String((d - 1) * DAY_WIDTH));
      rect.setAttribute("y", String(HEADER_HEIGHT));
      rect.setAttribute("width", String(DAY_WIDTH));
      rect.setAttribute("height", String(height - HEADER_HEIGHT));
      svg.appendChild(rect);
    }
  }

  private drawWeekendBorders(
    svg: SVGSVGElement,
    first: Date,
    daysInMonth: number,
    height: number,
  ): void {
    const draw = (x: number) => {
      const line = svgEl("line");
      line.classList.add("dnm-weekend-border");
      line.setAttribute("x1", String(x));
      line.setAttribute("y1", "0");
      line.setAttribute("x2", String(x));
      line.setAttribute("y2", String(height));
      svg.appendChild(line);
    };
    for (let d = 1; d <= daysInMonth; d++) {
      const day = new Date(first.getFullYear(), first.getMonth(), d);
      const dow = day.getDay();
      if (dow === 6) draw((d - 1) * DAY_WIDTH);
      if (dow === 0) draw(d * DAY_WIDTH);
    }
  }

  private drawDayHeaders(svg: SVGSVGElement, first: Date, daysInMonth: number): void {
    for (let d = 1; d <= daysInMonth; d++) {
      const day = new Date(first.getFullYear(), first.getMonth(), d);
      const x = (d - 1) * DAY_WIDTH + DAY_WIDTH / 2;

      const dayLabel = svgEl("text");
      dayLabel.classList.add("dnm-day-of-week");
      dayLabel.setAttribute("x", String(x));
      dayLabel.setAttribute("y", "16");
      dayLabel.setAttribute("text-anchor", "middle");
      dayLabel.setAttribute("font-size", "10");
      dayLabel.textContent = dayOfWeekChar(day.getDay(), this.locale);
      svg.appendChild(dayLabel);

      const dateLabel = svgEl("text");
      dateLabel.classList.add("dnm-day-num");
      dateLabel.setAttribute("x", String(x));
      dateLabel.setAttribute("y", "32");
      dateLabel.setAttribute("text-anchor", "middle");
      dateLabel.textContent = String(d);
      svg.appendChild(dateLabel);
    }
  }

  private drawTodayLine(
    svg: SVGSVGElement,
    first: Date,
    _daysInMonth: number,
    height: number,
  ): void {
    const today = todayDate();
    if (
      today.getFullYear() !== first.getFullYear() ||
      today.getMonth() !== first.getMonth()
    ) {
      return;
    }
    const x = (today.getDate() - 0.5) * DAY_WIDTH;
    const line = svgEl("line");
    line.classList.add("dnm-today-line");
    line.setAttribute("x1", String(x));
    line.setAttribute("y1", "0");
    line.setAttribute("x2", String(x));
    line.setAttribute("y2", String(height));
    line.setAttribute("stroke", COLOR_TODAY);
    line.setAttribute("stroke-width", "2");
    line.setAttribute("stroke-dasharray", "4 3");
    svg.appendChild(line);

    const label = svgEl("text");
    label.classList.add("dnm-today-label");
    label.setAttribute("x", String(x + 4));
    label.setAttribute("y", "12");
    label.setAttribute("fill", COLOR_TODAY);
    label.setAttribute("font-size", "10");
    label.textContent = t("todayLabel", this.locale);
    svg.appendChild(label);
  }

  /** 주말 표시용 대각 줄무늬 패턴을 SVG defs 에 한 번 등록. */
  private defineWeekendStripePattern(svg: SVGSVGElement): void {
    const defs = svgEl("defs");
    const pattern = svgEl("pattern");
    pattern.setAttribute("id", "dnm-weekend-stripes");
    pattern.setAttribute("width", "7");
    pattern.setAttribute("height", "7");
    pattern.setAttribute("patternUnits", "userSpaceOnUse");
    pattern.setAttribute("patternTransform", "rotate(-45)");

    const bg = svgEl("rect");
    bg.setAttribute("width", "7");
    bg.setAttribute("height", "7");
    bg.setAttribute("fill", "rgba(255,255,255,0)");
    pattern.appendChild(bg);

    const line = svgEl("line");
    line.setAttribute("x1", "0");
    line.setAttribute("y1", "0");
    line.setAttribute("x2", "0");
    line.setAttribute("y2", "7");
    line.setAttribute("stroke", "rgba(255,255,255,0.75)");
    line.setAttribute("stroke-width", "3.5");
    pattern.appendChild(line);

    defs.appendChild(pattern);
    svg.appendChild(defs);
  }

  private clipRangeToMonth(
    item: TimelineItem,
    first: Date,
    daysInMonth: number,
  ): { startDay: number; endDay: number } | null {
    const monthStart = first;
    const monthEnd = new Date(first.getFullYear(), first.getMonth(), daysInMonth);
    if (item.end < monthStart || item.start > monthEnd) return null;
    const s = item.start < monthStart ? monthStart : item.start;
    const e = item.end > monthEnd ? monthEnd : item.end;
    return { startDay: s.getDate(), endDay: e.getDate() };
  }

  private colorFor(status: TimelineItem["status"]): string {
    if (status === "active") return COLOR_ACTIVE;
    if (status === "done") return COLOR_DONE;
    return COLOR_DROPPED;
  }

  private sectionLabel(section: TimelineItem["section"]): string {
    if (section === "진행중") return t("sectionActive", this.locale);
    if (section === "완료") return t("sectionDone", this.locale);
    return t("sectionDropped", this.locale);
  }

  private durationText(item: TimelineItem): string {
    const n = businessDaysInSpan(item.start, item.end);
    return durationLabel(n, item.status, this.locale);
  }

  /**
   * 진행중 항목의 드롭 경고 emoji.
   * settings.warnThresholdDays 를 기준으로:
   *   businessDaysInSpan === warnOrange → 🟠
   *   businessDaysInSpan >= warnRed(warnOrange+1) → 🔴
   * #장기 마커 있으면 면제 (데일리 노트 규칙과 동일).
   */
  private warningEmoji(item: TimelineItem): string {
    if (item.status !== "active") return "";
    if (item.hasLongMarker) return "";
    const n = businessDaysInSpan(item.start, item.end);
    const warnOrange = this.plugin.settings.warnThresholdDays;
    const warnRed = warnOrange + 1;
    if (n >= warnRed) return "🔴";
    if (n === warnOrange) return "🟠";
    return "";
  }

  /**
   * 막대 폭에 맞춰 표시 텍스트를 결정.
   * 우선순위: '경고+full' → '경고+short' → '경고만' → 'full' → 'short' → 빈 문자열.
   */
  private durationDisplay(item: TimelineItem, barWidth: number): string {
    const n = businessDaysInSpan(item.start, item.end);
    const full = durationLabel(n, item.status, this.locale);
    const short = this.locale === "ko" ? `${n}일` : `${n}d`;
    const emoji = this.warningEmoji(item);

    const fits = (s: string) => this.estimateTextWidth(s) + 8 <= barWidth;
    const withEm = (s: string) => (emoji ? `${emoji} ${s}` : s);

    if (emoji) {
      if (fits(withEm(full))) return withEm(full);
      if (fits(withEm(short))) return withEm(short);
      if (fits(emoji)) return emoji;
    }
    if (fits(full)) return full;
    if (fits(short)) return short;
    return "";
  }

  /** 한글 문자는 11px, 이모지는 대략 14px, ASCII 는 7px 기준. */
  private estimateTextWidth(text: string): number {
    let w = 0;
    for (const ch of text) {
      const code = ch.codePointAt(0) ?? 0;
      if (code > 0x1f000 && code < 0x1fbff) w += 14; // emoji
      else if (/[ㄱ-ㆎ가-힣]/.test(ch)) w += 11;
      else if (ch === " ") w += 3.5;
      else w += 7;
    }
    return w;
  }


  private showTooltip(item: TimelineItem, evt: MouseEvent): void {
    const el = this.tooltipEl;
    if (!el) return;
    el.empty();

    const title = el.createDiv({ cls: "dnm-tt-title" });
    title.setText(item.name);

    const meta = el.createDiv({ cls: "dnm-tt-meta" });
    const warnEmoji = this.warningEmoji(item);
    const sectionMark = warnEmoji
      || (item.section === "진행중" ? "🔵" : item.section === "완료" ? "🟢" : "⚫");
    meta.setText(
      `${sectionMark} ${this.sectionLabel(item.section)} · ${this.durationText(item)} · ${rangeLabel(toIsoDate(item.start), toIsoDate(item.end), this.locale)}`,
    );

    // 드롭 경고 카운트다운
    if (warnEmoji) {
      const daysUntilDrop = this.plugin.settings.dropThresholdDays
        - businessDaysInSpan(item.start, item.end);
      if (daysUntilDrop > 0) {
        const warn = el.createDiv({ cls: "dnm-tt-warn" });
        const key = daysUntilDrop === 1 ? "warnTooltipCountdownOne" : "warnTooltipCountdownMulti";
        warn.setText(t(key, this.locale, { n: daysUntilDrop }));
      }
    }

    if (item.children.length > 0) {
      const pre = el.createEl("pre", { cls: "dnm-tt-children" });
      pre.setText(item.children.map((l) => l.replace(/\t/g, "    ")).join("\n"));
    } else if (item.section !== "진행중") {
      const empty = el.createDiv({ cls: "dnm-tt-empty" });
      empty.setText(t("noChildren", this.locale));
    }

    const hint = el.createDiv({ cls: "dnm-tt-hint" });
    hint.setText(t("clickHint", this.locale));

    el.style.display = "block";
    this.positionTooltip(evt);
  }

  private positionTooltip(evt: MouseEvent): void {
    const el = this.tooltipEl;
    if (!el || el.style.display === "none") return;
    const container = this.contentEl.getBoundingClientRect();
    const relX = evt.clientX - container.left;
    const relY = evt.clientY - container.top;
    const ttRect = el.getBoundingClientRect();
    const offset = 14;

    let x = relX + offset;
    let y = relY + offset;

    if (x + ttRect.width > container.width - 8) {
      x = Math.max(8, relX - ttRect.width - offset);
    }
    if (y + ttRect.height > container.height - 8) {
      y = Math.max(8, container.height - ttRect.height - 8);
    }
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
  }

  private hideTooltip(): void {
    if (this.tooltipEl) this.tooltipEl.style.display = "none";
  }

  private async openDailyNoteFor(item: TimelineItem): Promise<void> {
    const target = item.start;
    const path = dailyNotePath(target, this.plugin.settings);
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!file) {
      const summary = `${this.plugin.settings.notesSubdir}/${ymOf(target)}/${ymOf(target)} ${this.plugin.settings.monthlySummarySuffix}.md`;
      const sfile = this.app.vault.getAbstractFileByPath(summary);
      if (sfile) {
        await this.app.workspace.openLinkText(summary, "", false);
      }
      return;
    }
    await this.app.workspace.openLinkText(path, "", false);
  }
}

function svgEl<K extends keyof SVGElementTagNameMap>(name: K): SVGElementTagNameMap[K] {
  return document.createElementNS("http://www.w3.org/2000/svg", name);
}
