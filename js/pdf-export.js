// Builds a print-ready summary into #print-container and triggers window.print().
// User chooses "Save as PDF" in the browser's print dialog. Native browser print
// keeps Arabic shaping/RTL correct without needing a JS PDF library.

import {
  getData, getPerson, allPeople, childrenOf, spousesOf, milkRelationsOf,
  lineageString, lifespan, fullDate, isBirthHidden,
  detectLinkedHeads, collectAllEvents, getInheritedTribalRoot
} from "./data.js";

export function exportSummary() {
  const container = ensureContainer();
  container.innerHTML = buildHTML();
  window.print();
}

function ensureContainer() {
  let div = document.getElementById("print-container");
  if (!div) {
    div = document.createElement("div");
    div.id = "print-container";
    document.body.appendChild(div);
  }
  return div;
}

function buildHTML() {
  const data = getData();
  const stats = computeStats(data);
  const today = new Date().toLocaleDateString("ar-SA-u-nu-arab", {
    year: "numeric", month: "long", day: "numeric"
  });
  const explicit = data.rootIds || [];
  const linkedRoots = detectLinkedHeads();
  const me = data.currentUserId ? getPerson(data.currentUserId) : null;
  const events = collectAllEvents();

  // Resolve the tribal subtitle from the primary root if any.
  const primaryRootId = explicit[0];
  const primaryRoot = primaryRootId ? getPerson(primaryRootId) : null;
  const tribalInfo = primaryRoot ? getInheritedTribalRoot(primaryRootId) : null;
  const tribalRoot = tribalInfo ? getPerson(tribalInfo.rootId) : null;
  const tribalSubtitle = tribalRoot
    ? `${tribalRoot.fullName}${tribalRoot.tribe ? " — من " + tribalRoot.tribe : ""}`
    : "";

  const sharedVisited = new Set();
  const linkedVisited = new Set();

  const documented = allPeople()
    .filter(p => !p.isPlaceholder && hasRichInfo(p))
    .sort((a, b) => (a.birth?.year || 9999) - (b.birth?.year || 9999));

  const sectionDef = [
    { num: "١", id: "stats", title: "إحصائيات", show: true },
    { num: "٢", id: "tree", title: "شجرة النسب الرئيسية", subtitle: "عائلة القصبي", show: explicit.length > 0 },
    { num: "٣", id: "linked", title: "العوائل المرتبطة بالنسب", subtitle: `${linkedRoots.length} فرع`, show: linkedRoots.length > 0 },
    { num: "٤", id: "milk", title: "خريطة الرضاعة", subtitle: `${(data.milkRelations || []).length} علاقة`, show: (data.milkRelations || []).length > 0 },
    { num: "٥", id: "chrono", title: "الأحداث التاريخية", subtitle: `${events.length} حدث`, show: events.length > 0 },
    { num: "٦", id: "bios", title: "سِيَر مختصرة", subtitle: `${documented.length} ترجمة`, show: documented.length > 0 }
  ].filter(s => s.show);

  // Renumber after filtering
  sectionDef.forEach((s, i) => { s.num = toArabicDigits(i + 1); });

  return `
    <article class="print-doc">
      ${renderCover({ today, me, stats, tribalSubtitle })}
      ${renderTOC(sectionDef)}
      ${sectionDef.find(s => s.id === "stats") ? renderStatsSection(sectionDef.find(s => s.id === "stats"), stats) : ""}
      ${sectionDef.find(s => s.id === "tree") ? renderTreeSection(sectionDef.find(s => s.id === "tree"), explicit, sharedVisited, data) : ""}
      ${sectionDef.find(s => s.id === "linked") ? renderLinkedSection(sectionDef.find(s => s.id === "linked"), linkedRoots, linkedVisited) : ""}
      ${sectionDef.find(s => s.id === "milk") ? renderMilkSection(sectionDef.find(s => s.id === "milk"), data.milkRelations || []) : ""}
      ${sectionDef.find(s => s.id === "chrono") ? renderChronoSection(sectionDef.find(s => s.id === "chrono"), events) : ""}
      ${sectionDef.find(s => s.id === "bios") ? renderBiosSection(sectionDef.find(s => s.id === "bios"), documented) : ""}
    </article>
  `;
}

// --- COVER PAGE ---
function renderCover({ today, me, stats, tribalSubtitle }) {
  return `
    <section class="print-cover">
      <div class="cover-decoration top">
        <span class="ornament">✦</span>
      </div>
      <p class="cover-draft-tag">مسودة</p>
      <h1 class="cover-title">شجرة عائلة<br/>عثمان بن عبدالله بن عبدالعزيز القصبي<br/><span class="cover-rahem">وأرحامهم وأصهارهم</span></h1>
      <p class="cover-draft-note">بانتظار التعديلات والإضافات</p>
      ${tribalSubtitle ? `<p class="cover-subtitle">${escapeHTML(tribalSubtitle)}</p>` : ""}

      <div class="cover-disclaimer">
        <strong>تنويه:</strong> يهدف هذا العمل التوثيقي إلى حصر وجمع كافة أفراد عائلة آل عثمان بن عبدالله القصبي، ويشمل الذرّية والأرحام والأصهار.
      </div>

      <div class="cover-stat-row">
        <div class="cover-stat">
          <span class="num">${stats.total}</span>
          <span class="lbl">شخص</span>
        </div>
        <div class="cover-stat">
          <span class="num">${stats.maxDepth}</span>
          <span class="lbl">جيل</span>
        </div>
        <div class="cover-stat">
          <span class="num">${stats.marriages}</span>
          <span class="lbl">زواج</span>
        </div>
        <div class="cover-stat">
          <span class="num">${stats.documented}</span>
          <span class="lbl">موثّق</span>
        </div>
      </div>

      <div class="cover-meta">
        <p><span class="meta-lbl">تاريخ التوليد:</span> ${escapeHTML(today)}</p>
        ${me ? `<p><span class="meta-lbl">الشخص الحالي:</span> <strong>${escapeHTML(me.fullName)}</strong></p>` : ""}
      </div>

      <div class="cover-decoration bottom">
        <span class="ornament">✦</span>
      </div>
    </section>
  `;
}

// --- TABLE OF CONTENTS ---
function renderTOC(sectionDef) {
  return `
    <section class="print-toc">
      <h2 class="toc-title">المحتويات</h2>
      <ol class="toc-list">
        ${sectionDef.map(s => `
          <li>
            <span class="toc-num">${s.num}</span>
            <span class="toc-name">${escapeHTML(s.title)}</span>
            ${s.subtitle ? `<span class="toc-sub">${escapeHTML(s.subtitle)}</span>` : ""}
          </li>
        `).join("")}
      </ol>
    </section>
  `;
}

// --- SECTION HEADER (consistent across sections) ---
function sectionHeader(s) {
  return `
    <header class="section-header">
      <div class="section-bar"></div>
      <h2><span class="section-num">${s.num}</span><span class="section-title">${escapeHTML(s.title)}</span></h2>
      ${s.subtitle ? `<p class="section-sub">${escapeHTML(s.subtitle)}</p>` : ""}
    </header>
  `;
}

// --- STATS ---
function renderStatsSection(s, stats) {
  const cards = [
    { num: stats.total,      lbl: "إجمالي الأشخاص" },
    { num: stats.documented, lbl: "أشخاص موثّقون" },
    { num: stats.male,       lbl: "ذكور" },
    { num: stats.female,     lbl: "إناث" },
    { num: stats.marriages,  lbl: "زيجات" },
    { num: stats.milk,       lbl: "علاقات رضاعة" },
    { num: stats.maxDepth,   lbl: "أجيال" },
    { num: stats.earliestBirth || "—", lbl: "أقدم ميلاد موثّق", small: true },
    { num: stats.latestBirth || "—",   lbl: "أحدث ميلاد موثّق", small: true }
  ];
  return `
    <section class="print-section section-stats">
      ${sectionHeader(s)}
      <div class="stats-grid">
        ${cards.map(c => `
          <div class="stat-card${c.small ? " small" : ""}">
            <span class="stat-num">${escapeHTML(String(c.num))}</span>
            <span class="stat-lbl">${escapeHTML(c.lbl)}</span>
          </div>
        `).join("")}
      </div>
    </section>
  `;
}

// --- TREE ---
function renderTreeSection(s, explicit, visited, data) {
  return `
    <section class="print-section section-tree">
      ${sectionHeader(s)}
      <div class="tree-body">
        ${explicit.map(id => renderBranch(id, visited, 0)).join("")}
      </div>
    </section>
  `;
}

function renderBranch(id, visited, depth) {
  if (visited.has(id)) return "";
  visited.add(id);
  const p = getPerson(id);
  if (!p) return "";

  const data = getData();
  const isCurrent = data.currentUserId === id;
  const span = lifespan(p);
  const spouses = spousesOf(id);
  const kids = childrenOf(id);
  const genderClass = p.gender === "female" ? "female" : (p.gender === "male" ? "male" : "");
  const phClass = p.isPlaceholder ? "placeholder" : "";
  const meClass = isCurrent ? "current-user" : "";

  const spousePart = spouses.map(sp => {
    const spouse = getPerson(sp.spouseId);
    if (!spouse) return "";
    const yr = sp.marriage.year ? ` <span class="m-year">(${escapeHTML(String(sp.marriage.year))})</span>` : "";
    const sym = sp.marriage.dissolved ? "⚮" : "⚭";
    const cls = sp.marriage.dissolved ? "print-spouse dissolved" : "print-spouse";
    return ` <span class="${cls}">${sym} ${escapeHTML(spouse.fullName)}${spouse.tribe ? ` <span class="t">— ${escapeHTML(spouse.tribe)}</span>` : ""}${yr}</span>`;
  }).join("");

  let html = `<div class="tree-line ${genderClass} ${phClass} ${meClass}">`;
  html += `<span class="tree-bullet">${depth === 0 ? "❖" : "•"}</span>`;
  html += `<span class="print-name">${escapeHTML(p.fullName)}</span>`;
  if (isCurrent) html += ` <span class="me-tag">(أنا)</span>`;
  if (span) html += ` <span class="print-meta">(${escapeHTML(span)})</span>`;
  if (p.kunya) html += ` <span class="print-meta">— ${escapeHTML(p.kunya)}</span>`;
  if (p.tribe && !p.fullName.includes(p.tribe)) html += ` <span class="print-meta tribe">— ${escapeHTML(p.tribe)}</span>`;
  html += spousePart;
  html += `</div>`;

  if (kids.length) {
    html += `<div class="tree-children">`;
    for (const k of kids) html += renderBranch(k.id, visited, depth + 1);
    html += `</div>`;
  }
  return html;
}

// --- LINKED FAMILIES ---
function renderLinkedSection(s, rootIds, visited) {
  const groups = new Map();
  for (const id of rootIds) {
    const p = getPerson(id);
    if (!p) continue;
    const key = p.family || p.tribe || "أخرى";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(id);
  }
  const sorted = [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0], "ar"));
  return `
    <section class="print-section section-linked">
      ${sectionHeader(s)}
      <div class="linked-grid">
        ${sorted.map(([surname, ids]) => `
          <div class="linked-card">
            <h3 class="linked-card-h">${escapeHTML(surname)}</h3>
            <div class="linked-card-body">
              ${ids.map(id => renderBranch(id, visited, 0)).join("")}
            </div>
          </div>
        `).join("")}
      </div>
    </section>
  `;
}

// --- MILK KINSHIP ---
function renderMilkSection(s, relations) {
  return `
    <section class="print-section section-milk">
      ${sectionHeader(s)}
      <div class="milk-grid">
        ${relations.map(renderMilkBlock).join("")}
      </div>
    </section>
  `;
}

function renderMilkBlock(rel) {
  if (rel.type === "milk-mother") return renderMilkMotherBlock(rel);
  return renderMilkSiblingBlock(rel);
}

function renderMilkMotherBlock(rel) {
  const mother = rel.milkMotherId ? getPerson(rel.milkMotherId) : null;
  const children = (rel.personIds || []).map(id => getPerson(id)).filter(Boolean);
  const externals = rel.milkSiblingNames || [];
  return `
    <div class="milk-card milk-card-mother">
      <header class="milk-card-h">
        <span class="milk-type-pill">أم بالرضاعة</span>
      </header>
      ${mother ? `
        <div class="milk-mother-line">
          <strong>أرضعَت:</strong>
          ${escapeHTML(mother.fullName)}
          ${lifespan(mother) ? `<span class="milk-meta">(${escapeHTML(lifespan(mother))})</span>` : ""}
        </div>` : ""}
      <div class="milk-children-list">
        <strong>الأطفال بالرضاعة:</strong>
        <ul>
          ${children.map(c => `<li>${escapeHTML(c.fullName)}${lifespan(c) ? ` <span class="milk-meta">(${escapeHTML(lifespan(c))})</span>` : ""}</li>`).join("")}
          ${externals.map(n => `<li><em>${escapeHTML(n)}</em> (خارج الشجرة)</li>`).join("")}
        </ul>
      </div>
      ${rel.notes ? `<footer class="milk-notes"><em>${escapeHTML(rel.notes)}</em></footer>` : ""}
    </div>
  `;
}

function renderMilkSiblingBlock(rel) {
  const insiders = (rel.personIds || []).map(id => ({ id, p: getPerson(id) })).filter(x => x.p);
  const outsiders = rel.milkSiblingNames || [];
  return `
    <div class="milk-card">
      <header class="milk-card-h">
        <span class="milk-type-pill">إخوة بالرضاعة</span>
      </header>
      <div class="milk-card-body">
        <div class="milk-side">
          <h4>من العائلة</h4>
          ${insiders.map(({ p }) => `
            <div class="milk-person">
              <span class="milk-name">${escapeHTML(p.fullName)}</span>
              ${lifespan(p) ? `<span class="milk-meta">(${escapeHTML(lifespan(p))})</span>` : ""}
            </div>
          `).join("")}
        </div>
        <div class="milk-link"><span>↔</span></div>
        <div class="milk-side">
          <h4>من خارج العائلة</h4>
          ${outsiders.length
            ? outsiders.map(n => `<div class="milk-outsider">${escapeHTML(n)}</div>`).join("")
            : `<div class="milk-outsider muted">— غير مذكورين —</div>`}
        </div>
      </div>
      ${rel.notes ? `<footer class="milk-notes"><em>${escapeHTML(rel.notes)}</em></footer>` : ""}
    </div>
  `;
}

// --- CHRONOLOGY ---
function renderChronoSection(s, events) {
  const buckets = new Map();
  for (const e of events) {
    const decade = Math.floor(e.year / 10) * 10;
    if (!buckets.has(decade)) buckets.set(decade, []);
    buckets.get(decade).push(e);
  }
  const sorted = [...buckets.entries()].sort((a, b) => a[0] - b[0]);
  return `
    <section class="print-section section-chrono">
      ${sectionHeader(s)}
      <div class="chrono-timeline">
        ${sorted.map(([decade, evs]) => `
          <div class="chrono-decade">
            <div class="chrono-decade-h">${decade}م</div>
            <ul class="chrono-events">
              ${evs.map(e => {
                // Resolve all person names for the event. Custom-event
                // descriptions (e.g., "تخرّج من الجامعة") don't include
                // the person's name, so we surface it below the line.
                // Birth/death/marriage descriptions already embed names,
                // so we still surface them as a secondary line for clarity
                // when scanning the PDF — same idea as the on-screen chips.
                const names = (e.personIds || [])
                  .map(id => getPerson(id)?.fullName)
                  .filter(Boolean)
                  .join("، ");
                return `
                  <li class="chrono-event ${e.type}">
                    <div class="chrono-event-line">
                      <span class="chrono-year">${e.year}م</span>
                      <span class="chrono-badge ${e.type}">${typeLabel(e.type)}</span>
                      <span class="chrono-desc">${escapeHTML(e.description)}</span>
                    </div>
                    ${names ? `<div class="chrono-event-persons">⤷ ${escapeHTML(names)}</div>` : ""}
                  </li>
                `;
              }).join("")}
            </ul>
          </div>
        `).join("")}
      </div>
    </section>
  `;
}

function typeLabel(type) {
  return ({
    birth: "ميلاد",
    death: "وفاة",
    marriage: "زواج",
    custom: "حدث"
  })[type] || "حدث";
}

// --- BIOS ---
function renderBiosSection(s, documented) {
  return `
    <section class="print-section section-bios">
      ${sectionHeader(s)}
      <div class="bios-grid">
        ${documented.map(renderBio).join("")}
      </div>
    </section>
  `;
}

function renderBio(p) {
  const span = lifespan(p);
  const milk = milkRelationsOf(p.id || "");
  const fields = [];
  if (p.kunya)   fields.push({ k: "الكنية",  v: p.kunya });
  if (p.alias)   fields.push({ k: "الشهرة",  v: p.alias });
  if (!isBirthHidden(p) && p.birth)
    fields.push({ k: "الميلاد", v: `${fullDate(p.birth)}${p.birth.place ? " — " + p.birth.place : ""}` });
  if (p.death)   fields.push({ k: "الوفاة",  v: `${fullDate(p.death)}${p.death.place ? " — " + p.death.place : ""}` });
  if (p.places && p.places.length) fields.push({ k: "الأماكن", v: p.places.join("، ") });
  if (p.occupations && p.occupations.length) fields.push({ k: "المهن", v: p.occupations.join("، ") });
  if (p.tribe)   fields.push({ k: "القبيلة", v: p.tribe });
  if (milk.length) {
    const names = (milk[0].milkSiblingNames || []).join("، ") || "(غير مذكور)";
    fields.push({ k: "الرضاعة", v: names + (milk[0].notes ? " — " + milk[0].notes : "") });
  }

  return `
    <article class="bio">
      <header class="bio-header">
        <h3>${escapeHTML(p.fullName)}${span ? ` <span class="bio-span">(${escapeHTML(span)})</span>` : ""}</h3>
        <p class="bio-lineage">${escapeHTML(lineageString(p.id))}</p>
      </header>
      ${fields.length ? `
        <dl class="bio-fields">
          ${fields.map(f => `<dt>${escapeHTML(f.k)}</dt><dd>${escapeHTML(f.v)}</dd>`).join("")}
        </dl>` : ""}
      ${p.events && p.events.length ? `
        <div class="bio-events">
          <h4>الأحداث الحياتية</h4>
          <ul>${p.events.slice().sort((a,b) => (a.year||0)-(b.year||0))
            .map(e => `<li><strong>${e.year || "؟"}م</strong> — ${escapeHTML(e.label || "")}</li>`).join("")}
          </ul>
        </div>` : ""}
      ${p.notes ? `<p class="bio-notes">${escapeHTML(p.notes)}</p>` : ""}
    </article>
  `;
}

// --- HELPERS ---
function computeStats(data) {
  const people = Object.values(data.people);
  const documented = people.filter(p => !p.isPlaceholder).length;
  const male = people.filter(p => p.gender === "male").length;
  const female = people.filter(p => p.gender === "female").length;
  const births = people.map(p => p.birth?.year).filter(Boolean);
  return {
    total: people.length,
    documented,
    male,
    female,
    marriages: data.marriages.length,
    milk: (data.milkRelations || []).length,
    earliestBirth: births.length ? Math.min(...births) : null,
    latestBirth: births.length ? Math.max(...births) : null,
    maxDepth: computeMaxDepth(data)
  };
}

function computeMaxDepth(data) {
  const memo = new Map();
  function depth(id) {
    if (memo.has(id)) return memo.get(id);
    memo.set(id, 1);
    const kids = childrenOf(id);
    const d = kids.length === 0 ? 1 : 1 + Math.max(...kids.map(k => depth(k.id)));
    memo.set(id, d);
    return d;
  }
  let max = 0;
  for (const id of Object.keys(data.people)) {
    if (!data.people[id].fatherId && !data.people[id].motherId) {
      const d = depth(id);
      if (d > max) max = d;
    }
  }
  return max;
}

function hasRichInfo(p) {
  return Boolean(
    p.notes ||
    (p.places && p.places.length) ||
    (p.occupations && p.occupations.length) ||
    p.kunya || p.alias ||
    (p.events && p.events.length) ||
    (p.birth?.year && p.death?.year)
  );
}

function toArabicDigits(n) {
  return String(n).replace(/[0-9]/g, c => "٠١٢٣٤٥٦٧٨٩"[+c]);
}

function escapeHTML(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;" }[c]));
}
