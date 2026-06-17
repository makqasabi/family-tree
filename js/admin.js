// Admin verification — a second gate that elevates an unlocked session into
// admin mode. Without this, the session is in "viewer" mode: the data is
// readable but admin-only features (female DOB toggle, edit/add/delete,
// cleanup, seed merge) are hidden.
//
// The admin password is checked against a hardcoded SHA-256 hash. Source
// readers see the hash but not the password.
//
// Default password: qassabi-admin-2026
// To rotate: compute SHA-256 of the new password and replace ADMIN_PW_HASH.

const ADMIN_PW_HASH = "87b8f7070ff55ecad0f44bdd8319275f40fde0f03841ffb058b5def7b53eb6ef";
const ADMIN_FLAG_KEY = "qassabi_admin_verified_v1";

const listeners = new Set();

export function isAdminVerified() {
  return localStorage.getItem(ADMIN_FLAG_KEY) === "1";
}

export async function verifyAdminPassword(input) {
  if (!input) return false;
  const enc = new TextEncoder().encode(input);
  const hashBuf = await crypto.subtle.digest("SHA-256", enc);
  const hex = [...new Uint8Array(hashBuf)].map(b => b.toString(16).padStart(2, "0")).join("");
  return hex === ADMIN_PW_HASH;
}

export async function elevate(input) {
  if (await verifyAdminPassword(input)) {
    localStorage.setItem(ADMIN_FLAG_KEY, "1");
    notify();
    return true;
  }
  return false;
}

export function unelevate() {
  localStorage.removeItem(ADMIN_FLAG_KEY);
  notify();
}

export function onAdminChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function notify() {
  for (const fn of listeners) fn();
}
