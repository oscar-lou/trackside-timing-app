# Trackside Timing PWA — Claude Code Handoff Brief

## Context

I'm building an **offline-first PWA for trackside lap timing** at the MTCS Roadsport Challenge (Toyota GR86, racing Thursday–Saturday this week). Mechanics on the pitwall will manually tap buttons as rival cars cross the start/finish line during Thursday practice (no official live timing is provided that day).

This brief captures architectural decisions made with another Claude in a planning session. Step 1 (project scaffold) is **complete**. You are picking up at **Step 2: Dexie schema + timing engine**.

---

## Hard Constraints

1. **100% offline operation** — cellular at the circuit is unreliable when crowded. App must work in airplane mode.
2. **Zero perceived input latency** — mechanics under pressure, no visual flash on tap, no debounce delay.
3. **Screen must stay awake** mid-session.
4. **Deployment target:** Vercel (static), installed as PWA to home screen on iOS/Android.
5. **Deadline:** Must be tested Wednesday night, deployed before Thursday morning practice.

---

## Architectural Decisions (Already Settled — Do Not Re-Litigate)

### Stack
- **SvelteKit** with `adapter-static` (chosen over Vue/React for minimum runtime overhead)
- **TypeScript** throughout
- **Tailwind v4** (CSS-first, dark/high-contrast for outdoor sunlight)
- **Dexie.js** as IndexedDB wrapper
- **@vite-pwa/sveltekit** for service worker generation
- **Vercel** for deployment

### Critical Engineering Decisions

**Use `performance.now()` for all lap delta calculations, NOT `Date.now()`.**
- `Date.now()` is wall-clock and subject to NTP corrections — if the phone re-syncs to a cell tower mid-session, you get backwards jumps and corrupted lap times.
- `performance.now()` is monotonic, sub-millisecond, never goes backwards.
- Store ONE anchor `Date.now()` at session start for human-readable CSV export. Compute everything else from `performance.now()`.

**Touch input:**
- Use `ontouchstart` (fires ~50–80ms before `click`) AND `onclick` for desktop dev.
- `touch-action: manipulation` and `-webkit-tap-highlight-color: transparent` already applied globally in `app.css` to eliminate tap flash and prevent zoom.

**Wake Lock API:**
- `navigator.wakeLock.request('screen')` only works on iOS 16.4+.
- Wake lock is **released automatically on `visibilitychange`** when tab loses focus — must be re-acquired in a `visibilitychange` listener when tab regains focus.
- Need feature detection + fallback (hidden looping muted `<video>` for pre-iOS 16.4 — defer this unless we confirm an old phone is in use).

**Storage persistence:**
- Call `navigator.storage.persist()` on first load — iOS Safari may evict IndexedDB after 7 days of inactivity for non-persistent storage.

**Soft delete, not hard delete:**
- Laps have an `isInvalidated` boolean flag rather than being deleted by undo.
- We want a complete audit trail for post-session analysis Saturday night.

**Minimum lap threshold:**
- Reject taps within 30 seconds of the previous tap on the same car (obvious double-taps). Real laps at MTCS circuits are 90s+, so 30s is safe.

**Undo button:**
- Top-level, large, undoes the most recent tap across all cars within ~10 seconds (flips `isInvalidated`).

**Armed state:**
- Each car button must show elapsed time since last tap as a visible counter, so the mechanic gets confirmation the previous tap registered.

### Data Model

```typescript
sessions: {
  id: string,
  name: string,
  trackName: string,
  startedAt: number,        // Date.now() anchor for CSV
  startedAtPerf: number     // performance.now() at session start
}

cars: {
  id: string,
  number: string,           // e.g. "18", "21", "71", "1"
  driverName: string,
  color: string,
  isPinned: boolean         // pinned cars appear in top row with biggest buttons
}

laps: {
  id: string,
  sessionId: string,
  carId: string,
  lapNumber: number,
  perfTimestamp: number,    // performance.now() at tap
  deltaMs: number,          // ms since previous tap on same car (0 for out lap)
  isOutLap: boolean,
  isInvalidated: boolean
}
```

### CSV Export Format
- Lap times formatted as `mm:ss.SSS` (e.g., `1:47.234`) — what every motorsport tool expects.
- Include raw `deltaMs` column too.
- Trigger via top-level button, downloads a Blob.

### Pinned Threats
The four cars I most need to track on Thursday: **#18, #21, #71, #1**. These should be hardcoded as default pinned cars with massive touch targets in the top row. Other cars can be added dynamically below with smaller buttons.

---

## What Is Already Built (Step 1 — Complete)

Project at `~/Projects/trackside-timing` with:

- ✅ SvelteKit + TypeScript scaffold via `npx sv create`
- ✅ `@sveltejs/adapter-static` configured (`fallback: 'index.html'`)
- ✅ `+layout.ts` with `prerender = true`, `ssr = false`, `trailingSlash = 'always'`
- ✅ `vite.config.ts` with `SvelteKitPWA` plugin (autoUpdate, generateSW strategy, devOptions disabled)
- ✅ `manifest.webmanifest` configured for standalone portrait, black theme
- ✅ Tailwind v4 with custom CSS variables (`--color-bg`, `--color-accent` etc.) for dark/high-contrast
- ✅ Global tap-flash and zoom prevention CSS
- ✅ Placeholder PNG icons at `static/icon-192.png` and `static/icon-512.png`
- ✅ Sanity-check `+page.svelte` with a tap counter (works, will be replaced)
- ✅ `dexie` installed but no schema yet
- ✅ `npm run dev` and `npm run build` both verified working
- ✅ Initial git commit: `"Step 1: SvelteKit + Vite-PWA + Tailwind scaffold"`

---

## What's Next (Steps 2–5)

### Step 2: Dexie schema + timing engine
- Create `src/lib/db.ts` with Dexie schema matching the data model above
- Create `src/lib/timing.ts` — pure timing engine using `performance.now()`
- Create `src/lib/wakelock.ts` — wake lock manager with `visibilitychange` re-acquisition
- Create `src/lib/storage.ts` — `navigator.storage.persist()` wrapper
- Unit-style test harness: a debug page that exercises the timing engine without UI

### Step 3: UI
- Replace `+page.svelte` with the real timing interface
- Pinned threats row (#18, #21, #71, #1) with massive touch targets
- Per-button armed-state counter (live elapsed since last tap)
- Top-level undo button (10-second window)
- Top-level session start/stop
- Add-new-car flow for unpinned cars

### Step 4: CSV export
- Format laps as `mm:ss.SSS`
- Include raw ms, lap number, car number, driver, isInvalidated, isOutLap
- Download as Blob, filename `trackside-{trackName}-{ISO date}.csv`

### Step 5: Pre-deployment checklist
- Wednesday-night test protocol:
  1. Install PWA to home screen on actual mechanic phones
  2. Airplane mode, confirm cold-load from icon
  3. 30-min simulated session with random taps
  4. Lock phone, unlock, switch apps for 60s, return — verify timing continuity and wake lock re-acquired
  5. Export CSV, open on laptop, verify round-trip
- Vercel deploy: `vercel --prod` from project root

---

## Open Questions to Resolve in Step 2 or Later

1. **iOS vs Android split** among mechanics' phones — affects which compatibility fallbacks we need. (User has not confirmed yet.)
2. **Single shared session vs per-phone independent** — user has not confirmed. Currently designed as per-phone independent. Multi-device sync would require BroadcastChannel-equivalent over the network, which contradicts the offline constraint. **Default plan: per-phone independent.**
3. **Old iPhone fallback** for pre-iOS 16.4 wake lock — defer unless confirmed needed.

---

## Coding Conventions

- **Svelte 5 runes** (`$state`, `$derived`, `$effect`) — not legacy `$:` reactivity.
- **Event syntax:** `ontouchstart={...}` and `onclick={...}` (Svelte 5 style, not `on:click`).
- **Strict TypeScript.** No `any`. Define types in `src/lib/types.ts`.
- **Imports** use `$lib/` alias.
- **No external state libraries** — use Svelte 5 runes and the Dexie liveQuery pattern for reactivity from IndexedDB.

---

## First Task for Claude Code

Read this brief, confirm the project scaffold matches what's described in "What Is Already Built", then proceed with **Step 2: Dexie schema + timing engine**, starting with `src/lib/types.ts` and `src/lib/db.ts`.

Before writing code, briefly confirm your understanding of the `performance.now()` vs `Date.now()` decision and the soft-delete `isInvalidated` pattern — these are the two architectural choices most likely to be accidentally regressed.
