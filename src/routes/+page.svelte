<script lang="ts">
  import { onMount } from 'svelte';
  import { liveQuery } from 'dexie';
  import { db, seedDefaultCars } from '$lib/db';
  import { createSession, recordTap, undoLastTap, elapsedSince } from '$lib/timing';
  import { requestPersistence } from '$lib/storage';
  import { acquireWakeLock } from '$lib/wakelock';
  import type { Car, Lap, Session } from '$lib/types';

  const COLOR_PALETTE = [
    '#ef4444',
    '#f97316',
    '#eab308',
    '#22c55e',
    '#06b6d4',
    '#3b82f6',
    '#a855f7',
    '#ec4899',
    '#ffffff'
  ];

  // ── State ──────────────────────────────────────────────────────────────
  let session = $state<Session | null>(null);
  let cars = $state<Car[]>([]);
  let laps = $state<Lap[]>([]);
  let tick = $state(0); // increments every second; drives elapsed counters + undo window
  let rejectedCars = $state(new Set<string>()); // cars with a rejected (double-tap) flash
  let showAddCar = $state(false);
  let newCarNumber = $state('');
  let newCarColor = $state('#a855f7');
  let confirmEnd = $state(false);
  let confirmEndTimer: ReturnType<typeof setTimeout> | null = null;

  // ── Derived ────────────────────────────────────────────────────────────
  let pinnedCars = $derived(cars.filter((c) => c.isPinned));
  let unpinnedCars = $derived(cars.filter((c) => !c.isPinned));

  // tick >= 0 is always true; it's here solely to make this re-evaluate every second
  let undoAvailable = $derived(
    tick >= 0 && laps.some((l) => !l.isInvalidated && performance.now() - l.perfTimestamp < 10_000)
  );

  function latestValidLap(carId: string): Lap | undefined {
    return laps.find((l) => l.carId === carId && !l.isInvalidated);
  }

  // ── Init ───────────────────────────────────────────────────────────────
  onMount(() => {
    (async () => {
      await requestPersistence();
      await acquireWakeLock();
      cars = await seedDefaultCars();

      // Auto-resume most recent session if the phone restarted or tab was refreshed
      const savedId = localStorage.getItem('activeSessionId');
      if (savedId) {
        const s = await db.sessions.get(savedId);
        if (s) session = s;
      }
    })();

    const interval = setInterval(() => {
      tick = performance.now();
    }, 1000);
    return () => clearInterval(interval);
  });

  // Live laps from IndexedDB — updates automatically after recordTap / undoLastTap
  $effect(() => {
    if (!session) {
      laps = [];
      return;
    }
    const sid = session.id;
    const sub = liveQuery(() =>
      db.laps.where('sessionId').equals(sid).reverse().toArray()
    ).subscribe({
      next: (result) => {
        laps = result;
      },
      error: () => {}
    });
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
      confirmEndTimer = setTimeout(() => {
        confirmEnd = false;
      }, 3000);
    } else {
      if (confirmEndTimer) clearTimeout(confirmEndTimer);
      confirmEnd = false;
      localStorage.removeItem('activeSessionId');
      session = null;
    }
  }

  async function tapCar(car: Car, e: Event) {
    // preventDefault on touchstart suppresses the subsequent click on mobile,
    // so each physical tap records exactly once. onclick still fires on desktop.
    if (e instanceof TouchEvent) e.preventDefault();
    if (!session) return;

    const lap = await recordTap(session.id, car.id);
    if (lap === null) {
      // Brief visual rejection feedback (double-tap within 30s)
      rejectedCars = new Set([...rejectedCars, car.id]);
      setTimeout(() => {
        const next = new Set(rejectedCars);
        next.delete(car.id);
        rejectedCars = next;
      }, 400);
    }
  }

  async function undo() {
    if (!undoAvailable) return;
    await undoLastTap();
  }

  async function addCar() {
    const num = newCarNumber.trim();
    if (!num) return;
    const car: Car = {
      id: crypto.randomUUID(),
      number: num,
      driverName: '',
      color: newCarColor,
      isPinned: false
    };
    await db.cars.add(car);
    cars = [...cars, car];
    newCarNumber = '';
    showAddCar = false;
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
  <main
    class="h-dvh flex flex-col items-center justify-center gap-10"
    style="background: #000;"
  >
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
        <!-- Undo button — large, prominent, disabled after 10s window -->
        <button
          onclick={undo}
          disabled={!undoAvailable}
          class="px-4 py-2 rounded-lg font-black text-sm tracking-wide transition-opacity"
          style="background: {undoAvailable
            ? '#ef4444'
            : '#1f1f1f'}; color: {undoAvailable ? '#fff' : '#4b5563'}; touch-action: manipulation;"
        >
          UNDO ↩
        </button>

        <!-- End session — two-tap to confirm -->
        <button
          onclick={handleEnd}
          class="px-3 py-2 rounded-lg font-bold text-sm transition-colors"
          style="background: {confirmEnd
            ? '#f59e0b'
            : '#1f1f1f'}; color: {confirmEnd ? '#000' : '#6b7280'}; touch-action: manipulation;"
        >
          {confirmEnd ? 'CONFIRM?' : 'END'}
        </button>
      </div>
    </header>

    <!-- Pinned car grid — fills remaining height, massive touch targets -->
    <section class="flex-1 grid grid-cols-2 grid-rows-2 gap-1 p-1 min-h-0">
      {#each pinnedCars as car (car.id)}
        {@const lastLap = latestValidLap(car.id)}
        {@const rejected = rejectedCars.has(car.id)}
        <button
          ontouchstart={(e) => tapCar(car, e)}
          onclick={(e) => tapCar(car, e)}
          class="flex flex-col items-center justify-center w-full h-full rounded-xl font-black active:brightness-75 transition-[filter]"
          style="
            background: {rejected ? '#450a0a' : car.color};
            color: #000;
            border: {rejected ? '3px solid #ef4444' : '3px solid transparent'};
            touch-action: manipulation;
            -webkit-tap-highlight-color: transparent;
          "
        >
          <span class="text-6xl leading-none"># {car.number}</span>
          {#key tick}
            <span class="text-xl mt-2 font-mono" style="color: rgba(0,0,0,0.65);">
              {#if lastLap}
                {elapsedSince(lastLap.perfTimestamp)}
                {lastLap.isOutLap ? ' · OUT' : ''}
              {:else}
                — — —
              {/if}
            </span>
          {/key}
        </button>
      {/each}
    </section>

    <!-- Unpinned cars row + add button -->
    <section
      class="flex items-center gap-2 px-2 py-2 overflow-x-auto shrink-0"
      style="border-top: 1px solid #1f1f1f;"
    >
      {#each unpinnedCars as car (car.id)}
        {@const lastLap = latestValidLap(car.id)}
        {@const rejected = rejectedCars.has(car.id)}
        <button
          ontouchstart={(e) => tapCar(car, e)}
          onclick={(e) => tapCar(car, e)}
          class="flex flex-col items-center justify-center shrink-0 w-16 h-14 rounded-xl font-black text-sm active:brightness-75 transition-[filter]"
          style="
            background: {rejected ? '#450a0a' : car.color};
            color: #000;
            border: {rejected ? '2px solid #ef4444' : '2px solid transparent'};
            touch-action: manipulation;
            -webkit-tap-highlight-color: transparent;
          "
        >
          <span>#{car.number}</span>
          {#key tick}
            <span class="text-[10px] font-mono" style="color: rgba(0,0,0,0.6);">
              {lastLap ? elapsedSince(lastLap.perfTimestamp) : '—'}
            </span>
          {/key}
        </button>
      {/each}

      <button
        onclick={() => (showAddCar = true)}
        class="shrink-0 w-14 h-14 rounded-xl font-black text-2xl flex items-center justify-center active:scale-95 transition-transform"
        style="background: #1f1f1f; color: #6b7280; border: 2px dashed #374151; touch-action: manipulation;"
      >
        +
      </button>
    </section>
  </div>

  <!-- Add car modal — slides up from bottom -->
  {#if showAddCar}
    <!-- Backdrop -->
    <button
      class="fixed inset-0 z-40"
      style="background: rgba(0,0,0,0.75);"
      onclick={() => (showAddCar = false)}
      aria-label="Close"
    ></button>

    <!-- Sheet -->
    <div
      class="fixed bottom-0 left-0 right-0 z-50 rounded-t-2xl p-6 flex flex-col gap-5"
      style="background: #111; border-top: 1px solid #1f1f1f;"
    >
      <h2 class="font-black text-lg tracking-wide">ADD CAR</h2>

      <div class="flex flex-col gap-2">
        <label for="car-number" class="text-xs uppercase tracking-widest" style="color: #6b7280;">Car number</label>
        <input
          id="car-number"
          type="text"
          inputmode="numeric"
          pattern="[0-9]*"
          bind:value={newCarNumber}
          placeholder="e.g. 42"
          maxlength="3"
          class="w-full px-4 py-3 rounded-xl text-2xl font-black text-center"
          style="background: #1f1f1f; color: #fff; border: 1px solid #374151;"
        />
      </div>

      <div class="flex flex-col gap-2">
        <label for="colour-picker" class="text-xs uppercase tracking-widest" style="color: #6b7280;">Colour</label>
        <div id="colour-picker" class="flex gap-3 flex-wrap">
          {#each COLOR_PALETTE as color}
            <button
              onclick={() => (newCarColor = color)}
              class="w-10 h-10 rounded-full transition-transform active:scale-90"
              style="
                background: {color};
                outline: {newCarColor === color ? '3px solid #fff' : '3px solid transparent'};
                outline-offset: 2px;
                touch-action: manipulation;
              "
              aria-label={color}
            ></button>
          {/each}
        </div>
      </div>

      <div class="flex gap-3">
        <button
          onclick={addCar}
          disabled={!newCarNumber.trim()}
          class="flex-1 py-4 rounded-xl font-black text-lg transition-opacity"
          style="background: #22c55e; color: #000; touch-action: manipulation; opacity: {newCarNumber.trim() ? 1 : 0.4};"
        >
          ADD
        </button>
        <button
          onclick={() => (showAddCar = false)}
          class="px-6 py-4 rounded-xl font-bold"
          style="background: #1f1f1f; color: #9ca3af; touch-action: manipulation;"
        >
          Cancel
        </button>
      </div>
    </div>
  {/if}
{/if}
