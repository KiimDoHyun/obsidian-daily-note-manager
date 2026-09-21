import { DROP_THRESHOLD_DAYS } from "./constants";
import type { DailyNoteParsed, Events, TaskBlock } from "./types";
import { emptyEvents } from "./types";

/**
 * 이월 카운터 증가 후 드롭 여부를 결정.
 * @param dropThreshold 이 값 이상이면 드롭 (기본 5, 설정 UI 의 '드롭 임계' 와 연결)
 */
export function classifyEvents(
  parsed: DailyNoteParsed,
  dropThreshold: number = DROP_THRESHOLD_DAYS,
): Events {
  const events = emptyEvents();

  for (const block of parsed.activeBlocks) {
    dispatch(block, events, true, parsed.noteDate, dropThreshold);
  }
  for (const block of parsed.carryoverBlocks) {
    dispatch(block, events, false, parsed.noteDate, dropThreshold);
  }
  return events;
}

function dispatch(
  block: TaskBlock,
  events: Events,
  fromActive: boolean,
  sourceNoteDate: Date,
  dropThreshold: number,
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
  if (newDays >= dropThreshold && !block.hasLongMarker) {
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
