// Milk-kinship (الرضاعة) map. Each relation is a card showing the people
// in our tree connected by milk-feeding, plus the named outsiders.

import { getData, getPerson, allPeople, lifespan, lineageString } from "./data.js";

export function render(container, options = {}) {
  const data = getData();
  const onSelect = options.onSelect || (() => {});
  const relations = data.milkRelations || [];

  container.innerHTML = `
    <div class="milk-view">
      <div class="milk-header">
        <h2>خريطة الرضاعة</h2>
        <p class="muted">العلاقات المُسجَّلة بين أفراد العائلة وإخوانهم/أخواتهم بالرضاعة من خارج النَسَب.</p>
      </div>
      ${relations.length === 0
        ? `<p class="muted">لا توجد علاقات رضاعة مُسجَّلة. أضف الإخوة بالرضاعة من نموذج "تعديل" لأي شخص.</p>`
        : `<div class="milk-grid">${relations.map(renderCard).join("")}</div>`}

      <div class="milk-summary">
        ${renderTribesSummary(relations)}
      </div>
    </div>
  `;

  container.querySelectorAll("[data-id]").forEach(el => {
    el.addEventListener("click", e => {
      e.preventDefault();
      onSelect(el.dataset.id);
    });
  });
}

function renderCard(rel) {
  // Two layouts: milk-mother (one mother → many children) and
  // milk-sibling (a person and their unrelated milk-sibling outside the tree).
  if (rel.type === "milk-mother") return renderMilkMotherCard(rel);
  return renderMilkSiblingCard(rel);
}

function renderPersonRow(id, opts = {}) {
  const p = getPerson(id);
  if (!p) return "";
  const span = lifespan(p);
  const cls = p.gender === "female" ? "female" : "male";
  const label = opts.label
    ? `<span class="meta milk-role">${escapeHTML(opts.label)}</span> `
    : "";
  return `
    <div class="milk-card-person">
      ${label}<a class="${cls}" data-id="${id}">${escapeHTML(p.fullName)}</a>
      ${span ? `<span class="meta">(${escapeHTML(span)})</span>` : ""}
      <div class="meta lineage">${escapeHTML(lineageString(id))}</div>
    </div>
  `;
}

function renderMilkMotherCard(rel) {
  const motherId = rel.milkMotherId;
  const motherRow = motherId ? renderPersonRow(motherId, { label: "الأم" }) : "";
  const childIds = rel.personIds || [];
  const childRows = childIds.map(id => renderPersonRow(id)).join("");
  const externalNames = (rel.milkSiblingNames || [])
    .map(n => `<div class="milk-outsider">${escapeHTML(n)}</div>`).join("");
  const totalChildren = childIds.length + (rel.milkSiblingNames || []).length;
  return `
    <article class="milk-card milk-card-mother">
      <header class="milk-card-h">
        <span class="milk-type">أم بالرضاعة</span>
        <span class="milk-count">${totalChildren} طفل</span>
      </header>
      <div class="milk-card-mother-body">
        <div class="milk-mother-block">
          <h4>أرضعَت</h4>
          ${motherRow}
        </div>
        <div class="milk-down-arrow" aria-hidden="true">↓</div>
        <div class="milk-children-block">
          <h4>الأطفال بالرضاعة</h4>
          ${childRows}
          ${externalNames}
        </div>
      </div>
      ${rel.notes ? `<footer class="milk-notes">${escapeHTML(rel.notes)}</footer>` : ""}
    </article>
  `;
}

function renderMilkSiblingCard(rel) {
  const ids = rel.personIds || [];
  const persons = ids.map(id => ({ id, p: getPerson(id) })).filter(x => x.p);
  const siblingNames = rel.milkSiblingNames || [];

  const insideSide = persons.map(({ id }) => renderPersonRow(id)).join("");
  const outsideSide = siblingNames.length
    ? siblingNames.map(n => `<div class="milk-outsider">${escapeHTML(n)}</div>`).join("")
    : `<div class="milk-outsider muted">— غير مذكورين —</div>`;

  return `
    <article class="milk-card">
      <header class="milk-card-h">
        <span class="milk-type">إخوة بالرضاعة</span>
      </header>
      <div class="milk-card-body">
        <div class="milk-side">
          <h4>من العائلة</h4>
          ${insideSide}
        </div>
        <div class="milk-link-viz" aria-hidden="true">
          <span>↔</span>
        </div>
        <div class="milk-side">
          <h4>من خارج العائلة</h4>
          ${outsideSide}
        </div>
      </div>
      ${rel.notes ? `<footer class="milk-notes">${escapeHTML(rel.notes)}</footer>` : ""}
    </article>
  `;
}

function renderTribesSummary(relations) {
  // List the external surnames mentioned across all milk-siblings.
  const surnames = new Set();
  for (const r of relations) {
    for (const name of r.milkSiblingNames || []) {
      const tail = name.replace(/^…\s*/, "").trim().split(/\s+/).pop();
      if (tail && tail.length > 1) surnames.add(tail);
    }
  }
  if (!surnames.size) return "";
  return `
    <div class="milk-tribes">
      <h3>عوائل الرضاعة المذكورة</h3>
      <div class="chips">
        ${[...surnames].map(s => `<span class="chip">${escapeHTML(s)}</span>`).join("")}
      </div>
    </div>
  `;
}

function escapeHTML(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;" }[c]));
}
