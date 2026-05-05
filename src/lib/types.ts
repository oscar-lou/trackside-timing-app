export interface Session {
  id: string;
  name: string;
  trackName: string;
  startedAt: number;       // Date.now() anchor — used only for CSV wall-clock reconstruction
  startedAtPerf: number;   // performance.now() at session start — all deltas computed from this
}

export interface Car {
  id: string;
  number: string;          // e.g. "18", "21", "71", "1"
  driverName: string;
  color: string;
  isPinned: boolean;
}

export interface Lap {
  id: string;
  sessionId: string;
  carId: string;
  lapNumber: number;
  perfTimestamp: number;   // performance.now() at tap — never Date.now()
  deltaMs: number;         // ms since previous valid tap on same car (0 for out lap)
  isOutLap: boolean;
  isInvalidated: boolean;  // soft-delete: true means undone, never physically removed
}
