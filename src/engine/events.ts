import { DROP_THRESHOLD_DAYS } from "./constants";
import type { DailyNoteParsed, Events, TaskBlock } from "./types";
import { emptyEvents } from "./types";

export function classifyEvents(parsed: DailyNoteParsed): Events {
  const events = emptyEvents();

  for (const block of parsed.activeBlocks) {
    dispatch(block, events, true, parsed.noteDate);
  }
  for (const block of parsed.carryoverBlocks) {
    dispatch(block, events, false, parsed.noteDate);
  }
  return events;
}

function dispatch(
  block: TaskBlock,
  events: Events,
  fromActive: boolean,
  sourceNoteDate: Date,
): void {
  if (block.isDroppedImmediate) {
    events.dropped.push(finalizeForEvent(block, fromActive, sourceNoteDate));
    return;
  }
  if (block.isCompleted) {
    events.completed.push(finalizeForEvent(block, fromActive, sourceNoteDate));
    return;
  }
  if (block.hasArchiveMarker) {
    events.archived.push(finalizeForEvent(block, fromActive, sourceNoteDate));
    return;
  }

  if (fromActive) {
    events.carryingOver.push(cloneForCarryover(block, 1, sourceNoteDate));
    return;
  }

  const newDays = block.carryoverDays + 1;
  if (newDays >= DROP_THRESHOLD_DAYS && !block.hasLongMarker) {
    events.dropped.push({ ...block, carryoverDays: newDays });
    return;
  }
  events.carryingOver.push(cloneForCarryover(block, newDays, block.originDate));
}

function finalizeForEvent(
  block: TaskBlock,
  fromActive: boolean,
  sourceNoteDate: Date,
): TaskBlock {
  if (fromActive) {
    return { ...block, carryoverDays: 0, originDate: sourceNoteDate };
  }
  return block;
}

function cloneForCarryover(block: TaskBlock, days: number, origin: Date | null): TaskBlock {
  return {
    ...block,
    carryoverDays: days,
    originDate: origin,
    isCompleted: false,
    isDroppedImmediate: false,
  };
}
