// Indented, collapsible Arabic-first outline. Walks down via patrilineal
// AND matrilineal links so a Qassabi daughter's children appear under her
// in the main tab AND under their non-Qassabi father in the الأنساب tab.

import {
  getData, getPerson, childrenOf, spousesOf, milkRelationsOf,
  lifespan, detectLinkedHeads
} from "./data.js";

const COLLAPSED = new Set();
// Currently selected generation depth (null = no auto-collapse applied).
let SELECTED_DEPTH = null;

// mode: "primary" (default) → الأبناء (Qassabi via rootIds)
//       "linked"             → الأنساب (non-Qassabi heads, grouped by surname)
//       "all"                → both, deduplicated
export function render(container, options = {}) {
  const data = getData();
  if (!data) return;
  const mode = options.mode || "primary";
  const explicit = data.rootIds || [];
  const visited = new Set();  // shared across the whole render to avoid duplicates

  // Resolve which roots drive this render (used both for rendering and depth chips).
  let activeRoots;
  if (mode === "linked") {
    activeRoots = detectLinkedHeads();
  } else if (mode === "all") {
    const detected = detectAllRoots();
    activeRoots = Array.from(new Set([...explicit, ...detected]));
  } else {
    activeRoots = explicit;
  }

  // Generation chips: depth 1..maxDepth — selecting depth N collapses every
  // person at depth ≥ N so their children hide, leaving exactly N visible levels.
  const depths = computeDepths(activeRoots);
  const maxDepth = depths.size ? Math.max(...depths.values()) + 1 : 0;
  const labels = inferGenerationLabels(activeRoots, maxDepth);
  const depthChipsHTML = renderDepthChips(maxDepth, labels);

  let header, body;

  if (mode === "linked") {
    header = `العوائل المرتبطة بالنسب (${activeRoots.length} فرع)`;
    body = activeRoots.length
      ? renderGroupedLinked(activeRoots, visited)
      : `<p style="color:var(--ink-soft);">لا توجد أنساب مرتبطة بعد. أضف زواجًا لشخص خارج عائلة القصبي وستظهر هنا.</p>`;
  } else if (mode === "all") {
    header = `${count()} شخصًا`;
    body = `<ul>${activeRoots.map(id => renderNode(id, visited)).join("")}</ul>`;
  } else {
    header = `${count()} شخصًا في القاعدة الأساسية`;
    body = `<ul>${activeRoots.map(id => renderNode(id, visited)).join("")}</ul>`;
  }

  container.innerHTML = `
    <div class="outline">
      <div class="outline-toolbar">
        <button id="ol-expand-all" class="ghost">📖 توسيع الكل</button>
        <button id="ol-collapse-all" class="ghost">📕 طيّ الكل</button>
        <span class="outline-count">${header}</span>
      </div>
      ${depthChipsHTML}
      ${body}
    </div>
  `;
  bind(container, options);
}

// BFS from each root through childrenOf, depth=0 at root.
function computeDepths(rootIds) {
  const depths = new Map();
  const queue = (rootIds || []).map(id => ({ id, d: 0 }));
  while (queue.length) {
    const { id, d } = queue.shift();
    if (depths.has(id)) continue;
    depths.set(id, d);
    for (const k of childrenOf(id) || []) {
      queue.push({ id: k.id, d: d + 1 });
    }
  }
  return depths;
}

// Build human labels for each generation depth. Tries to anchor on the
// primary "patriarch" — the deepest single-line ancestor before the family
// fans out (e.g., root=Abdulaziz → only child=Othman → Othman's children
// fan out, so Othman is the anchor and depth 2 = "ابناء عثمان").
function inferGenerationLabels(rootIds, maxDepth) {
  const labels = {};
  // Find anchor: walk down while there's exactly 1 child; stop at the first
  // person with multiple children (or at maxDepth).
  let anchorId = null, anchorDepth = 0;
  if (rootIds && rootIds.length === 1) {
    let cur = rootIds[0];
    let d = 0;
    while (cur) {
      const kids = childrenOf(cur) || [];
      if (kids.length !== 1) { anchorId = cur; anchorDepth = d; break; }
      cur = kids[0].id;
      d++;
    }
  }
  const anchor = anchorId ? getPerson(anchorId) : null;
  const anchorName = anchor?.given || anchor?.fullName?.split(" ")[0] || "";

  for (let n = 1; n <= maxDepth; n++) {
    // n = number of generations visible (root counts as 1).
    // Generation N relative to anchor = N - anchorDepth - 1
    const relGen = n - anchorDepth - 1;
    if (anchorName && relGen === 1) labels[n] = `أبناء ${anchorName}`;
    else if (anchorName && relGen === 2) labels[n] = `أحفاد ${anchorName}`;
    else if (anchorName && relGen === 3) labels[n] = `أبناء أحفاد ${anchorName}`;
    else if (anchorName && relGen === 4) labels[n] = `أحفاد الأحفاد`;
    else if (anchorName && relGen >= 5) labels[n] = `الجيل ${toArabicDigits(relGen + 1)}`;
    else labels[n] = `الجيل ${toArabicDigits(n)}`;
  }
  return labels;
}

function toArabicDigits(n) {
  const map = ["٠","١","٢","٣","٤","٥","٦","٧","٨","٩"];
  return String(n).split("").map(d => map[+d] ?? d).join("");
}

function renderDepthChips(maxDepth, labels) {
  if (maxDepth < 2) return "";
  const chips = [];
  for (let n = 1; n <= maxDepth; n++) {
    const isActive = SELECTED_DEPTH === n;
    chips.push(`<button class="depth-chip${isActive ? " active" : ""}" data-depth="${n}" title="${escapeHTML(labels[n])}">${escapeHTML(labels[n])}</button>`);
  }
  return `<div class="outline-depth-bar"><span class="depth-bar-label">إظهار حتى:</span>${chips.join("")}</div>`;
}

// Apply "expand to depth N": every person at BFS depth ≥ N is collapsed.
function applyDepth(n, activeRoots) {
  SELECTED_DEPTH = n;
  COLLAPSED.clear();
  const depths = computeDepths(activeRoots);
  for (const [id, d] of depths) {
    if (d >= n) COLLAPSED.add(id);
  }
}

function detectAllRoots() {
  const data = getData();
  return Object.entries(data.people)
    .filter(([id, p]) => !p.fatherId && childrenOf(id).length > 0)
    .map(([id]) => id);
}

function renderGroupedLinked(headIds, visited) {
  const groups = new Map();
  for (const id of headIds) {
    const p = getPerson(id);
    if (!p) continue;
    const key = p.family || p.tribe || "أخرى";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(id);
  }
  const sortedGroups = [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0], "ar"));
  return sortedGroups.map(([surname, ids]) => `
    <section class="linked-group">
      <h3 class="linked-group-h">${escapeHTML(surname)}${groupBadge(ids)}</h3>
      <ul>
        ${ids.map(id => renderNode(id, visited)).join("")}
      </ul>
    </section>
  `).join("");
}

function groupBadge(ids) {
  const heads = ids.map(getPerson).filter(Boolean);
  const tribes = [...new Set(heads.map(p => p.tribe).filter(Boolean))];
  return tribes.length ? ` <span class="meta" style="font-weight:400;">— ${escapeHTML(tribes.join("، "))}</span>` : "";
}

function count() { return Object.keys(getData().people).length; }

function renderNode(id, visited) {
  if (visited.has(id)) return "";
  visited.add(id);

  const p = getPerson(id);
  if (!p) return "";

  const kids = childrenOf(id);
  const spouses = spousesOf(id);
  const milk = milkRelationsOf(id);
  const collapsed = COLLAPSED.has(id);
  const hasKids = kids.length > 0;

  const genderClass = p.gender === "female" ? "female" : (p.gender === "male" ? "male" : "");
  const placeholderClass = p.isPlaceholder ? "placeholder" : "";
  const span = lifespan(p);

  const kidCount = kids.length;
  let html = `<li>`;

  // --- Person row: [toggle] [name (dates)] ---
  html += `<div class="ol-row">`;
  html += `<button class="toggle ${hasKids ? "has-kids" : "leaf"}" data-toggle="${id}" aria-label="${hasKids ? (collapsed ? "توسيع" : "طيّ") : ""}">${hasKids ? (collapsed ? "▸" : "▾") : "•"}</button>`;
  html += `<span class="node ${genderClass} ${placeholderClass}" data-id="${id}">`;
  html += `<span class="name">${escapeHTML(p.fullName || p.given || id)}</span>`;
  if (span) html += `<span class="meta dates">(${escapeHTML(span)})</span>`;
  if (p.tribe) html += `<span class="meta tribe">${escapeHTML(p.tribe)}</span>`;
  // When collapsed, show how many descendants-children are hidden.
  if (hasKids && collapsed) html += `<span class="kid-badge">${toArabicDigits(kidCount)}</span>`;
  html += `</span>`;
  html += `</div>`;

  // --- Spouse sub-rows (one per line, under the person) ---
  for (const { spouseId, marriage } of spouses) {
    const sp = getPerson(spouseId);
    if (!sp) continue;
    const yr = marriage.year ? ` <span class="m-year">${marriage.year}م</span>` : "";
    const sym = marriage.dissolved ? "⚮" : "⚭";
    const symCls = marriage.dissolved ? "union-symbol dissolved" : "union-symbol active";
    html += `<div class="ol-subrow spouse-row">`;
    html += `<span class="${symCls}">${sym}</span>`;
    html += `<a class="marriage-link${marriage.dissolved ? " dissolved" : ""}" data-id="${spouseId}">${escapeHTML(sp.fullName)}</a>${yr}`;
    html += `</div>`;
  }

  // --- Milk sub-rows ---
  for (const r of milk) {
    const others = (r.milkSiblingNames || []).join("، ");
    if (others) html += `<div class="ol-subrow milk-row"><span class="milk-link">${escapeHTML(others)}</span></div>`;
  }

  if (hasKids && !collapsed) {
    html += `<ul>`;
    for (const k of kids) html += renderNode(k.id, visited);
    html += `</ul>`;
  }
  html += `</li>`;
  return html;
}

function bind(container, options) {
  const onSelect = options.onSelect;
  container.querySelectorAll("[data-toggle]").forEach(el => {
    el.addEventListener("click", e => {
      const id = el.dataset.toggle;
      if (COLLAPSED.has(id)) COLLAPSED.delete(id); else COLLAPSED.add(id);
      SELECTED_DEPTH = null; // manual toggle breaks the "fixed-depth" view
      render(container, options);
    });
  });
  container.querySelectorAll("[data-id]").forEach(el => {
    el.addEventListener("click", e => {
      e.stopPropagation();
      if (onSelect) onSelect(el.dataset.id);
    });
  });
  container.querySelector("#ol-expand-all")?.addEventListener("click", () => {
    COLLAPSED.clear();
    SELECTED_DEPTH = null;
    render(container, options);
  });
  container.querySelector("#ol-collapse-all")?.addEventListener("click", () => {
    Object.keys(getData().people).forEach(id => COLLAPSED.add(id));
    SELECTED_DEPTH = null;
    render(container, options);
  });
  container.querySelectorAll(".depth-chip").forEach(el => {
    el.addEventListener("click", () => {
      const n = parseInt(el.dataset.depth, 10);
      // Re-resolve active roots for this mode (same logic as in render).
      const data = getData();
      const mode = options.mode || "primary";
      const explicit = data.rootIds || [];
      const activeRoots = mode === "linked"
        ? detectLinkedHeads()
        : mode === "all"
          ? Array.from(new Set([...explicit, ...detectAllRoots()]))
          : explicit;
      applyDepth(n, activeRoots);
      render(container, options);
    });
  });
}

function escapeHTML(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;" }[c]));
}
