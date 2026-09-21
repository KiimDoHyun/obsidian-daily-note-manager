import type { DailyNoteSettings } from "../settings";
import { toIsoDate, weekOfMonth, ymOf } from "./dateutil";

export function dailyNoteDir(d: Date, settings: DailyNoteSettings): string {
  const ym = ymOf(d);
  const wk = weekOfMonth(d);
  return `${settings.notesSubdir}/${ym}/${wk}주차`;
}

export function dailyNotePath(d: Date, settings: DailyNoteSettings): string {
  return `${dailyNoteDir(d, settings)}/📅 ${toIsoDate(d)}.md`;
}

export function monthlySummaryPath(d: Date, settings: DailyNoteSettings): string {
  const ym = ymOf(d);
  return `${settings.notesSubdir}/${ym}/${ym} ${settings.monthlySummarySuffix}.md`;
}

export function monthlyDropPath(d: Date, settings: DailyNoteSettings): string {
  const ym = ymOf(d);
  return `${settings.notesSubdir}/${ym}/${ym} ${settings.monthlyDropSuffix}.md`;
}

export function archivePath(settings: DailyNoteSettings): string {
  return `${settings.notesSubdir}/${settings.archiveFileName}`;
}

export function monthlySummaryWikilink(d: Date, settings: DailyNoteSettings): string {
  const ym = ymOf(d);
  return `[[${ym} ${settings.monthlySummarySuffix}]]`;
}

export function monthlyDropWikilink(d: Date, settings: DailyNoteSettings): string {
  const ym = ymOf(d);
  return `[[${ym} ${settings.monthlyDropSuffix}]]`;
}
