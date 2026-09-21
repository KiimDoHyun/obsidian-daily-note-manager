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
