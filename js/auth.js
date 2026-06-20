// Unified gate — a single screen accepting one password. The password is
// classified against two known SHA-256 hashes (viewer or admin). Any other
// input is rejected. On success:
//   • viewer  → fetch+decrypt+display in read-only mode
//   • admin   → same data + elevated features (toggle DOB, edit, merge, etc.)
//
// First-time visitors also see a small "request password from admin" link
// that opens WhatsApp pre-filled. Returning visitors skip straight to the
// password input (we cache the encrypted blob plus the role flag locally).

import {
  hasLocalBlob, unlockWithPassword, persistEncrypted,
  fetchSeed, fetchHostedEncrypted, saveBlob, readFileAsJSON
} from "./storage.js";
import { classifyPassword, setAdminFlag, unelevate } from "./admin.js";

const gate = document.getElementById("gate");
const slot = document.getElementById("gate-content");
const app = document.getElementById("app");

const ADMIN_WHATSAPP = "966541981022";

let onUnlocked = null;
let activePassword = null;

export function getPassword() { return activePassword; }

export async function init(callback) {
  onUnlocked = callback;
  // Best-effort: pull a hosted encrypted blob (if any) into localStorage so
  // returning admin devices can still unlock their saved state.
  if (!hasLocalBlob()) {
    const hosted = await fetchHostedEncrypted();
    if (hosted) saveBlob(hosted);
  }
  renderGate();
}

function renderGate() {
  const hasBlob = hasLocalBlob();
  slot.innerHTML = `
    <h2>شجرة عائلة آل عثمان القصبي</h2>
    <p class="muted gate-tagline">موقع خاص بالعائلة — أدخل كلمة المرور للدخول</p>

    <label for="gate-pw" class="visually-hidden">كلمة المرور</label>
    <input id="gate-pw" type="password" placeholder="كلمة المرور" autocomplete="current-password" autofocus />

    <div class="gate-error" id="gate-error"></div>

    <div class="actions" style="justify-content: stretch; flex-direction: column; gap: 8px;">
      <button class="primary" id="gate-submit">دخول</button>
    </div>

    <div class="gate-help">
      <p class="muted" style="font-size:0.9em; margin: 4px 0 6px;">لم تحصل على كلمة المرور؟</p>
      <a id="gate-wa" target="_blank" rel="noopener" class="gate-wa-link">
        📲 اطلبها من المسؤول عبر واتساب
      </a>
    </div>

    ${hasBlob ? `<button class="ghost gate-reset" id="gate-reset">إعادة الإعداد على هذا الجهاز</button>` : ""}
  `;

  const input = slot.querySelector("#gate-pw");
  const err = slot.querySelector("#gate-error");
  const submit = async () => {
    err.textContent = "";
    const pw = input.value;
    const role = await classifyPassword(pw);
    if (!role) {
      err.textContent = "كلمة المرور غير صحيحة.";
      input.focus(); input.select();
      return;
    }
    err.textContent = "جارٍ التحميل...";
    try {
      // If a local encrypted blob exists, prefer decrypting it with the
      // typed password (so admin edits persist). Otherwise fetch fresh seed.
      let data = null;
      if (hasLocalBlob()) {
        try { data = await unlockWithPassword(pw); } catch { /* fall through */ }
      }
      if (!data) {
        data = await fetchSeed();
        await persistEncrypted(data, pw);
      }
      activePassword = pw;
      // Apply role: admin gets the elevated flag, viewer always loses it.
      if (role === "admin") setAdminFlag(); else unelevate();
      finishUnlock(data);
    } catch (e) {
      console.error(e);
      err.textContent = "تعذّر تحميل البيانات: " + e.message;
    }
  };
  slot.querySelector("#gate-submit").addEventListener("click", submit);
  input.addEventListener("keydown", e => { if (e.key === "Enter") submit(); });

  // WhatsApp link — pre-filled message
  const greeting = "السلام عليكم، أرغب بالحصول على كلمة مرور موقع شجرة عائلة القصبي";
  slot.querySelector("#gate-wa").href = `https://wa.me/${ADMIN_WHATSAPP}?text=${encodeURIComponent(greeting)}`;

  slot.querySelector("#gate-reset")?.addEventListener("click", () => {
    if (!confirm("سيتم حذف النسخة المحفوظة على هذا الجهاز فقط. تابع؟")) return;
    localStorage.removeItem("qassabi_family_blob_v1");
    unelevate();
    renderGate();
  });
}

function finishUnlock(data) {
  gate.hidden = true;
  app.hidden = false;
  if (onUnlocked) onUnlocked(data);
}

export function lock() {
  activePassword = null;
  app.hidden = true;
  gate.hidden = false;
  renderGate();
}

export async function changePassword(newPw) {
  const data = window.__currentData;
  if (!data) return;
  await persistEncrypted(data, newPw);
  activePassword = newPw;
}
