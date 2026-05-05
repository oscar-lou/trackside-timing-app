import { db } from '$lib/db';
import type { Lap, Session } from '$lib/types';

// 30s minimum — real MTCS laps are 90s+, so anything shorter is a double-tap
const MIN_LAP_MS = 30_000;
// Undo window: 10 seconds from tap to undo button press
const UNDO_WINDOW_MS = 10_000;

export function createSession(name: string, trackName: string): Session {
  return {
    id: crypto.randomUUID(),
    name,
    trackName,
    startedAt: Date.now(),           // wall-clock anchor for CSV only
    startedAtPerf: performance.now() // monotonic reference for all delta math
  };
}

/**
 * Record a tap for a car. Returns the new Lap, or null if rejected (double-tap within 30s).
 * All timing uses performance.now() — never Date.now().
 */
export async function recordTap(sessionId: string, carId: string): Promise<Lap | null> {
  const now = performance.now();

  // Fetch all laps for this car in this session, sort descending by tap time
  const carLaps = await db.laps.where('[sessionId+carId]').equals([sessionId, carId]).toArray();
  const validLaps = carLaps.filter((l) => !l.isInvalidated);
  validLaps.sort((a, b) => b.perfTimestamp - a.perfTimestamp);
  const lastLap = validLaps[0] ?? null;

  // Reject obvious double-taps (not applied to the very first tap / out lap)
  if (lastLap && now - lastLap.perfTimestamp < MIN_LAP_MS) {
    return null;
  }

  const isOutLap = lastLap === null;
  const lap: Lap = {
    id: crypto.randomUUID(),
    sessionId,
    carId,
    lapNumber: isOutLap ? 1 : lastLap.lapNumber + 1,
    perfTimestamp: now,
    deltaMs: isOutLap ? 0 : now - lastLap.perfTimestamp,
    isOutLap,
    isInvalidated: false
  };

  await db.laps.add(lap);
  return lap;
}

/**
 * Undo the most recent valid tap across all cars within the 10-second window.
 * Sets isInvalidated = true — the record is never removed.
 */
export async function undoLastTap(): Promise<Lap | null> {
  const now = performance.now();
  const minPerf = now - UNDO_WINDOW_MS;

  const recentLaps = await db.laps
    .where('perfTimestamp')
    .above(minPerf)
    .filter((l) => !l.isInvalidated)
    .toArray();

  if (recentLaps.length === 0) return null;

  recentLaps.sort((a, b) => b.perfTimestamp - a.perfTimestamp);
  const target = recentLaps[0];

  await db.laps.update(target.id, { isInvalidated: true });
  return { ...target, isInvalidated: true };
}

/** Format a deltaMs value as mm:ss.SSS for CSV export and display */
export function formatLapTime(deltaMs: number): string {
  if (deltaMs === 0) return 'out lap';
  const ms = deltaMs % 1000;
  const totalSec = Math.floor(deltaMs / 1000);
  const sec = totalSec % 60;
  const min = Math.floor(totalSec / 60);
  return `${min}:${String(sec).padStart(2, '0')}.${String(ms).padStart(3, '0')}`;
}

/** Elapsed seconds since a perfTimestamp, as a live counter string (mm:ss) */
export function elapsedSince(perfTimestamp: number): string {
  const ms = performance.now() - perfTimestamp;
  const totalSec = Math.floor(ms / 1000);
  const sec = totalSec % 60;
  const min = Math.floor(totalSec / 60);
  return `${min}:${String(sec).padStart(2, '0')}`;
}
