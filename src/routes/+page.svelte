<script lang="ts">
  let count = $state(0);
</script>

<svelte:head>
  <title>Trackside Timing</title>
  <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover" />
</svelte:head>

<main class="min-h-screen flex flex-col items-center justify-center gap-8 p-4">
  <h1 class="text-4xl font-bold text-[var(--color-accent)]">
    Trackside Timing
  </h1>
  <p class="text-[var(--color-muted)] text-center">
    Stack verification — tap below to confirm input works
  </p>
  <button
    class="bg-[var(--color-accent)] text-black font-bold text-2xl px-12 py-8 rounded-2xl active:scale-95 transition-transform"
    ontouchstart={() => count++}
    onclick={() => count++}
  >
    Taps: {count}
  </button>
  <p class="text-sm text-[var(--color-muted)]">
    If this counter increments instantly with no visual flash, the touch pipeline is healthy.
  </p>
</main>