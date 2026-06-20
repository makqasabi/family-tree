// Admin verification — a second gate that elevates an unlocked session into
// admin mode. Without this, the session is in "viewer" mode: the data is
// readable but admin-only features (female DOB toggle, edit/add/delete,
// cleanup, seed merge) are hidden.
//
// The admin password is checked against a hardcoded SHA-256 hash. Source
// readers see the hash but not the password.
//
// Two authorized roles, each gated by a known SHA-256 hash:
//   - VIEWER ("قصب1900"): default access — read-only, female DOB hidden
//   - ADMIN  ("Abo9q3a@@??"): full features (edit, toggle, merge, etc.)
// Anyone entering a password that matches neither hash is rejected at the gate.
//
// To rotate either password, compute its SHA-256 (UTF-8) and replace below:
//   node -e "console.log(require('crypto').createHash('sha256').update('NEW','utf8').digest('hex'))"

const VIEWER_PW_HASH = "37cd3254d107b8c73330c01067bb4a780f415493ace55f955553fba46c103377";
const ADMIN_PW_HASH  = "78f816937776b6af7a3e8e535066dba7f9766241d15a0ec8876ceb5c77d6ee59";

const ADMIN_FLAG_KEY = "qassabi_admin_verified_v1";

const listeners = new Set();

export function isAdminVerified() {
  return localStorage.getItem(ADMIN_FLAG_KEY) === "1";
}

// Hash any input — used to classify a typed gate password.
async function sha256Hex(input) {
  const enc = new TextEncoder().encode(input || "");
  const buf = await crypto.subtle.digest("SHA-256", enc);
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, "0")).join("");
}

// Classify a password attempt: "admin" | "viewer" | null (rejected).
export async function classifyPassword(input) {
  if (!input) return null;
  const h = await sha256Hex(input);
  if (h === ADMIN_PW_HASH) return "admin";
  if (h === VIEWER_PW_HASH) return "viewer";
  return null;
}

export async function verifyAdminPassword(input) {
  return (await classifyPassword(input)) === "admin";
}

export async function elevate(input) {
  if (await verifyAdminPassword(input)) {
    localStorage.setItem(ADMIN_FLAG_KEY, "1");
    notify();
    return true;
  }
  return false;
}

// Set the admin flag without re-hashing (caller already verified).
export function setAdminFlag() {
  localStorage.setItem(ADMIN_FLAG_KEY, "1");
  notify();
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
