<script lang="ts">
  import { onMount } from 'svelte';
  import { db, seedDefaultCars } from '$lib/db';
  import { createSession, recordTap, undoLastTap, formatLapTime, elapsedSince } from '$lib/timing';
  import { requestPersistence, isPersisted } from '$lib/storage';
  import { acquireWakeLock, isWakeLockActive } from '$lib/wakelock';
  import type { Car, Lap, Session } from '$lib/types';

  let session = $state<Session | null>(null);
  let cars = $state<Car[]>([]);
  let laps = $state<Lap[]>([]);
  let log = $state<string[]>([]);
  let persisted = $state(false);
  let wakeLock = $state(false);
  let tick = $state(0); // drives elapsed-time counter re-renders

  function addLog(msg: string) {
    log = [`[${new Date().toISOString().slice(11, 23)}] ${msg}`, ...log.slice(0, 49)];
  }

  onMount(() => {
    // Async init — fire and forget, cleanup handled by returned fn
    (async () => {
      await requestPersistence();
      persisted = await isPersisted();
      addLog(`Storage persisted: ${persisted}`);

      await acquireWakeLock();
      wakeLock = isWakeLockActive();
      addLog(`Wake lock active: ${wakeLock}`);

      cars = await seedDefaultCars();
      addLog(`Loaded ${cars.length} cars`);
    })();

    let rafId: number;
    function frame() {
      tick = performance.now();
      rafId = requestAnimationFrame(frame);
    }
    rafId = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(rafId);
  });

  async function startSession() {
    const s = createSession('Debug Session', 'MTCS');
    await db.sessions.add(s);
    session = s;
    laps = [];
    addLog(`Session started: ${s.id}`);
  }

  async function tap(car: Car) {
    if (!session) return;
    const lap = await recordTap(session.id, car.id);
    if (lap === null) {
      addLog(`#${car.number} — REJECTED (< 30s since last tap)`);
    } else {
      laps = [lap, ...laps];
      addLog(
        `#${car.number} — lap ${lap.lapNumber} — ${lap.isOutLap ? 'OUT LAP' : formatLapTime(lap.deltaMs)}`
      );
    }
  }

  async function undo() {
    const undone = await undoLastTap();
    if (undone) {
      laps = laps.map((l) => (l.id === undone.id ? undone : l));
      addLog(`UNDO — invalidated lap ${undone.lapNumber} for car ${undone.carId}`);
    } else {
      addLog('UNDO — nothing within 10-second window');
    }
  }

  async function forceFastTap(car: Car) {
    // Test the 30s rejection by tapping twice in quick succession
    if (!session) return;
    const first = await recordTap(session.id, car.id);
    addLog(`Fast tap 1: ${first ? `lap ${first.lapNumber}` : 'rejected'}`);
    const second = await recordTap(session.id, car.id);
    addLog(`Fast tap 2 (should reject): ${second ? `lap ${second.lapNumber}` : 'REJECTED ✓'}`);
    if (first) laps = [first, ...laps];
  }
</script>

<svelte:head>
  <title>Debug — Trackside Timing</title>
</svelte:head>

<main class="min-h-screen p-4 font-mono text-sm" style="background: #0a0a0a; color: #e5e7eb;">
  <h1 class="text-xl font-bold mb-4" style="color: #22c55e;">Step 2 Debug Harness</h1>

  <!-- Status bar -->
  <div class="flex gap-4 mb-4 text-xs">
    <span style="color: {persisted ? '#22c55e' : '#ef4444'}">
      storage: {persisted ? 'persisted' : 'not persisted'}
    </span>
    <span style="color: {wakeLock ? '#22c55e' : '#f59e0b'}">
      wake lock: {wakeLock ? 'active' : 'unavailable'}
    </span>
    {#if session}
      <span style="color: #3b82f6;">session: {session.name}</span>
    {/if}
  </div>

  <!-- Controls -->
  <div class="flex flex-wrap gap-2 mb-6">
    <button
      onclick={startSession}
      class="px-4 py-2 rounded font-bold"
      style="background: #22c55e; color: #000;"
    >
      Start Session
    </button>
    <button
      onclick={undo}
      class="px-4 py-2 rounded font-bold"
      style="background: #ef4444; color: #fff;"
    >
      UNDO (10s window)
    </button>
  </div>

  <!-- Car buttons -->
  {#if session}
    <div class="mb-6">
      <p class="text-xs mb-2" style="color: #6b7280;">Tap a car (30s min enforced):</p>
      <div class="flex flex-wrap gap-3">
        {#each cars as car (car.id)}
          {@const lastValidLap = laps.find((l) => l.carId === car.id && !l.isInvalidated)}
          <div class="flex flex-col items-center gap-1">
            <button
              ontouchstart={() => tap(car)}
              onclick={() => tap(car)}
              class="w-24 h-24 rounded-xl font-bold text-2xl"
              style="background: {car.color}; color: #000; touch-action: manipulation;"
            >
              #{car.number}
            </button>
            <span class="text-xs" style="color: #6b7280;">
              {#if lastValidLap}
                {elapsedSince(lastValidLap.perfTimestamp, tick)} ago
              {:else}
                no laps
              {/if}
            </span>
          </div>
        {/each}
      </div>
    </div>

    <!-- Double-tap rejection test -->
    <div class="mb-6">
      <p class="text-xs mb-2" style="color: #6b7280;">Test 30s rejection (taps car #18 twice instantly):</p>
      <button
        onclick={() => forceFastTap(cars[0])}
        class="px-4 py-2 rounded"
        style="background: #1f1f1f; color: #f59e0b; border: 1px solid #374151;"
      >
        Force Double-Tap #18
      </button>
    </div>
  {/if}

  <!-- Laps table -->
  {#if laps.length > 0}
    <div class="mb-6 overflow-auto">
      <p class="text-xs mb-2" style="color: #6b7280;">Laps (newest first):</p>
      <table class="text-xs w-full border-collapse">
        <thead>
          <tr style="color: #6b7280; border-bottom: 1px solid #374151;">
            <th class="text-left pr-4 pb-1">Car</th>
            <th class="text-left pr-4 pb-1">Lap#</th>
            <th class="text-left pr-4 pb-1">Time</th>
            <th class="text-left pr-4 pb-1">deltaMs</th>
            <th class="text-left pb-1">Status</th>
          </tr>
        </thead>
        <tbody>
          {#each laps as lap (lap.id)}
            {@const car = cars.find((c) => c.id === lap.carId)}
            <tr
              style="opacity: {lap.isInvalidated ? 0.35 : 1}; border-bottom: 1px solid #1f1f1f;"
            >
              <td class="pr-4 py-1" style="color: {car?.color ?? '#fff'}">#{car?.number}</td>
              <td class="pr-4 py-1">{lap.lapNumber}</td>
              <td class="pr-4 py-1">{formatLapTime(lap.deltaMs)}</td>
              <td class="pr-4 py-1">{lap.deltaMs}</td>
              <td class="py-1">
                {#if lap.isInvalidated}
                  <span style="color: #ef4444;">invalidated</span>
                {:else if lap.isOutLap}
                  <span style="color: #f59e0b;">out lap</span>
                {:else}
                  <span style="color: #22c55e;">valid</span>
                {/if}
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}

  <!-- Event log -->
  <div>
    <p class="text-xs mb-2" style="color: #6b7280;">Event log:</p>
    <div class="rounded p-3 overflow-auto max-h-64" style="background: #050505;">
      {#each log as entry}
        <div>{entry}</div>
      {/each}
    </div>
  </div>
</main>
