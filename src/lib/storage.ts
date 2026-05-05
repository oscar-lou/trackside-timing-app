// Request persistent IndexedDB storage.
// Without this, iOS Safari may evict data after ~7 days of inactivity.
// Call once on first app load.
export async function requestPersistence(): Promise<boolean> {
  if (!('storage' in navigator) || !('persist' in navigator.storage)) return false;
  return navigator.storage.persist();
}

export async function isPersisted(): Promise<boolean> {
  if (!('storage' in navigator) || !('persisted' in navigator.storage)) return false;
  return navigator.storage.persisted();
}
