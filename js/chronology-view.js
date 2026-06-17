// Timeline of all dated events (births, deaths, marriages, custom events).
// Optional focus: pick a person and the list narrows to that person and
// his/her descendants (via fatherId AND motherId).

import {
  getData, getPerson, allPeople, collectAllEvents, descendantSetOf,
  arabicNormalize, lineageString
} from "./data.js";

let focusId = null;

export function render(container, options = {}) {
  const onSelect = options.onSelect || (() => {});
  const events = collectAllEvents();
  const focus = focusId ? getPerson(focusId) : null;

  let filtered = events;
  if (focus) {
    const include = descendantSetOf(focusId);
    filtered = events.filter(e => (e.personIds || []).some(id => include.has(id)));
  }

  const counts = countByType(filtered);
  const decadeBuckets = bucketByDecade(filtered);
  const totalAll = events.length;
  const data = getData();
  const marriagesWithYear = (data.marriages || []).filter(m => m.year).length;
  const totalMarriages = (data.marriages || []).length;

  // Empty-states by type — help diagnose why something is missing.
  const hints = [];
  if (!counts.custom) hints.push(`<p class="chr-hint">⚠️ لا توجد أحداث سفر/عمل/تخرّج (custom). اضغط <strong>🔄</strong> لجلب الأحداث من seed.json، أو افتح أي بطاقة شخص → <strong>تعديل</strong> → "الأحداث الحياتية" لإضافتها يدويًا.</p>`);
  if (counts.marriage < totalMarriages) hints.push(`<p class="chr-hint">ℹ️ يظهر ${counts.marriage} زواج فقط من أصل ${totalMarriages} لأن البقية لا تحمل سنة. أضف السنة من <strong>تعديل</strong> الزواج لتظهر هنا.</p>`);

  container.innerHTML = `
    <div class="chronology">
      <header class="chr-header">
        <div>
          <h2>الأحداث التاريخية</h2>
          <p class="muted">جميع الأحداث المؤرّخة (ولادات، وفيات، زيجات، وأحداث سفر/قدوم) مرتّبة زمنيًا.</p>
        </div>
        <div class="chr-stats">
          <span class="ev-type birth">${counts.birth || 0} ميلاد</span>
          <span class="ev-type death">${counts.death || 0} وفاة</span>
          <span class="ev-type marriage">${counts.marriage || 0} زواج</span>
          <span class="ev-type custom">${counts.custom || 0} حدث</span>
        </div>
      </header>

      ${hints.length && !focus ? `<div class="chr-hints">${hints.join("")}</div>` : ""}

      <div class="chr-controls">
        <label>التركيز على شخص وذرّيته:</label>
        <div class="picker chr-picker" data-picker="chr-focus">
          <input type="text" data-input
            placeholder="${focus ? "" : "ابحث بالاسم..."}"
            value="${focus ? attr(focus.fullName) : ""}"
            autocomplete="off" />
          <input type="hidden" data-value value="${attr(focusId || "")}" />
          <ul class="search-results" data-results></ul>
        </div>
        ${focus ? `<button class="ghost" id="chr-clear">مسح التركيز</button>` : ""}
      </div>

      ${focus ? `
        <div class="chr-focus-banner">
          <span>عرض أحداث: <strong data-id="${focusId}">${escapeHTML(focus.fullName)}</strong> ومن نزل منه (${descendantSetOf(focusId).size - 1} من الذرّية)</span>
        </div>` : ""}

      ${filtered.length === 0
        ? `<p class="muted" style="margin-top:20px;">لا توجد أحداث مطابقة. أضف سنوات للولادات/الوفيات/الزيجات لتظهر هنا.</p>`
        : renderTimeline(decadeBuckets)}
    </div>
  `;

  bindFocusPicker(container, options);

  container.querySelector("#chr-clear")?.addEventListener("click", () => {
    focusId = null;
    render(container, options);
  });
  container.querySelectorAll("[data-id]").forEach(el => {
    el.addEventListener("click", e => {
      e.preventDefault();
      e.stopPropagation();
      onSelect(el.dataset.id);
    });
  });
}

function countByType(events) {
  const c = {};
  for (const e of events) c[e.type] = (c[e.type] || 0) + 1;
  return c;
}

function bucketByDecade(events) {
  const buckets = new Map();
  for (const e of events) {
    const decade = Math.floor(e.year / 10) * 10;
    if (!buckets.has(decade)) buckets.set(decade, []);
    buckets.get(decade).push(e);
  }
  return [...buckets.entries()].sort((a, b) => a[0] - b[0]);
}

function renderTimeline(decadeBuckets) {
  return `
    <div class="chr-timeline">
      ${decadeBuckets.map(([decade, events]) => `
        <section class="chr-decade">
          <div class="chr-decade-h">${decade}م</div>
          <div class="chr-events">
            ${events.map(renderEvent).join("")}
          </div>
        </section>
      `).join("")}
    </div>
  `;
}

function renderEvent(ev) {
  // For marriages, the visual indicator is the union symbol (⚭ active /
  // ⚮ dissolved) rather than the word "زواج" — keeps the heritage UI
  // consistent with the spouse listings on profile/outline.
  let label, cls;
  if (ev.type === "marriage") {
    label = ev.dissolved ? "⚮" : "⚭";
    cls = ev.dissolved ? "marriage dissolved" : "marriage";
  } else {
    const typeLabels = {
      birth: ["ميلاد", "birth"],
      death: ["وفاة", "death"],
      custom: ["حدث", "custom"]
    };
    [label, cls] = typeLabels[ev.type] || ["حدث", ""];
  }
  const people = (ev.personIds || []).map(id => {
    const p = getPerson(id);
    if (!p) return "";
    const gen = p.gender === "female" ? "female" : (p.gender === "male" ? "male" : "");
    return `<a class="chr-person ${gen}" data-id="${id}">${escapeHTML(p.fullName)}</a>`;
  }).filter(Boolean).join("، ");

  // For marriage events strip the leading "زواج " from the description so the
  // symbol carries the meaning instead.
  let desc = ev.description;
  if (ev.type === "marriage" && desc?.startsWith("زواج ")) {
    desc = desc.slice("زواج ".length);
  }

  return `
    <article class="chr-event ${cls}">
      <div class="chr-year">${ev.year}م</div>
      <div class="chr-content">
        <span class="ev-type ${cls}">${label}</span>
        <div class="chr-desc">${escapeHTML(desc)}</div>
        ${people ? `<div class="chr-people">${people}</div>` : ""}
      </div>
    </article>
  `;
}

function bindFocusPicker(container, options) {
  const wrap = container.querySelector('[data-picker="chr-focus"]');
  if (!wrap) return;
  const input = wrap.querySelector("[data-input]");
  const hidden = wrap.querySelector("[data-value]");
  const results = wrap.querySelector("[data-results]");

  input.addEventListener("input", () => {
    const q = arabicNormalize(input.value);
    if (!q) {
      results.classList.remove("open");
      hidden.value = "";
      if (focusId) { focusId = null; render(container, options); }
      return;
    }
    const matches = allPeople()
      .filter(p => arabicNormalize(p.fullName).includes(q))
      .slice(0, 12);
    results.innerHTML = matches.map(p =>
      `<li data-id="${p.id}">${escapeHTML(p.fullName)} <span class="meta">— ${escapeHTML(lineageString(p.id))}</span></li>`
    ).join("");
    results.classList.toggle("open", matches.length > 0);
    results.querySelectorAll("li").forEach(li => {
      li.addEventListener("click", () => {
        focusId = li.dataset.id;
        render(container, options);
      });
    });
  });
  document.addEventListener("click", e => {
    if (!wrap.contains(e.target)) results.classList.remove("open");
  });
}

function attr(v) { return v == null ? "" : escapeHTML(String(v)); }
function escapeHTML(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;" }[c]));
}
