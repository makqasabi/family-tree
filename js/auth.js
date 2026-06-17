// Password gate + initial setup wizard.
// States:
//  - "locked": stored blob exists -> ask password to unlock
//  - "setup":  no stored blob -> offer (a) load seed.json + set password
//                                    (b) import existing encrypted file
//  - "import": user picked import path

import {
  hasLocalBlob, unlockWithPassword, persistEncrypted,
  fetchSeed, fetchHostedEncrypted, getStoredBlob, saveBlob, getHint, setHint,
  readFileAsJSON
} from "./storage.js";

const gate = document.getElementById("gate");
const slot = document.getElementById("gate-content");
const app = document.getElementById("app");

let onUnlocked = null;
let activePassword = null;

export function getPassword() { return activePassword; }

export async function init(callback) {
  onUnlocked = callback;

  // Try to pull a hosted blob into localStorage on first visit (so the
  // site works for new visitors who don't have a local copy).
  if (!hasLocalBlob()) {
    const hosted = await fetchHostedEncrypted();
    if (hosted) saveBlob(hosted);
  }

  if (hasLocalBlob()) renderLocked();
  else renderSetup();
}

function renderLocked() {
  const hint = getHint();
  slot.innerHTML = `
    <h2>أدخل كلمة المرور</h2>
    <p class="muted">للوصول إلى بيانات العائلة المشفّرة.</p>
    <input id="pw-input" type="password" placeholder="كلمة المرور" autofocus />
    ${hint ? `<p class="muted">تلميح: ${escapeHTML(hint)}</p>` : ""}
    <div class="gate-error" id="gate-error"></div>
    <div class="actions">
      <button class="ghost" id="reset-btn">إعادة الإعداد</button>
      <button class="primary" id="unlock-btn">فتح</button>
    </div>
  `;
  const input = slot.querySelector("#pw-input");
  const err = slot.querySelector("#gate-error");
  const submit = async () => {
    err.textContent = "";
    try {
      const data = await unlockWithPassword(input.value);
      activePassword = input.value;
      finishUnlock(data);
    } catch (e) {
      err.textContent = "كلمة المرور غير صحيحة أو الملف تالف.";
      input.focus(); input.select();
    }
  };
  slot.querySelector("#unlock-btn").addEventListener("click", submit);
  input.addEventListener("keydown", e => { if (e.key === "Enter") submit(); });
  slot.querySelector("#reset-btn").addEventListener("click", () => {
    if (confirm("سيتم إزالة النسخة المشفّرة من هذا الجهاز فقط. تابع؟")) {
      localStorage.removeItem("qassabi_family_blob_v1");
      renderSetup();
    }
  });
}

function renderSetup() {
  slot.innerHTML = `
    <h2>الإعداد لأول مرة</h2>
    <p class="muted">اختر طريقة بدء استخدام شجرة العائلة.</p>
    <div class="actions" style="justify-content: stretch; flex-direction: column; gap: 8px;">
      <button class="primary" id="seed-btn">ابدأ من البيانات الأولية (seed.json)</button>
      <button id="import-btn">استورد نسخة مشفّرة (family.enc.json)</button>
    </div>
    <input id="gate-import-file" type="file" accept="application/json,.json" hidden />
    <div class="gate-error" id="gate-error"></div>
  `;
  slot.querySelector("#seed-btn").addEventListener("click", renderSeedSetup);
  const file = slot.querySelector("#gate-import-file");
  slot.querySelector("#import-btn").addEventListener("click", () => file.click());
  file.addEventListener("change", async e => {
    const f = e.target.files[0];
    if (!f) return;
    try {
      const blob = await readFileAsJSON(f);
      saveBlob(blob);
      renderLocked();
    } catch (err) {
      slot.querySelector("#gate-error").textContent = "تعذّر قراءة الملف.";
    }
  });
}

function renderSeedSetup() {
  slot.innerHTML = `
    <h2>تعيين كلمة المرور</h2>
    <p class="muted">سيتم تشفير بيانات seed.json بهذه الكلمة. احتفظ بها بأمان — لا يمكن استرجاعها.</p>
    <label>كلمة المرور</label>
    <input id="pw1" type="password" autofocus />
    <label>تأكيد كلمة المرور</label>
    <input id="pw2" type="password" />
    <label>تلميح اختياري (يُحفظ بدون تشفير)</label>
    <input id="hint" type="text" placeholder="مثال: اسم الجد..." />
    <div class="gate-error" id="gate-error"></div>
    <div class="actions">
      <button class="ghost" id="back-btn">رجوع</button>
      <button class="primary" id="go-btn">تشفير وبدء</button>
    </div>
  `;
  slot.querySelector("#back-btn").addEventListener("click", renderSetup);
  slot.querySelector("#go-btn").addEventListener("click", async () => {
    const pw1 = slot.querySelector("#pw1").value;
    const pw2 = slot.querySelector("#pw2").value;
    const hint = slot.querySelector("#hint").value;
    const err = slot.querySelector("#gate-error");
    if (pw1.length < 6) { err.textContent = "كلمة المرور قصيرة (٦ أحرف على الأقل)."; return; }
    if (pw1 !== pw2) { err.textContent = "الكلمتان غير متطابقتين."; return; }
    err.textContent = "جارِ التحميل والتشفير...";
    try {
      const seed = await fetchSeed();
      await persistEncrypted(seed, pw1);
      setHint(hint);
      activePassword = pw1;
      finishUnlock(seed);
    } catch (e) {
      console.error(e);
      err.textContent = "حدث خطأ أثناء التشفير: " + e.message;
    }
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
  renderLocked();
}

export async function changePassword(newPw) {
  // Re-encrypts using current data.
  const data = window.__currentData;
  if (!data) return;
  await persistEncrypted(data, newPw);
  activePassword = newPw;
}

function escapeHTML(s) {
  return String(s).replace(/[&<>"']/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;" }[c]));
}
