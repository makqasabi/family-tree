// App coordinator. Owns view state, search, save/lock workflow.

import { init as initAuth, lock, getPassword } from "./auth.js";
import { setData, getData, subscribe, searchPeople, getPerson, isCurrentUserAdmin, setShowAllFemaleDOB } from "./data.js";
import { isAdminVerified, elevate, unelevate, onAdminChange } from "./admin.js";
import { persistEncrypted, downloadEncrypted, getStoredBlob, readFileAsJSON, saveBlob, fetchSeed, mergeSeedNarrative } from "./storage.js";
import * as Outline from "./outline-view.js";
import * as Tree from "./tree-view.js";
import * as Profile from "./profile-view.js";
import * as PersonForm from "./person-form.js";
import * as Milk from "./milk-view.js";
import * as Chronology from "./chronology-view.js";
import * as Cleanup from "./cleanup-view.js";
import { exportSummary } from "./pdf-export.js";

const els = {
  outlineView: document.getElementById("view-outline"),
  treeView: document.getElementById("view-tree"),
  linkedView: document.getElementById("view-linked"),
  milkView: document.getElementById("view-milk"),
  chronologyView: document.getElementById("view-chronology"),
  profileView: document.getElementById("view-profile"),
  tabs: document.querySelectorAll(".app-header .tabs button"),
  search: document.getElementById("search-input"),
  searchResults: document.getElementById("search-results"),
  unsavedBadge: document.getElementById("unsaved-badge"),
  toast: document.getElementById("toast"),
  adminFemaleDobWrap: document.getElementById("admin-female-dob-wrap"),
  adminFemaleDob: document.getElementById("admin-female-dob"),
  cleanupBtn: document.getElementById("cleanup-btn"),
  addPersonBtn: document.getElementById("add-person-btn"),
  mergeSeedBtn: document.getElementById("merge-seed-btn"),
  importBtn: document.getElementById("import-btn"),
  adminModeBtn: document.getElementById("admin-mode-btn")
};

const ADMIN_PREF_KEY = "qassabi_admin_show_female_dob_v1";

let currentView = "outline";  // outline | tree | profile
let currentProfileId = null;
let dirty = false;
let bootstrapped = false;
let unsubscribeData = null;

initAuth(onUnlocked);

function onUnlocked(data) {
  try {
    setData(data);
    window.__currentData = data;
    if (unsubscribeData) unsubscribeData();
    unsubscribeData = subscribe(() => { dirty = true; updateBadge(); applyAdminVisibility(); });

    applyAdminVisibility();
    onAdminChange(() => { applyAdminVisibility(); renderCurrent(); });
    showView("outline");
    renderCurrent();

    if (!bootstrapped) {
      bindHeader();
      bindSearch();
      window.addEventListener("beforeunload", e => {
        if (dirty) { e.preventDefault(); e.returnValue = ""; }
      });
      bootstrapped = true;
    }
  } catch (e) {
    console.error("Render failed:", e);
    document.getElementById("view-outline").innerHTML =
      `<div class="profile" style="color:var(--danger)">
        <h2>خطأ أثناء العرض</h2>
        <pre style="white-space:pre-wrap; font-family:monospace;">${String(e.stack || e)}</pre>
        <p>افتح Console المتصفح (F12) لمزيد من التفاصيل.</p>
      </div>`;
  }
}

// Show/hide admin-only controls and restore the saved toggle preference.
function applyAdminVisibility() {
  // Admin features require BOTH: currentUserId is in adminUserIds AND the
  // session has been explicitly elevated via the admin password (admin.js).
  // Viewers see the data read-only with female DOB always hidden.
  const isAdmin = isCurrentUserAdmin() && isAdminVerified();
  els.adminFemaleDobWrap.hidden = !isAdmin;
  els.cleanupBtn.hidden = !isAdmin;
  els.addPersonBtn.hidden = !isAdmin;
  els.mergeSeedBtn.hidden = !isAdmin;
  els.importBtn.hidden = !isAdmin;
  // The 🔓/🔐 icon reflects current state — open lock = viewer, closed = admin.
  if (els.adminModeBtn) {
    els.adminModeBtn.textContent = isAdmin ? "🔐" : "🔓";
    els.adminModeBtn.title = isAdmin ? "خروج من وضع المسؤول" : "دخول وضع المسؤول";
    els.adminModeBtn.classList.toggle("admin-on", isAdmin);
  }
  if (isAdmin) {
    const saved = localStorage.getItem(ADMIN_PREF_KEY) === "1";
    els.adminFemaleDob.checked = saved;
    setShowAllFemaleDOB(saved);
  } else {
    els.adminFemaleDob.checked = false;
    setShowAllFemaleDOB(false);
  }
}

function bindHeader() {
  els.tabs.forEach(btn => {
    btn.addEventListener("click", () => {
      els.tabs.forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      showView(btn.dataset.view);
    });
  });
  document.getElementById("add-person-btn").addEventListener("click", () => {
    if (!isAdminVerified()) return;
    PersonForm.open({ onSave: (id) => {
      toast("تمت الإضافة");
      autoPersist();
      showProfile(id);
    }});
  });
  els.cleanupBtn.addEventListener("click", () => {
    if (!isCurrentUserAdmin() || !isAdminVerified()) return;
    Cleanup.open({
      afterDelete: async () => { await autoPersist(); renderCurrent(); },
      onClose: () => { renderCurrent(); }
    });
  });
  els.adminModeBtn?.addEventListener("click", async () => {
    if (isAdminVerified()) {
      if (confirm("هل تريد الخروج من وضع المسؤول؟")) {
        unelevate();
        toast("تم الخروج من وضع المسؤول");
      }
    } else {
      const pw = prompt("أدخل كلمة مرور المسؤول:");
      if (!pw) return;
      const ok = await elevate(pw);
      if (ok) toast("✓ تم تفعيل وضع المسؤول");
      else toast("كلمة المرور غير صحيحة");
    }
  });
  document.getElementById("pdf-btn").addEventListener("click", () => {
    toast("جارِ تجهيز الملخص...");
    setTimeout(() => exportSummary(), 50);
  });
  els.adminFemaleDob.addEventListener("change", () => {
    if (!isCurrentUserAdmin()) {
      // Defensive: a non-admin shouldn't be able to flip this, but if they do, ignore.
      els.adminFemaleDob.checked = false;
      return;
    }
    const on = els.adminFemaleDob.checked;
    setShowAllFemaleDOB(on);
    localStorage.setItem(ADMIN_PREF_KEY, on ? "1" : "0");
    toast(on ? "تم إظهار جميع تواريخ ميلاد النساء" : "تم إخفاء تواريخ ميلاد النساء (الافتراضي)");
    renderCurrent();
  });
  document.getElementById("merge-seed-btn").addEventListener("click", async () => {
    if (!isAdminVerified()) return;
    if (!confirm("سيتم جلب التحديثات النصّية من seed.json (الأحداث، المهن، الأماكن، الملاحظات الفارغة) ودمجها في بياناتك دون المساس بالأبناء/الأزواج/الأعلام التي أضفتها. متابعة؟")) return;
    try {
      const seed = await fetchSeed();
      const r = mergeSeedNarrative(getData(), seed);
      await autoPersist();
      // Merge mutates data in place without firing the data-change event,
      // so re-apply admin visibility explicitly in case currentUserId or
      // adminUserIds changed.
      applyAdminVisibility();
      const parts = [
        r.personsAdded ? `${r.personsAdded} شخص` : null,
        r.parentLinkAdded ? `${r.parentLinkAdded} رابط أبوّة` : null,
        r.parentLinkCorrected ? `${r.parentLinkCorrected} تصحيح أبوّة` : null,
        r.placeholderFlagToggled ? `${r.placeholderFlagToggled} رفع علامة placeholder` : null,
        r.marriagesAdded ? `${r.marriagesAdded} زواج` : null,
        r.marriagesUpdated ? `${r.marriagesUpdated} تحديث زواج` : null,
        r.milkAdded ? `${r.milkAdded} رضاعة` : null,
        r.evAdded ? `${r.evAdded} حدث` : null,
        r.eventsRemoved ? `${r.eventsRemoved} حدث محذوف` : null,
        r.personsRemoved ? `${r.personsRemoved} شخص محذوف` : null,
        r.marriagesRemoved ? `${r.marriagesRemoved} زواج محذوف` : null,
        r.occAdded ? `${r.occAdded} مهنة` : null,
        r.placeAdded ? `${r.placeAdded} مكان` : null,
        r.noteUpdated ? `${r.noteUpdated} ملاحظة` : null,
        r.kunyaUpdated ? `${r.kunyaUpdated} كنية` : null,
        r.aliasUpdated ? `${r.aliasUpdated} لقب` : null,
        r.fullNameUpgraded ? `${r.fullNameUpgraded} اسم كامل مُحدَّث` : null,
        r.placeholderRenamed ? `${r.placeholderRenamed} تصحيح اسم` : null,
        r.intermediatesInserted ? `${r.intermediatesInserted} جدّ وسيط` : null,
        r.tribeUpdated ? `${r.tribeUpdated} قبيلة` : null,
        r.tribalRootSet ? `${r.tribalRootSet} أصل قبلي` : null,
        r.lifeFieldUpdated ? `${r.lifeFieldUpdated} تصحيح ميلاد/وفاة` : null,
        r.deceasedFlagUpdated ? `${r.deceasedFlagUpdated} علامة وفاة` : null,
        r.givenUpdated ? `${r.givenUpdated} اسم أول` : null,
        r.familyUpdated ? `${r.familyUpdated} اسم عائلة` : null,
        r.fullNameCorrected ? `${r.fullNameCorrected} تصحيح اسم كامل` : null,
        r.marriageStatusUpdated ? `${r.marriageStatusUpdated} حالة زواج` : null,
        r.adminsAdded ? `${r.adminsAdded} مشرف` : null,
        r.userIdSet ? `تعيين الشخص الحالي` : null
      ].filter(Boolean);
      toast(parts.length ? `تم الدمج: ${parts.join("، ")}` : "لا تحديثات جديدة في seed.json");
      renderCurrent();
    } catch (e) {
      console.error(e);
      toast("فشل الدمج: " + e.message);
    }
  });
  document.getElementById("export-btn").addEventListener("click", async () => {
    const pw = getPassword();
    if (!pw) { toast("القفل لم يُفتح بعد"); return; }
    const blob = await persistEncrypted(getData(), pw);
    downloadEncrypted(blob, "family.enc.json");
    dirty = false;
    updateBadge();
    toast("تم تصدير النسخة المشفّرة");
  });
  document.getElementById("import-btn").addEventListener("click", () => {
    document.getElementById("import-file").click();
  });
  document.getElementById("import-file").addEventListener("change", async e => {
    const f = e.target.files[0];
    if (!f) return;
    try {
      const blob = await readFileAsJSON(f);
      saveBlob(blob);
      toast("تم استيراد النسخة. سيُعاد القفل لإعادة الفتح بكلمة المرور.");
      lock();
    } catch (err) {
      toast("ملف غير صالح");
    }
  });
  document.getElementById("lock-btn").addEventListener("click", async () => {
    if (dirty) {
      const yes = confirm("هناك تغييرات غير محفوظة. تشفير وحفظ قبل القفل؟");
      if (yes) await autoPersist();
    }
    lock();
  });
}

function bindSearch() {
  els.search.addEventListener("input", () => {
    const q = els.search.value;
    if (!q.trim()) { els.searchResults.classList.remove("open"); return; }
    const results = searchPeople(q);
    els.searchResults.innerHTML = results.map(p => `<li data-id="${p.id}">${escapeHTML(p.fullName)}</li>`).join("");
    els.searchResults.classList.toggle("open", results.length > 0);
    els.searchResults.querySelectorAll("li").forEach(li => {
      li.addEventListener("click", () => {
        const id = li.dataset.id;
        els.search.value = "";
        els.searchResults.classList.remove("open");
        showProfile(id);
      });
    });
  });
  document.addEventListener("click", e => {
    if (!els.search.contains(e.target) && !els.searchResults.contains(e.target)) {
      els.searchResults.classList.remove("open");
    }
  });
}

function showView(name) {
  currentView = name;
  els.outlineView.hidden = name !== "outline";
  els.treeView.hidden = name !== "tree";
  els.linkedView.hidden = name !== "linked";
  els.milkView.hidden = name !== "milk";
  els.chronologyView.hidden = name !== "chronology";
  els.profileView.hidden = name !== "profile";
  els.tabs.forEach(b => b.classList.toggle("active", b.dataset.view === name));
  renderCurrent();
}

function renderCurrent() {
  if (currentView === "outline") {
    Outline.render(els.outlineView, { mode: "primary", onSelect: showProfile });
  } else if (currentView === "tree") {
    Tree.render(els.treeView, { onSelect: showProfile });
  } else if (currentView === "linked") {
    Outline.render(els.linkedView, { mode: "linked", onSelect: showProfile });
  } else if (currentView === "milk") {
    Milk.render(els.milkView, { onSelect: showProfile });
  } else if (currentView === "chronology") {
    Chronology.render(els.chronologyView, { onSelect: showProfile });
  } else if (currentView === "profile" && currentProfileId) {
    Profile.render(els.profileView, currentProfileId, {
      onSelect: showProfile,
      onEdit: (id) => PersonForm.open({ editId: id, onSave: () => {
        autoPersist();
        Profile.render(els.profileView, id, profileOptions());
      }}),
      onDelete: () => { autoPersist(); showView("outline"); },
      onChange: () => { autoPersist(); }
    });
  }
}

function profileOptions() {
  return {
    onSelect: showProfile,
    onEdit: (id) => PersonForm.open({ editId: id, onSave: () => {
      autoPersist();
      Profile.render(els.profileView, id, profileOptions());
    }}),
    onDelete: () => { autoPersist(); showView("outline"); },
    onChange: () => { autoPersist(); }
  };
}

function showProfile(id) {
  currentProfileId = id;
  showView("profile");
}

async function autoPersist() {
  const pw = getPassword();
  if (!pw) {
    // Silent skip used to mask persistence failures — now surface clearly.
    console.warn("autoPersist: password unavailable; data NOT persisted to localStorage");
    toast("⚠️ كلمة المرور غير متوفّرة — لم يُحفظ التغيير. يرجى إعادة فتح القفل.");
    throw new Error("password unavailable");
  }
  await persistEncrypted(getData(), pw);
  dirty = false;
  updateBadge();
}

function updateBadge() {
  els.unsavedBadge.hidden = !dirty;
}

let toastTimer;
function toast(msg) {
  els.toast.textContent = msg;
  els.toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => els.toast.classList.remove("show"), 2400);
}

function escapeHTML(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;" }[c]));
}
