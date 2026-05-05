<script lang="ts">
  import { onMount } from 'svelte';
  import { liveQuery } from 'dexie';
  import { db, seedDefaultCars } from '$lib/db';
  import { createSession, recordTap, undoLastTap, elapsedSince, formatLapTime, resetCarTiming } from '$lib/timing';
  import { requestPersistence } from '$lib/storage';
  import { acquireWakeLock } from '$lib/wakelock';
  import type { Car, Lap, Session } from '$lib/types';

  const COLOR_PALETTE = [
    '#ef4444', '#f97316', '#eab308', '#22c55e',
    '#06b6d4', '#3b82f6', '#a855f7', '#ec4899', '#ffffff'
  ];

  // ── State ──────────────────────────────────────────────────────────────
  let session = $state<Session | null>(null);
  let cars = $state<Car[]>([]);
  let laps = $state<Lap[]>([]);
  let tick = $state(0);
  let rejectedCars = $state(new Set<string>());
  let lapFlash = $state(new Map<string, { text: string; until: number }>());
  let newCarNumber = $state('');
  let confirmEnd = $state(false);
  let confirmEndTimer: ReturnType<typeof setTimeout> | null = null;

  // ── Derived ────────────────────────────────────────────────────────────
  let pinnedCars = $derived(cars.filter((c) => c.isPinned));
  let unpinnedCars = $derived(cars.filter((c) => !c.isPinned));
  let undoAvailable = $derived(
    tick >= 0 && laps.some((l) => !l.isInvalidated && performance.now() - l.perfTimestamp < 10_000)
  );

  // liveQuery returns laps in UUID primary-key order (random), so we must
  // scan for the highest perfTimestamp rather than relying on array position.
  function latestValidLap(carId: string): Lap | undefined {
    let best: Lap | undefined;
    for (const l of laps) {
      if (l.carId !== carId || l.isInvalidated) continue;
      if (!best || l.perfTimestamp > best.perfTimestamp) best = l;
    }
    return best;
  }

  // Pick the next unused palette colour for auto-assignment
  function nextAutoColor(): string {
    const used = new Set(cars.map((c) => c.color));
    return COLOR_PALETTE.find((c) => !used.has(c)) ?? COLOR_PALETTE[cars.length % COLOR_PALETTE.length];
  }

  // ── Init ───────────────────────────────────────────────────────────────
  onMount(() => {
    (async () => {
      await requestPersistence();
      await acquireWakeLock();
      cars = await seedDefaultCars();

      const savedId = localStorage.getItem('activeSessionId');
      if (savedId) {
        const s = await db.sessions.get(savedId);
        if (s) session = s;
      }
    })();

    let rafId: number;
    function frame() {
      tick = performance.now();
      rafId = requestAnimationFrame(frame);
    }
    rafId = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(rafId);
  });

  $effect(() => {
    if (!session) { laps = []; return; }
    const sid = session.id;
    const sub = liveQuery(() =>
      db.laps.where('sessionId').equals(sid).reverse().toArray()
    ).subscribe({ next: (r) => { laps = r; }, error: () => {} });
    return () => sub.unsubscribe();
  });

  // ── Actions ────────────────────────────────────────────────────────────
  async function startSession() {
    const s = createSession('Practice', 'MTCS');
    await db.sessions.add(s);
    localStorage.setItem('activeSessionId', s.id);
    session = s;
  }

  function handleEnd() {
    if (!confirmEnd) {
      confirmEnd = true;
      confirmEndTimer = setTimeout(() => { confirmEnd = false; }, 3000);
    } else {
      if (confirmEndTimer) clearTimeout(confirmEndTimer);
      confirmEnd = false;
      localStorage.removeItem('activeSessionId');
      session = null;
    }
  }

  async function tapCar(car: Car, e: Event) {
    if (e instanceof TouchEvent) e.preventDefault();
    if (!session) return;
    const lap = await recordTap(session.id, car.id);
    if (lap === null) {
      rejectedCars = new Set([...rejectedCars, car.id]);
      setTimeout(() => {
        const next = new Set(rejectedCars);
        next.delete(car.id);
        rejectedCars = next;
      }, 400);
    } else {
      const text = lap.isOutLap ? 'OUT' : formatLapTime(lap.deltaMs);
      const next = new Map(lapFlash);
      next.set(car.id, { text, until: performance.now() + 1500 });
      lapFlash = next;
    }
  }

  async function undo() {
    if (!undoAvailable) return;
    await undoLastTap();
  }

  async function resetCar(carId: string) {
    if (!session) return;
    await resetCarTiming(session.id, carId);
    // Clear any frozen flash so the display immediately returns to — — —
    const next = new Map(lapFlash);
    next.delete(carId);
    lapFlash = next;
  }

  async function addCar() {
    const num = newCarNumber.trim();
    if (!num) return;
    const car: Car = {
      id: crypto.randomUUID(),
      number: num,
      driverName: '',
      color: nextAutoColor(),
      isPinned: false
    };
    await db.cars.add(car);
    cars = [...cars, car];
    newCarNumber = '';
  }
</script>

<svelte:head>
  <title>Trackside Timing</title>
  <meta
    name="viewport"
    content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover"
  />
</svelte:head>

<!-- ── Start screen ─────────────────────────────────────────────────────── -->
{#if !session}
  <main class="h-dvh flex flex-col items-center justify-center gap-10" style="background: #000;">
    <div class="flex flex-col items-center gap-2">
      <h1 class="text-3xl font-black tracking-widest" style="color: #22c55e;">TRACKSIDE</h1>
      <p class="text-sm tracking-[0.3em] uppercase" style="color: #6b7280;">MTCS Roadsport</p>
    </div>
    <button
      onclick={startSession}
      class="w-72 py-7 rounded-2xl font-black text-2xl tracking-wide active:scale-95 transition-transform"
      style="background: #22c55e; color: #000; touch-action: manipulation;"
    >
      START SESSION
    </button>
  </main>

<!-- ── Timing interface ──────────────────────────────────────────────────── -->
{:else}
  <div class="h-dvh flex flex-col" style="background: #000;">

    <!-- Header -->
    <header
      class="flex items-center justify-between px-3 py-2 shrink-0"
      style="border-bottom: 1px solid #1f1f1f;"
    >
      <span class="text-xs font-mono uppercase tracking-widest" style="color: #6b7280;">
        MTCS · {new Date(session.startedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
      </span>
      <div class="flex gap-2">
        <button
          onclick={undo}
          disabled={!undoAvailable}
          class="px-4 py-2 rounded-lg font-black text-sm tracking-wide"
          style="background: {undoAvailable ? '#ef4444' : '#1f1f1f'}; color: {undoAvailable ? '#fff' : '#4b5563'}; touch-action: manipulation;"
        >
          UNDO ↩
        </button>
        <button
          onclick={handleEnd}
          class="px-3 py-2 rounded-lg font-bold text-sm"
          style="background: {confirmEnd ? '#f59e0b' : '#1f1f1f'}; color: {confirmEnd ? '#000' : '#6b7280'}; touch-action: manipulation;"
        >
          {confirmEnd ? 'CONFIRM?' : 'END'}
        </button>
      </div>
    </header>

    <!-- Pinned car grid — fixed height so buttons aren't overwhelming -->
    <section class="grid grid-cols-2 grid-rows-2 gap-1 p-1 shrink-0" style="height: 44vh;">
      {#each pinnedCars as car (car.id)}
        {@const lastLap = latestValidLap(car.id)}
        {@const rejected = rejectedCars.has(car.id)}
        {@const flash = lapFlash.get(car.id)}
        <!-- div wrapper so we can overlay the reset button without nesting buttons -->
        <div
          class="relative rounded-xl overflow-hidden"
          style="
            background: {rejected ? '#450a0a' : car.color};
            border: {rejected ? '3px solid #ef4444' : '3px solid transparent'};
          "
        >
          <!-- Main tap area -->
          <button
            ontouchstart={(e) => tapCar(car, e)}
            onclick={(e) => tapCar(car, e)}
            class="flex flex-col items-center justify-center w-full h-full font-black active:brightness-75 transition-[filter]"
            style="color: #000; touch-action: manipulation; -webkit-tap-highlight-color: transparent;"
          >
            <span class="text-5xl leading-none">#{car.number}</span>
            <span class="text-base mt-1 font-mono" style="color: rgba(0,0,0,0.75);">
              {#if flash && tick < flash.until}
                {flash.text}
              {:else if lastLap}
                {elapsedSince(lastLap.perfTimestamp, tick)}{lastLap.isOutLap ? ' OUT' : ''}
              {:else}
                — — —
              {/if}
            </span>
          </button>
          <!-- Reset button — top-right corner, distinct enough to avoid accidental taps -->
          <button
            onclick={() => resetCar(car.id)}
            class="absolute top-2 right-2 w-9 h-9 rounded-full flex items-center justify-center text-base font-bold"
            style="background: rgba(0,0,0,0.35); color: #fff; touch-action: manipulation; -webkit-tap-highlight-color: transparent;"
            aria-label="Reset #{car.number}"
          >↺</button>
        </div>
      {/each}
    </section>

    <!-- Bottom section: unpinned cars + inline add -->
    <section
      class="flex-1 flex flex-col gap-2 px-2 pt-2 pb-3 min-h-0"
      style="border-top: 1px solid #1f1f1f;"
    >
      <!-- Unpinned cars -->
      {#if unpinnedCars.length > 0}
        <div class="flex flex-wrap gap-2">
          {#each unpinnedCars as car (car.id)}
            {@const lastLap = latestValidLap(car.id)}
            {@const rejected = rejectedCars.has(car.id)}
            {@const flash = lapFlash.get(car.id)}
            <div
              class="relative rounded-xl overflow-hidden shrink-0 w-16 h-14"
              style="
                background: {rejected ? '#450a0a' : car.color};
                border: {rejected ? '2px solid #ef4444' : '2px solid transparent'};
              "
            >
              <button
                ontouchstart={(e) => tapCar(car, e)}
                onclick={(e) => tapCar(car, e)}
                class="flex flex-col items-center justify-center w-full h-full font-black text-sm active:brightness-75 transition-[filter]"
                style="color: #000; touch-action: manipulation; -webkit-tap-highlight-color: transparent;"
              >
                <span>#{car.number}</span>
                <span class="text-[10px] font-mono" style="color: rgba(0,0,0,0.6);">
                  {#if flash && tick < flash.until}
                    {flash.text}
                  {:else}
                    {lastLap ? elapsedSince(lastLap.perfTimestamp, tick) : '—'}
                  {/if}
                </span>
              </button>
              <button
                onclick={() => resetCar(car.id)}
                class="absolute top-0.5 right-0.5 w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold"
                style="background: rgba(0,0,0,0.4); color: #fff; touch-action: manipulation; -webkit-tap-highlight-color: transparent;"
                aria-label="Reset #{car.number}"
              >↺</button>
            </div>
          {/each}
        </div>
      {/if}

      <!-- Inline add-car row — always visible, no modal -->
      <div class="mt-auto flex gap-2 items-center">
        <span class="font-black text-lg shrink-0" style="color: #4b5563;">#</span>
        <input
          type="text"
          inputmode="numeric"
          pattern="[0-9]*"
          bind:value={newCarNumber}
          placeholder="car number"
          maxlength="3"
          onkeydown={(e) => { if (e.key === 'Enter') addCar(); }}
          class="flex-1 px-3 py-3 rounded-xl font-black text-xl text-center"
          style="background: #1f1f1f; color: #fff; border: 1px solid #374151; min-width: 0;"
        />
        <button
          onclick={addCar}
          disabled={!newCarNumber.trim()}
          class="shrink-0 px-5 py-3 rounded-xl font-black text-base"
          style="
            background: {newCarNumber.trim() ? '#22c55e' : '#1f1f1f'};
            color: {newCarNumber.trim() ? '#000' : '#4b5563'};
            touch-action: manipulation;
          "
        >
          ADD
        </button>
      </div>
    </section>

  </div>
{/if}
