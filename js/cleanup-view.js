// Admin-only cleanup tool: list groups of persons that share the same
// normalized fullName, and let the admin delete the duplicate. Uses the
// existing deletePerson() so refs (parent/spouse/marriage) are tidied up.

import {
  getData, getPerson, allChildrenOf, spousesOf, milkRelationsOf,
  findDuplicateGroups, deletePerson, lifespan, lineageString
} from "./data.js";

const root = document.getElementById("modal-root");

export function open(options = {}) {
  render(options);
}

function render(options) {
  const groups = findDuplicateGroups();
  root.innerHTML = `
    <div class="form-modal" id="cleanup-modal">
      <div class="form-card">
        <h2>🧹 تنظيف التكرارات</h2>
        <p class="muted" style="margin: 0 0 16px;">
          المجموعات أدناه تحوي أكثر من شخص بنفس الاسم بعد تطبيق التطبيع (إزالة التشكيل،
          توحيد الألف والياء والهاء). راجع كل مجموعة واضغط <strong>حذف</strong> على المكرر.
          الحذف يفك ارتباط الأبناء والزوجات تلقائيًا فيُحفظ الفرد الباقي سليمًا.
        </p>
        ${groups.length === 0
          ? `<p style="color: var(--ink-soft); padding: 20px; text-align: center; background: rgba(176,137,71,0.06); border-radius: 8px;">
              ✓ لا توجد تكرارات. شجرة العائلة نظيفة.
            </p>`
          : `<div class="cleanup-list">
              ${groups.map(renderGroup).join("")}
             </div>`}
        <div class="actions">
          <button id="cleanup-close" class="primary">إغلاق</button>
        </div>
      </div>
    </div>
  `;

  // Bind delete buttons
  root.querySelectorAll("[data-delete]").forEach(btn => {
    btn.addEventListener("click", () => {
      const id = btn.dataset.delete;
      const p = getPerson(id);
      if (!p) return;
      const yes = confirm(`حذف "${p.fullName}"؟ سيتم فك ارتباط أبنائه/زوجاته. لا يمكن التراجع.`);
      if (!yes) return;
      deletePerson(id);
      if (options.afterDelete) options.afterDelete();
      render(options);  // re-render to reflect updated groups
    });
  });

  root.querySelector("#cleanup-close").addEventListener("click", () => {
    root.innerHTML = "";
    if (options.onClose) options.onClose();
  });
  root.querySelector("#cleanup-modal").addEventListener("click", e => {
    if (e.target.id === "cleanup-modal") {
      root.innerHTML = "";
      if (options.onClose) options.onClose();
    }
  });
}

function renderGroup(group) {
  const sample = getPerson(group.ids[0]);
  return `
    <section class="cleanup-group">
      <h3 class="cleanup-group-h">${escapeHTML(sample.fullName)} <span class="meta">(${group.ids.length} مكرر)</span></h3>
      <div class="cleanup-rows">
        ${group.ids.map(renderRow).join("")}
      </div>
    </section>
  `;
}

function renderRow(id) {
  const p = getPerson(id);
  if (!p) return "";
  const kids = allChildrenOf(id).length;
  const sps = spousesOf(id).length;
  const milk = milkRelationsOf(id).length;
  const span = lifespan(p);
  const lineage = lineageString(id);
  const flags = [];
  if (p.isPlaceholder) flags.push("غير موثّق");
  if (p.external) flags.push("خارجي");
  if (p.notes) flags.push("ملاحظة");
  if (p.events && p.events.length) flags.push(`${p.events.length} حدث`);
  return `
    <div class="cleanup-row">
      <div class="cleanup-row-info">
        <div class="cleanup-row-name">
          ${escapeHTML(p.fullName)}
          ${span ? `<span class="meta"> (${escapeHTML(span)})</span>` : ""}
        </div>
        ${lineage && lineage !== p.fullName ? `<div class="meta">${escapeHTML(lineage)}</div>` : ""}
        <div class="meta">
          ID: <code style="font-family:monospace;">${escapeHTML(id)}</code>
          ${kids ? ` · ${kids} ابن/ة` : ""}
          ${sps ? ` · ${sps} زواج` : ""}
          ${milk ? ` · ${milk} رضاعة` : ""}
          ${flags.length ? ` · ${flags.join("، ")}` : ""}
        </div>
      </div>
      <button class="danger" data-delete="${escapeHTML(id)}">حذف</button>
    </div>
  `;
}

function escapeHTML(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;" }[c]));
}
