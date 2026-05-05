// Wake Lock API — iOS 16.4+ only.
// Released automatically on visibilitychange; re-acquired when tab becomes visible again.

let wakeLock: WakeLockSentinel | null = null;
let listenerRegistered = false;

export async function acquireWakeLock(): Promise<void> {
  if (!('wakeLock' in navigator)) return;
  try {
    wakeLock = await navigator.wakeLock.request('screen');
  } catch {
    // Silently degrade — battery saver mode, low power, permissions denied
  }

  if (!listenerRegistered) {
    listenerRegistered = true;
    // Re-acquire after returning from another app or lock screen
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        acquireWakeLock();
      }
    });
  }
}

export async function releaseWakeLock(): Promise<void> {
  if (wakeLock) {
    try {
      await wakeLock.release();
    } catch {
      // Already released (e.g. page hidden)
    }
    wakeLock = null;
  }
}

export function isWakeLockActive(): boolean {
  return wakeLock !== null && !wakeLock.released;
}
