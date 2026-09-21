import { ItemView, WorkspaceLeaf } from "obsidian";
import type DailyNoteManagerPlugin from "../main";
import {
  addDays,
  businessDaysBetween,
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

export const TIMELINE_VIEW_TYPE = "daily-note-timeline-view";

const COLOR_ACTIVE = "#3b82f6";
const COLOR_DONE = "#22c55e";
const COLOR_DROPPED = "#9ca3af";
const COLOR_TODAY = "#ef4444";

const LABEL_WIDTH = 220;
const DAY_WIDTH = 32;
const HEADER_HEIGHT = 40;
const ROW_HEIGHT = 28;
const BAR_HEIGHT = 18;
const SECTION_GAP = 8;

export class TimelineView extends ItemView {
  private currentMonth: Date;

  constructor(leaf: WorkspaceLeaf, private plugin: DailyNoteManagerPlugin) {
    super(leaf);
    this.currentMonth = firstOfMonth(todayDate());
  }

  getViewType(): string {
    return TIMELINE_VIEW_TYPE;
  }
  getDisplayText(): string {
    return `업무 타임라인 (${ymOf(this.currentMonth)})`;
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

  private async rerender(): Promise<void> {
    const vault = new VaultAdapter(this.app);
    const items = await collectTimelineItems(this.currentMonth, vault, this.plugin.settings);
    this.contentEl.empty();
    this.contentEl.addClass("dnm-timeline-view");
    this.renderToolbar();
    this.renderLegend();
    this.renderChart(items);
  }

  private renderToolbar(): void {
    const bar = this.contentEl.createDiv({ cls: "dnm-toolbar" });
    const prev = bar.createEl("button", { text: "◀" });
    prev.onclick = async () => {
      this.currentMonth = firstOfMonth(addDays(this.currentMonth, -1));
      await this.rerender();
    };

    const label = bar.createEl("span", { text: ymOf(this.currentMonth), cls: "dnm-ym" });

    const next = bar.createEl("button", { text: "▶" });
    next.onclick = async () => {
      this.currentMonth = firstOfMonth(addDays(lastOfMonth(this.currentMonth), 1));
      await this.rerender();
    };

    const today = bar.createEl("button", { text: "오늘" });
    today.onclick = async () => {
      this.currentMonth = firstOfMonth(todayDate());
      await this.rerender();
    };

    bar.createDiv({ cls: "dnm-spacer" });

    const refresh = bar.createEl("button", { text: "↻ 새로고침" });
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
    item(COLOR_ACTIVE, "진행중");
    item(COLOR_DONE, "완료");
    item(COLOR_DROPPED, "드롭");
    legend.createSpan({
      text: "· 막대 클릭 시 시작일 데일리 노트로 이동",
      cls: "dnm-legend-hint",
    });
  }

  private renderChart(items: TimelineItem[]): void {
    const wrap = this.contentEl.createDiv({ cls: "dnm-chart-wrap" });

    if (items.length === 0) {
      wrap.createEl("p", { text: "이번 달 이벤트가 없습니다.", cls: "dnm-empty" });
      return;
    }

    const sorted = this.sortItems(items);
    const first = firstOfMonth(this.currentMonth);
    const daysInMonth = lastOfMonth(this.currentMonth).getDate();

    const rowLayout = this.computeRowLayout(sorted);
    const totalRowsHeight = rowLayout[rowLayout.length - 1].y + ROW_HEIGHT;
    const chartWidth = daysInMonth * DAY_WIDTH;
    const chartTotalHeight = HEADER_HEIGHT + totalRowsHeight;

    // 좌: 라벨 컬럼 (가로 스크롤 영향 없음)
    const labelsCol = wrap.createDiv({ cls: "dnm-labels-col" });
    labelsCol.style.width = `${LABEL_WIDTH}px`;
    const labelsHeader = labelsCol.createDiv({ cls: "dnm-labels-header" });
    labelsHeader.style.height = `${HEADER_HEIGHT}px`;
    const labelsBody = labelsCol.createDiv({ cls: "dnm-labels-body" });

    // 우: 차트 (가로 스크롤)
    const chartCol = wrap.createDiv({ cls: "dnm-chart-col" });
    const svg = svgEl("svg");
    svg.setAttribute("width", String(chartWidth));
    svg.setAttribute("height", String(chartTotalHeight));
    svg.classList.add("dnm-svg");
    chartCol.appendChild(svg);

    this.drawWeekendBackgrounds(svg, first, daysInMonth, chartTotalHeight);
    this.drawDayHeaders(svg, first, daysInMonth);
    this.drawTodayLine(svg, first, daysInMonth, chartTotalHeight);

    sorted.forEach((item, idx) => {
      const y = HEADER_HEIGHT + rowLayout[idx].y;

      // 라벨
      const labelDiv = labelsBody.createDiv({ cls: "dnm-row-label" });
      labelDiv.style.height = `${ROW_HEIGHT}px`;
      if (rowLayout[idx].extraTop > 0) {
        labelDiv.style.marginTop = `${rowLayout[idx].extraTop}px`;
      }
      labelDiv.setAttr("title", item.name);
      labelDiv.setText(this.truncate(item.name, 24));

      // 차트 row 그룹 (bg + bar)
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
        const bar = svgEl("rect");
        bar.classList.add("dnm-bar");
        bar.setAttribute("x", String(x));
        bar.setAttribute("y", String(barY));
        bar.setAttribute("width", String(w));
        bar.setAttribute("height", String(BAR_HEIGHT));
        bar.setAttribute("rx", "3");
        bar.setAttribute("fill", this.colorFor(item.status));
        const barTitle = svgEl("title");
        barTitle.textContent = `${item.name}\n${item.section} · ${this.rangeText(item)}`;
        bar.appendChild(barTitle);
        bar.addEventListener("click", () => this.openDailyNoteFor(item));
        rowGroup.appendChild(bar);

        // 소요일 텍스트. 막대가 너무 좁으면 생략.
        const duration = this.durationText(item);
        if (duration && w >= 28) {
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

      // hover 동기화 (label ↔ svg row)
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
      dayLabel.textContent = "일월화수목금토"[day.getDay()];
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
    label.textContent = "오늘";
    svg.appendChild(label);
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

  private truncate(s: string, max: number): string {
    if (s.length <= max) return s;
    return s.slice(0, max - 1) + "…";
  }

  private rangeText(item: TimelineItem): string {
    if (item.start.getTime() === item.end.getTime()) return `${toIsoDate(item.start)} (당일)`;
    return `${toIsoDate(item.start)} ~ ${toIsoDate(item.end)}`;
  }

  private durationText(item: TimelineItem): string {
    const n = businessDaysBetween(item.start, item.end);
    if (n === 0) return "당일";
    if (item.status === "active") return `${n}일째`;
    return `${n}일`;
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
