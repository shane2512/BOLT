/**
 * FR-8.7/FR-8.8 — a persisted, per-browser identifier so a repeat withdrawal
 * to an already-verified address can skip a fresh Selfie Check, and an
 * unrecognised device forces one even for a known address. Never trusted as
 * an authentication factor (see beneficiaries.device_id in packages/db) — it
 * can only ever cause a check to be *asked for*, never skipped incorrectly.
 */
export function getDeviceId(): string | null {
  if (typeof window === "undefined") return null;
  const KEY = "bolt-device-id";
  try {
    let id = window.localStorage.getItem(KEY);
    if (!id) {
      id = crypto.randomUUID();
      window.localStorage.setItem(KEY, id);
    }
    return id;
  } catch {
    // Private browsing / storage blocked — a fresh check every time is the
    // safe direction to fail in, not a broken claim flow.
    return null;
  }
}
