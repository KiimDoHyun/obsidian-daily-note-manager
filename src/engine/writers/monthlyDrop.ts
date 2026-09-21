import { mmddOf } from "../dateutil";
import { monthlyDropPath } from "../paths";
import type { DailyNoteSettings } from "../../settings";
import type { TaskBlock } from "../types";
import type { VaultLike } from "../vault";

export async function ensureDrop(
  month: Date,
  vault: VaultLike,
  settings: DailyNoteSettings,
): Promise<string> {
  const path = monthlyDropPath(month, settings);
  if (vault.exists(path)) return path;
  const ym = path.split("/").slice(-1)[0].replace(/\.md$/, "").split(" ")[0];
  const parts = [
    "---",
    `tags: [monthly-drop, ${ym}]`,
    "---",
    "",
    `# ${ym} 드롭된 업무`,
    "",
    "> 5일 초과 이월 또는 즉시 드롭(`[-]`) 처리된 항목.",
    "> 살리려면 항목 텍스트만 복사해서 오늘 데일리의 `할일` 섹션에 붙여넣기 (이월 태그 제거).",
    "",
  ];
  await vault.write(path, parts.join("\n"));
  return path;
}

export async function appendDropped(
  dropPath: string,
  eventDate: Date,
  block: TaskBlock,
  vault: VaultLike,
): Promise<void> {
  const raw = await vault.read(dropPath);
  const lines = raw.split(/\r?\n/);
  while (lines.length > 0 && lines[lines.length - 1].trim() === "") lines.pop();
  const hasPrior = lines.some((l) => l.startsWith("- [-] "));
  if (!hasPrior) lines.push("");
  lines.push(renderDropTop(block, eventDate));
  for (const child of block.children) lines.push(child);
  await vault.write(dropPath, lines.join("\n") + "\n");
}

function renderDropTop(block: TaskBlock, eventDate: Date): string {
  const md = mmddOf(eventDate);
  let suffix: string;
  if (block.isDroppedImmediate) {
    suffix = `(${md} 즉시 드롭)`;
  } else if (block.originDate === null) {
    suffix = `(${md} 드롭, ${block.carryoverDays}영업일 이월 후)`;
  } else {
    const origin = mmddOf(block.originDate);
    suffix = `(${origin} 시작, ${md} 드롭, ${block.carryoverDays}영업일 이월)`;
  }
  return `- [-] ${block.topText} ${suffix}`;
}
