// Person profile: full name, lineage, lifespan, places, occupations,
// notes, parents, spouses, siblings, children, milk-kinship.

import {
  getPerson, allChildrenOf, spousesOf, siblingsOf, milkRelationsOf,
  lineageString, lifespan, fullDate, isBirthHidden, deletePerson, getData,
  getInheritedTribalRoot
} from "./data.js";

let onSelectCb = null;
let onEditCb = null;

export function render(container, id, options = {}) {
  onSelectCb = options.onSelect || null;
  onEditCb = options.onEdit || null;

  const p = getPerson(id);
  if (!p) {
    container.innerHTML = `<div class="profile"><p>الشخص غير موجود.</p></div>`;
    return;
  }
  const father = p.fatherId ? getPerson(p.fatherId) : null;
  const mother = p.motherId ? getPerson(p.motherId) : null;
  const kids = allChildrenOf(id);
  const spouses = spousesOf(id);
  const sibs = siblingsOf(id);
  const milks = milkRelationsOf(id);
  const isCurrent = getData().currentUserId === id;

  container.innerHTML = `
    <div class="profile">
      <div class="header-actions">
        ${onEditCb ? `<button id="pf-edit">تعديل</button>` : ""}
        <button id="pf-mark-self" class="ghost">${isCurrent ? "✓ هذا أنا" : "تعيين كأنا"}</button>
        <button id="pf-delete" class="danger ghost">حذف</button>
      </div>
      <h2>${escapeHTML(p.fullName)}${p.isPlaceholder ? ` <span class="meta" style="color:var(--placeholder); font-size:0.7em;">— ${p.gender === "female" ? "غير موثّقة" : "غير موثّق"}</span>` : ""}</h2>
      <div class="lineage">${escapeHTML(lineageString(id))}</div>
      ${p.kunya || p.alias ? `<div class="lineage">${[p.kunya && `الكنية: ${p.kunya}`, p.alias && `الشهرة: ${p.alias}`].filter(Boolean).map(escapeHTML).join(" — ")}</div>` : ""}

      <dl>
        ${row("الجنس", p.gender === "male" ? "ذكر" : (p.gender === "female" ? "أنثى" : ""))}
        ${row("الميلاد", birthRow(p))}
        ${row("الوفاة", deathRow(p))}
        ${row("القبيلة", p.tribe)}
        ${row("الأماكن", (p.places || []).join("، "))}
        ${row("المهن", (p.occupations || []).join("، "))}
      </dl>

      ${Array.isArray(p.events) && p.events.length ? `
        <div class="section">
          <h3>الأحداث الحياتية (${p.events.length})</h3>
          <ul class="events-list">
            ${p.events.slice().sort((a,b) => (a.year||0)-(b.year||0)).map(e => `
              <li><span class="ev-year">${e.year || "؟"}م</span> — ${escapeHTML(e.label || "")}</li>
            `).join("")}
          </ul>
        </div>` : ""}

      ${p.notes ? `<div class="section"><h3>ملاحظات</h3><div class="notes">${escapeHTML(p.notes)}</div></div>` : ""}

      <div class="section">
        <h3>الأبوان</h3>
        <ul class="relation-list">
          ${father ? personLink(father, p.fatherId, "الأب") : `<li class="meta">الأب غير موثّق</li>`}
          ${mother ? personLink(mother, p.motherId, "الأم") : `<li class="meta">الأم غير موثّقة</li>`}
        </ul>
      </div>

      ${(() => {
        const inh = getInheritedTribalRoot(id);
        if (!inh) return "";
        const root = getPerson(inh.rootId);
        if (!root) return "";
        const viaSelf = inh.viaId === id;
        const via = !viaSelf ? getPerson(inh.viaId) : null;
        const tribePart = root.tribe ? ` <span class="meta">— من ${escapeHTML(root.tribe)}</span>` : "";
        return `
          <div class="section">
            <h3>الأصل القبلي</h3>
            <ul class="relation-list">
              <li><span class="meta">الجد القبلي:</span> <a class="${root.gender === "female" ? "female" : "male"}" data-id="${inh.rootId}">${escapeHTML(root.fullName)}</a>${tribePart}</li>
              ${via ? `<li><span class="meta">عبر:</span> <a class="${via.gender === "female" ? "female" : "male"}" data-id="${inh.viaId}">${escapeHTML(via.fullName)}</a></li>` : ""}
            </ul>
            <p class="meta" style="font-size:0.88em; margin: 4px 0 0;">يلتقي في النسب القبلي عبر أجيال وسيطة غير موثّقة.</p>
          </div>`;
      })()}

      ${spouses.length ? `
        <div class="section">
          <h3>الزواج</h3>
          <ul class="relation-list">
            ${spouses.map(s => {
              const sp = getPerson(s.spouseId);
              if (!sp) return "";
              // Visual indicators only (no words for marriage/divorce):
              //   ⚭ U+26AD = active marriage
              //   ⚮ U+26AE = dissolved (divorce or separation)
              const isDissolved = s.marriage.dissolved === true;
              const symbol = isDissolved
                ? `<span class="union-symbol dissolved" title="مفسوخ">⚮</span>`
                : `<span class="union-symbol active" title="قائم">⚭</span>`;
              const orderTag = s.marriage.order
                ? ` <span class="union-order">${toArabicDigit(s.marriage.order)}</span>`
                : "";
              const lbl = `${symbol}${orderTag}`;
              return personLink(sp, s.spouseId, lbl, true);
            }).join("")}
          </ul>
        </div>` : ""}

      ${kids.length ? `
        <div class="section">
          <h3>${pluralLabel(kids, "ابن", "بنت", "ابناء/بنات")} (${kids.length})</h3>
          <ul class="relation-list">
            ${kids.map(k => personLink(k, k.id)).join("")}
          </ul>
        </div>` : ""}

      ${sibs.length ? `
        <div class="section">
          <h3>${pluralLabel(sibs, "أخ", "أخت", "إخوة/أخوات")} (${sibs.length})</h3>
          <ul class="relation-list">
            ${sibs.map(s => personLink(s, s.id)).join("")}
          </ul>
        </div>` : ""}

      ${milks.length ? `
        <div class="section">
          <h3>الرضاعة</h3>
          <ul class="relation-list">
            ${milks.map(r => `<li>
              <span class="meta">${r.type === "milk-mother" ? "أم بالرضاعة" : "إخوة بالرضاعة"}:</span>
              ${(r.milkSiblingNames || []).map(escapeHTML).join("، ") || "<span class='meta'>غير مذكورين</span>"}
              ${r.notes ? `<div class="meta" style="font-size:0.85em;">${escapeHTML(r.notes)}</div>` : ""}
            </li>`).join("")}
          </ul>
        </div>` : ""}
    </div>
  `;

  container.querySelectorAll("[data-id]").forEach(el => {
    el.addEventListener("click", e => {
      e.preventDefault();
      if (onSelectCb) onSelectCb(el.dataset.id);
    });
  });

  container.querySelector("#pf-edit")?.addEventListener("click", () => {
    if (onEditCb) onEditCb(id);
  });
  container.querySelector("#pf-mark-self")?.addEventListener("click", () => {
    const data = getData();
    data.currentUserId = isCurrent ? null : id;
    render(container, id, options);
    // notify listeners — simulate a data event
    if (options.onChange) options.onChange();
  });
  container.querySelector("#pf-delete")?.addEventListener("click", () => {
    if (!confirm(`حذف "${p.fullName}"؟ سيتم فك ارتباط أبنائه/أزواجه. لا يمكن التراجع.`)) return;
    deletePerson(id);
    if (options.onDelete) options.onDelete();
  });
}

function row(label, value) {
  if (!value) return "";
  return `<dt>${escapeHTML(label)}</dt><dd>${escapeHTML(value)}</dd>`;
}

// Choose a plural label that matches the group's gender:
// - all male / unknown → masculine ("الأبناء")
// - all female → feminine ("البنات")
// - mixed → masculine (Arabic default)
// One single person uses the singular form.
function pluralLabel(arr, singularM, singularF, mixedPlural) {
  if (arr.length === 1) {
    return arr[0].gender === "female" ? singularF : singularM;
  }
  const allFemale = arr.every(p => p.gender === "female");
  if (allFemale) {
    if (singularF === "بنت") return "البنات";
    if (singularF === "أخت") return "الأخوات";
  }
  if (singularM === "ابن") return "الأبناء";
  if (singularM === "أخ") return "الإخوة";
  return mixedPlural;
}

function birthRow(p) {
  if (!p.birth || isBirthHidden(p)) return "";
  const date = fullDate(p.birth);
  const place = p.birth.place || "";
  return [date, place].filter(Boolean).join(" — ");
}
function deathRow(p) {
  if (!p.death) return "";
  const date = fullDate(p.death);
  const place = p.death.place || "";
  return [date, place].filter(Boolean).join(" — ");
}

function personLink(person, id, label = null, labelIsHTML = false) {
  const cls = person.gender === "female" ? "female" : "male";
  const ph = person.isPlaceholder ? "placeholder" : "";
  const labelInner = label ? (labelIsHTML ? label : escapeHTML(label)) : "";
  const lbl = label ? `<span class="meta">${labelInner}</span> ` : "";
  const span = lifespan(person);
  const meta = span ? ` <span class="meta">(${escapeHTML(span)})</span>` : "";
  return `<li>${lbl}<a class="${cls} ${ph}" data-id="${id}">${escapeHTML(person.fullName)}</a>${meta}</li>`;
}

function toArabicDigit(n) {
  const map = ["٠","١","٢","٣","٤","٥","٦","٧","٨","٩"];
  return String(n).split("").map(d => map[+d] ?? d).join("");
}

function escapeHTML(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;" }[c]));
}
