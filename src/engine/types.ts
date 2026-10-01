export interface TaskBlock {
  topText: string;
  children: string[];
  isCompleted: boolean;
  isDroppedImmediate: boolean;
  hasArchiveMarker: boolean;
  hasLongMarker: boolean;
  carryoverDays: number;
  originDate: Date | null;
}

export interface DailyNoteParsed {
  noteDate: Date;
  activeBlocks: TaskBlock[];
  carryoverBlocks: TaskBlock[];
  memoLines: string[];
}

export interface Events {
  completed: TaskBlock[];
  dropped: TaskBlock[];
  archived: TaskBlock[];
  carryingOver: TaskBlock[];
}

export function emptyEvents(): Events {
  return { completed: [], dropped: [], archived: [], carryingOver: [] };
}

export function emptyParsed(noteDate: Date): DailyNoteParsed {
  return { noteDate, activeBlocks: [], carryoverBlocks: [], memoLines: [] };
}

export function makeBlock(overrides: Partial<TaskBlock> & { topText: string }): TaskBlock {
  return {
    children: [],
    isCompleted: false,
    isDroppedImmediate: false,
    hasArchiveMarker: false,
    hasLongMarker: false,
    carryoverDays: 0,
    originDate: null,
    ...overrides,
  };
}

export type EventType = "completed" | "dropped" | "archived";

/**
 * 발생 날짜가 붙은 이벤트. 날짜가 곧 기록될 달 문서를 정한다.
 * 날짜는 그 항목이 마지막으로 노트에 있었던 날이다(드롭이면 드롭되기 직전 날).
 */
export interface DatedEvent {
  eventType: EventType;
  date: Date;
  block: TaskBlock;
}
