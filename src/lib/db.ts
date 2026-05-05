import Dexie, { type Table } from 'dexie';
import type { Car, Lap, Session } from '$lib/types';

export class TracksideDB extends Dexie {
  sessions!: Table<Session, string>;
  cars!: Table<Car, string>;
  laps!: Table<Lap, string>;

  constructor() {
    super('tracksideTiming');
    this.version(1).stores({
      sessions: 'id, startedAt',
      cars: 'id, number, isPinned',
      // [sessionId+carId] compound index for per-car lap queries
      // perfTimestamp index for undo window range queries
      laps: 'id, sessionId, carId, [sessionId+carId], perfTimestamp'
    });
  }
}

export const db = new TracksideDB();

// Hardcoded pinned threats for Thursday practice.
// Colors chosen for outdoor visibility at different angles.
export const DEFAULT_CARS: Omit<Car, 'id'>[] = [
  { number: '18', driverName: '', color: '#ef4444', isPinned: true },
  { number: '21', driverName: '', color: '#3b82f6', isPinned: true },
  { number: '71', driverName: '', color: '#f59e0b', isPinned: true },
  { number: '1', driverName: '', color: '#22c55e', isPinned: true }
];

export async function seedDefaultCars(): Promise<Car[]> {
  const existing = await db.cars.count();
  if (existing > 0) return db.cars.toArray();

  const cars: Car[] = DEFAULT_CARS.map((c) => ({
    ...c,
    id: crypto.randomUUID()
  }));
  await db.cars.bulkAdd(cars);
  return cars;
}
