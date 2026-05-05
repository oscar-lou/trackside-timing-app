import { db } from '$lib/db';
import { formatLapTime } from '$lib/timing';
import type { Session } from '$lib/types';

/**
 * Reconstruct a wall-clock ISO timestamp for a lap using the session's
 * Date.now() anchor + the monotonic perf delta. Never uses Date.now() mid-session.
 */
function lapWallClock(session: Session, perfTimestamp: number): string {
  const wallMs = session.startedAt + (perfTimestamp - session.startedAtPerf);
  return new Date(wallMs).toISOString().replace('T', ' ').slice(0, 23); // "2024-11-21 10:31:05.456"
}

/**
 * lapTime for CSV — always mm:ss.SSS so spreadsheet parsers don't choke.
 * Out lap has deltaMs=0 so we emit 0:00.000 rather than the display label "out lap".
 */
function csvLapTime(deltaMs: number): string {
  if (deltaMs === 0) return '0:00.000';
  return formatLapTime(deltaMs);
}

function quote(s: string): string {
  // RFC 4180 quoting — wrap in double-quotes and escape any internal double-quotes
  return `"${s.replace(/"/g, '""')}"`;
}

export async function exportSessionCsv(session: Session): Promise<void> {
  // All laps for the session in chronological tap order (valid + invalidated)
  const allLaps = await db.laps.where('sessionId').equals(session.id).toArray();
  allLaps.sort((a, b) => a.perfTimestamp - b.perfTimestamp);

  const cars = await db.cars.toArray();
  const carMap = new Map(cars.map((c) => [c.id, c]));

  const header = [
    'lapNumber',
    'carNumber',
    'driverName',
    'lapTime',
    'deltaMs',
    'wallClockTime',
    'isOutLap',
    'isInvalidated'
  ].join(',');

  const rows = allLaps.map((lap) => {
    const car = carMap.get(lap.carId);
    return [
      lap.lapNumber,
      car?.number ?? '',
      quote(car?.driverName ?? ''),
      csvLapTime(lap.deltaMs),
      lap.deltaMs,
      lapWallClock(session, lap.perfTimestamp),
      lap.isOutLap,
      lap.isInvalidated
    ].join(',');
  });

  const csv = [header, ...rows].join('\n');

  const isoDate = new Date(session.startedAt).toISOString().slice(0, 10); // YYYY-MM-DD
  const filename = `trackside-${session.trackName}-${isoDate}.csv`;

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}
