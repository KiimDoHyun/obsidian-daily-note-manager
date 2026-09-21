import { ItemView, WorkspaceLeaf } from "obsidian";
import type DailyNoteManagerPlugin from "../main";
import {
  addDays,
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
const COLOR_WEEKEND = "var(--background-modifier-hover)";
const COLOR_GRID = "var(--background-modifier-border)";
const COLOR_TEXT = "var(--text-normal)";
const COLOR_MUTED = "var(--text-muted)";

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
    this.renderToolbar();
    this.renderLegend();
    this.renderChart(items);
  }

  private renderToolbar(): void {
    const bar = this.contentEl.createDiv({ cls: "dnm-toolbar" });
    bar.style.display = "flex";
    bar.style.alignItems = "center";
    bar.style.gap = "8px";
    bar.style.padding = "8px 12px";
    bar.style.borderBottom = `1px solid ${COLOR_GRID}`;

    const prev = bar.createEl("button", { text: "◀" });
    prev.onclick = async () => {
      this.currentMonth = firstOfMonth(addDays(this.currentMonth, -1));
      await this.rerender();
    };

    const label = bar.createEl("span", { text: ymOf(this.currentMonth) });
    label.style.fontWeight = "600";
    label.style.minWidth = "80px";
    label.style.textAlign = "center";

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

    const spacer = bar.createDiv();
    spacer.style.flex = "1";

    const refresh = bar.createEl("button", { text: "↻ 새로고침" });
    refresh.onclick = () => this.rerender();
  }

  private renderLegend(): void {
    const legend = this.contentEl.createDiv({ cls: "dnm-legend" });
    legend.style.display = "flex";
    legend.style.gap = "16px";
    legend.style.padding = "6px 12px";
    legend.style.fontSize = "12px";
    legend.style.color = COLOR_MUTED;

    const item = (color: string, label: string) => {
      const wrap = legend.createDiv();
      wrap.style.display = "flex";
      wrap.style.alignItems = "center";
      wrap.style.gap = "6px";
      const swatch = wrap.createDiv();
      swatch.style.width = "12px";
      swatch.style.height = "12px";
      swatch.style.borderRadius = "2px";
      swatch.style.background = color;
      wrap.createSpan({ text: label });
    };
    item(COLOR_ACTIVE, "진행중");
    item(COLOR_DONE, "완료");
    item(COLOR_DROPPED, "드롭");
    const hint = legend.createSpan({ text: "· 막대 클릭 시 시작일 데일리 노트로 이동" });
    hint.style.marginLeft = "auto";
  }

  private renderChart(items: TimelineItem[]): void {
    const wrap = this.contentEl.createDiv({ cls: "dnm-chart-wrap" });
    wrap.style.overflow = "auto";
    wrap.style.padding = "12px";

    if (items.length === 0) {
      wrap.createEl("p", { text: "이번 달 이벤트가 없습니다." });
      return;
    }

    const sorted = this.sortItems(items);
    const first = firstOfMonth(this.currentMonth);
    const last = lastOfMonth(this.currentMonth);
    const daysInMonth = last.getDate();

    const width = LABEL_WIDTH + daysInMonth * DAY_WIDTH + 20;
    const height = HEADER_HEIGHT + sorted.length * ROW_HEIGHT + SECTION_GAP * 3 + 20;

    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("width", String(width));
    svg.setAttribute("height", String(height));
    svg.style.fontFamily = "var(--font-interface)";
    svg.style.fontSize = "12px";
    wrap.appendChild(svg);

    this.drawWeekendBackgrounds(svg, first, daysInMonth, height);
    this.drawDayHeaders(svg, first, daysInMonth);
    this.drawTodayLine(svg, first, daysInMonth, height);
    this.drawBars(svg, sorted, first, daysInMonth);
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
      rect.setAttribute("x", String(LABEL_WIDTH + (d - 1) * DAY_WIDTH));
      rect.setAttribute("y", String(HEADER_HEIGHT));
      rect.setAttribute("width", String(DAY_WIDTH));
      rect.setAttribute("height", String(height - HEADER_HEIGHT));
      rect.setAttribute("fill", COLOR_WEEKEND);
      svg.appendChild(rect);
    }
  }

  private drawDayHeaders(svg: SVGSVGElement, first: Date, daysInMonth: number): void {
    for (let d = 1; d <= daysInMonth; d++) {
      const day = new Date(first.getFullYear(), first.getMonth(), d);
      const x = LABEL_WIDTH + (d - 1) * DAY_WIDTH + DAY_WIDTH / 2;

      const dayLabel = svgEl("text");
      dayLabel.setAttribute("x", String(x));
      dayLabel.setAttribute("y", "16");
      dayLabel.setAttribute("text-anchor", "middle");
      dayLabel.setAttribute("fill", COLOR_MUTED);
      dayLabel.setAttribute("font-size", "10");
      dayLabel.textContent = "일월화수목금토"[day.getDay()];
      svg.appendChild(dayLabel);

      const dateLabel = svgEl("text");
      dateLabel.setAttribute("x", String(x));
      dateLabel.setAttribute("y", "32");
      dateLabel.setAttribute("text-anchor", "middle");
      dateLabel.setAttribute("fill", COLOR_TEXT);
      dateLabel.textContent = String(d);
      svg.appendChild(dateLabel);
    }
  }

  private drawTodayLine(
    svg: SVGSVGElement,
    first: Date,
    daysInMonth: number,
    height: number,
  ): void {
    const today = todayDate();
    if (
      today.getFullYear() !== first.getFullYear() ||
      today.getMonth() !== first.getMonth()
    ) {
      return;
    }
    const x = LABEL_WIDTH + (today.getDate() - 0.5) * DAY_WIDTH;
    const line = svgEl("line");
    line.setAttribute("x1", String(x));
    line.setAttribute("y1", "0");
    line.setAttribute("x2", String(x));
    line.setAttribute("y2", String(height));
    line.setAttribute("stroke", COLOR_TODAY);
    line.setAttribute("stroke-width", "2");
    line.setAttribute("stroke-dasharray", "4 3");
    svg.appendChild(line);

    const label = svgEl("text");
    label.setAttribute("x", String(x + 4));
    label.setAttribute("y", "12");
    label.setAttribute("fill", COLOR_TODAY);
    label.setAttribute("font-size", "10");
    label.textContent = "오늘";
    svg.appendChild(label);
  }

  private drawBars(
    svg: SVGSVGElement,
    items: TimelineItem[],
    first: Date,
    daysInMonth: number,
  ): void {
    let lastSection: TimelineItem["section"] | null = null;
    let extraY = 0;
    items.forEach((item, idx) => {
      if (lastSection !== null && lastSection !== item.section) extraY += SECTION_GAP;
      lastSection = item.section;
      const y = HEADER_HEIGHT + idx * ROW_HEIGHT + extraY;

      const label = svgEl("text");
      label.setAttribute("x", String(LABEL_WIDTH - 8));
      label.setAttribute("y", String(y + ROW_HEIGHT / 2 + 4));
      label.setAttribute("text-anchor", "end");
      label.setAttribute("fill", COLOR_TEXT);
      const displayName = this.truncate(item.name, 24);
      label.textContent = displayName;
      const fullTitle = svgEl("title");
      fullTitle.textContent = item.name;
      label.appendChild(fullTitle);
      svg.appendChild(label);

      const range = this.clipRangeToMonth(item, first, daysInMonth);
      if (range === null) return;
      const { startDay, endDay } = range;

      const x = LABEL_WIDTH + (startDay - 1) * DAY_WIDTH + 2;
      const w = Math.max((endDay - startDay + 1) * DAY_WIDTH - 4, 4);
      const barY = y + (ROW_HEIGHT - BAR_HEIGHT) / 2;
      const bar = svgEl("rect");
      bar.setAttribute("x", String(x));
      bar.setAttribute("y", String(barY));
      bar.setAttribute("width", String(w));
      bar.setAttribute("height", String(BAR_HEIGHT));
      bar.setAttribute("rx", "3");
      bar.setAttribute("fill", this.colorFor(item.status));
      bar.style.cursor = "pointer";
      bar.style.opacity = "0.9";
      const barTitle = svgEl("title");
      barTitle.textContent = `${item.name}\n${item.section} · ${this.rangeText(item)}`;
      bar.appendChild(barTitle);
      bar.onclick = () => this.openDailyNoteFor(item);
      svg.appendChild(bar);

      if (item.status === "done") {
        const check = svgEl("text");
        check.setAttribute("x", String(x + w - 4));
        check.setAttribute("y", String(barY + BAR_HEIGHT / 2 + 4));
        check.setAttribute("text-anchor", "end");
        check.setAttribute("fill", "white");
        check.setAttribute("font-size", "11");
        check.textContent = "✓";
        check.style.pointerEvents = "none";
        svg.appendChild(check);
      }
    });
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

  private async openDailyNoteFor(item: TimelineItem): Promise<void> {
    const target = item.start;
    const path = dailyNotePath(target, this.plugin.settings);
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!file) {
      // 해당 날짜 노트가 아직 없으면 종합 문서로 폴백
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
