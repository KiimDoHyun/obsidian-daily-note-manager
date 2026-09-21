import { mmddOf, ymOf } from "../dateutil";
import { archivePath } from "../paths";
import type { DailyNoteSettings } from "../../settings";
import type { TaskBlock } from "../types";
import type { VaultAdapter } from "../vault";

export async function ensureArchive(
  vault: VaultAdapter,
  settings: DailyNoteSettings,
): Promise<string> {
  const path = archivePath(settings);
  if (vault.exists(path)) return path;
  const parts = [
    "---",
    "tags: [archive]",
    "---",
    "",
    "# 보관함",
    "",
    "> 지금은 아니지만 나중에 참고할 할일들.",
    "> 살리려면 항목 텍스트만 복사해서 오늘 데일리의 `할일` 섹션에 붙여넣기.",
    "",
  ];
  await vault.write(path, parts.join("\n"));
  return path;
}

export async function appendArchived(
  archivePath_: string,
  eventDate: Date,
  block: TaskBlock,
  vault: VaultAdapter,
): Promise<void> {
  const ym = ymOf(eventDate);
  const groupHeader = `## ${ym}`;
  const raw = await vault.read(archivePath_);
  const lines = raw.split(/\r?\n/);

  const groupEndIdx = findGroupEnd(lines, groupHeader);
  const md = mmddOf(eventDate);
  const entry = [`- [ ] ${block.topText} (보관: ${md})`, ...block.children];

  if (groupEndIdx === null) {
    while (lines.length > 0 && lines[lines.length - 1].trim() === "") lines.pop();
    lines.push("", groupHeader, ...entry);
  } else {
    for (let i = 0; i < entry.length; i++) {
      lines.splice(groupEndIdx + i, 0, entry[i]);
    }
    const nextAfter = groupEndIdx + entry.length;
    if (nextAfter < lines.length && lines[nextAfter].startsWith("## ")) {
      lines.splice(nextAfter, 0, "");
    }
  }
  await vault.write(archivePath_, lines.join("\n") + "\n");
}

function findGroupEnd(lines: string[], groupHeader: string): number | null {
  let inGroup = false;
  let lastContentIdx: number | null = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line === groupHeader) {
      inGroup = true;
      lastContentIdx = i;
      continue;
    }
    if (inGroup && line.startsWith("## ")) {
      return (lastContentIdx ?? 0) + 1;
    }
    if (inGroup && line.trim() !== "") {
      lastContentIdx = i;
    }
  }
  if (inGroup) return (lastContentIdx ?? 0) + 1;
  return null;
}
