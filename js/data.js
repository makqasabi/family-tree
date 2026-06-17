// In-memory family tree model + helpers. Keeps the loaded data and exposes
// queries (children of, spouses of, ancestors, milk relations).

let DATA = null;
const listeners = new Set();

export function setData(data) {
  DATA = normalize(data);
  notify();
}
export function getData() { return DATA; }
export function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }
function notify() { listeners.forEach(fn => { try { fn(DATA); } catch (e) { console.error(e); } }); }

function normalize(data) {
  if (!data.people) data.people = {};
  if (!data.marriages) data.marriages = [];
  if (!data.milkRelations) data.milkRelations = [];
  if (!data.rootIds) data.rootIds = [];
  return data;
}

export function getPerson(id) { return DATA.people[id] || null; }
export function allPeople() { return Object.entries(DATA.people).map(([id, p]) => ({ id, ...p })); }

// Children-of with selectable mode:
//   "all"          → both patrilineal and matrilineal (used by outline + profile)
//   "patrilineal"  → father if set, else fall back to mother (cleaner for visual D3 layout)
export function childrenOf(id, mode = "all") {
  if (mode === "patrilineal") {
    return allPeople().filter(p =>
      p.fatherId === id || (p.motherId === id && !p.fatherId)
    );
  }
  return allPeople().filter(p => p.fatherId === id || p.motherId === id);
}

// Convenience alias kept for older callers.
export function allChildrenOf(id) { return childrenOf(id, "all"); }

// All Qassabi-lineage descendants of explicit rootIds (via fatherId only).
// Used to decide who is "outside" the main tree for the الأنساب tab.
export function qassabiLineageSet() {
  if (!DATA) return new Set();
  const roots = DATA.rootIds || [];
  const set = new Set();
  function walk(id) {
    if (set.has(id)) return;
    set.add(id);
    for (const [pid, p] of Object.entries(DATA.people)) {
      if (p.fatherId === id) walk(pid);
    }
  }
  for (const r of roots) walk(r);
  return set;
}

// Like qassabiLineageSet but follows BOTH father and mother — i.e., the
// "bloodline" including أرحام (matrilineal relatives). Per the methodology
// disclaimer, the linked-families view must surface in-laws of these too —
// e.g., إياس الهاجري is a linked head because his wife Reem is matrilineally
// Qassabi (mother = Asma).
export function qassabiBloodlineSet() {
  if (!DATA) return new Set();
  const roots = DATA.rootIds || [];
  const set = new Set();
  function walk(id) {
    if (set.has(id)) return;
    set.add(id);
    for (const [pid, p] of Object.entries(DATA.people)) {
      if (p.fatherId === id || p.motherId === id) walk(pid);
    }
  }
  for (const r of roots) walk(r);
  return set;
}

// Heads of non-Qassabi family branches connected to the tree (spouses,
// in-laws, ancestors of in-laws). Includes spouses with no offspring.
// When two non-Qassabi married each other and both qualify, the male is
// kept as the visible head; the female surfaces as his inline spouse.
export function detectLinkedHeads() {
  // Per family-feedback memo: start each linked family from the person who
  // actually married into Al-Qassabi (not their father/grandfather). This
  // unifies the methodology — Hajiri family shows إياس (Reem's husband),
  // Mubarak shows عبدالله (Najood's husband), etc. — instead of climbing
  // to the topmost documented ancestor. Bloodline includes matrilineal
  // descendants too so Iyas (married Reem, daughter of Asma) is recognized.
  if (!DATA) return [];
  const lineage = qassabiBloodlineSet();
  const heads = new Set();
  for (const m of DATA.marriages || []) {
    if (!m.spouseIds || m.spouseIds.length !== 2) continue;
    const [a, b] = m.spouseIds;
    const aIn = lineage.has(a), bIn = lineage.has(b);
    if (aIn && !bIn && DATA.people[b]) heads.add(b);
    else if (bIn && !aIn && DATA.people[a]) heads.add(a);
  }
  return [...heads];
}

// Bidirectional descendant set (via fatherId or motherId) starting at rootId.
export function descendantSetOf(rootId) {
  if (!DATA) return new Set();
  const set = new Set([rootId]);
  function walk(id) {
    for (const [pid, p] of Object.entries(DATA.people)) {
      if (set.has(pid)) continue;
      if (p.fatherId === id || p.motherId === id) {
        set.add(pid);
        walk(pid);
      }
    }
  }
  walk(rootId);
  return set;
}

// Builds a flat, year-sorted event list across the whole tree.
// Includes: birth, death, marriage (with year), and any per-person
// custom `events` array entries `{ year, label }`.
export function collectAllEvents() {
  if (!DATA) return [];
  const out = [];

  // Pre-compute marriage years per person so we can detect duplicate custom
  // events: when a person has a `events: [{ label: "تزوّج ..." }]` AND a
  // matching marriage record in the same year, the custom event is the same
  // datum told twice — keep only the structured marriage record.
  const marriageYearsByPerson = new Map();
  for (const m of DATA.marriages || []) {
    if (!m.year) continue;
    for (const sid of m.spouseIds || []) {
      let s = marriageYearsByPerson.get(sid);
      if (!s) { s = new Set(); marriageYearsByPerson.set(sid, s); }
      s.add(m.year);
    }
  }
  const looksLikeMarriageLabel = (s) => /تزوّج|تزوج|عقد قرانه|عقد قرانها|زواج|زفاف/.test(s || "");

  for (const [id, p] of Object.entries(DATA.people)) {
    if (p.birth?.year && !isBirthHidden(p)) {
      // Birth shown in the chronology only when not hidden (the same rule
      // governing the profile/outline). Admins can flip the global toggle
      // "إظهار تواريخ النساء" to reveal women's DOBs across the board.
      const place = p.birth.place ? ` في ${p.birth.place}` : "";
      out.push({
        year: p.birth.year,
        type: "birth",
        personIds: [id],
        description: `${p.gender === "female" ? "وُلدت" : "وُلد"} ${p.fullName}${place}`
      });
    }
    if (p.death?.year) {
      const place = p.death.place ? ` في ${p.death.place}` : "";
      out.push({
        year: p.death.year,
        type: "death",
        personIds: [id],
        description: `${p.gender === "female" ? "تُوفيت" : "تُوفي"} ${p.fullName}${place}`
      });
    }
    if (Array.isArray(p.events)) {
      for (const ev of p.events) {
        if (!ev.year) continue;
        // Skip marriage-shaped custom events that duplicate a marriage record.
        if (looksLikeMarriageLabel(ev.label) && marriageYearsByPerson.get(id)?.has(ev.year)) {
          continue;
        }
        out.push({
          year: ev.year,
          type: "custom",
          personIds: [id],
          description: ev.label || "حدث"
        });
      }
    }
  }
  for (const m of DATA.marriages || []) {
    if (m.year) {
      const names = (m.spouseIds || []).map(id => DATA.people[id]?.fullName).filter(Boolean);
      out.push({
        year: m.year,
        type: "marriage",
        personIds: m.spouseIds || [],
        description: `زواج ${names.join(" و ")}`,
        dissolved: m.dissolved === true
      });
    }
  }
  return out.sort((a, b) => a.year - b.year);
}

export function spousesOf(id) {
  const out = [];
  for (const m of DATA.marriages) {
    if (m.spouseIds.includes(id)) {
      const otherId = m.spouseIds.find(x => x !== id);
      if (otherId) out.push({ marriage: m, spouseId: otherId });
    }
  }
  return out;
}

export function siblingsOf(id) {
  const p = getPerson(id);
  if (!p) return [];
  return allPeople().filter(x =>
    x.id !== id &&
    (
      (p.fatherId && x.fatherId === p.fatherId) ||
      (p.motherId && x.motherId === p.motherId)
    )
  );
}

export function milkRelationsOf(id) {
  return DATA.milkRelations.filter(r =>
    (r.personIds && r.personIds.includes(id)) ||
    r.milkMotherId === id
  );
}

export function lineageOf(id, max = 6) {
  const out = [];
  let cur = getPerson(id);
  let cursor = id;
  while (cur && out.length < max) {
    out.push({ id: cursor, ...cur });
    cursor = cur.fatherId;
    cur = cursor ? getPerson(cursor) : null;
  }
  return out;
}

export function lineageString(id) {
  const chain = lineageOf(id, 8);
  if (!chain.length) return "";
  const givens = chain.map(p => p.given || p.fullName.split(" ")[0]);
  const family = chain[0].family || "";
  const isFemale = chain[0].gender === "female";
  if (givens.length === 1) return givens[0] + (family ? ` ${family}` : "");
  // فلانة بنت فلان بن فلان ... (family)  /  فلان بن فلان بن فلان ...
  const head = givens[0];
  const firstLink = isFemale ? " بنت " : " بن ";
  const rest = givens.slice(1).join(" بن ");
  return head + firstLink + rest + (family ? ` ${family}` : "");
}

export function searchPeople(query) {
  const q = (query || "").trim();
  if (!q) return [];
  const norm = arabicNormalize(q);
  return allPeople().filter(p => arabicNormalize(p.fullName).includes(norm)).slice(0, 30);
}

export function arabicNormalize(s) {
  return (s || "")
    .replace(/[ً-ْ]/g, "")  // diacritics
    .replace(/[إأآا]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

let _idCounter = 0;
export function nextId(prefix = "p_new_") {
  _idCounter++;
  return `${prefix}${Date.now().toString(36)}_${_idCounter}`;
}

export function addPerson(person) {
  const id = person.id || nextId();
  delete person.id;
  DATA.people[id] = person;
  notify();
  return id;
}

export function updatePerson(id, patch) {
  if (!DATA.people[id]) return;
  Object.assign(DATA.people[id], patch);
  notify();
}

export function deletePerson(id) {
  delete DATA.people[id];
  // unlink as parent on others
  for (const [pid, p] of Object.entries(DATA.people)) {
    if (p.fatherId === id) p.fatherId = null;
    if (p.motherId === id) p.motherId = null;
  }
  // remove from marriages
  DATA.marriages = DATA.marriages.filter(m => !m.spouseIds.includes(id));
  // remove from milk
  for (const r of DATA.milkRelations) {
    r.personIds = (r.personIds || []).filter(x => x !== id);
  }
  notify();
}

export function addMarriage(spouseAId, spouseBId, extra = {}) {
  const id = `m_${spouseAId}__${spouseBId}_${Date.now().toString(36)}`;
  DATA.marriages.push({ id, spouseIds: [spouseAId, spouseBId], ...extra });
  notify();
  return id;
}

export function removeMarriage(marriageId) {
  DATA.marriages = DATA.marriages.filter(m => m.id !== marriageId);
  notify();
}

export function setMilkRelationForPerson(personId, { siblingNames, notes }) {
  // Replace the first existing relation for this person, or create one.
  const idx = DATA.milkRelations.findIndex(r =>
    r.personIds && r.personIds.includes(personId));
  const hasContent = (siblingNames && siblingNames.length) || (notes && notes.trim());
  if (idx >= 0) {
    if (!hasContent) {
      DATA.milkRelations.splice(idx, 1);
    } else {
      DATA.milkRelations[idx].milkSiblingNames = siblingNames;
      DATA.milkRelations[idx].notes = notes;
    }
  } else if (hasContent) {
    DATA.milkRelations.push({
      id: `milk_${personId}_${Date.now().toString(36)}`,
      type: "milk-sibling",
      personIds: [personId],
      milkSiblingNames: siblingNames,
      notes
    });
  }
  notify();
}

export function setCurrentUser(id) {
  DATA.currentUserId = id;
  notify();
}

// Global admin override: when true, all female DOBs are revealed regardless
// of the female-default-hidden rule. Per-person explicit `birth.hidden: true`
// is still honored. Lives only in memory + localStorage on the admin's device.
let _showAllFemaleDOB = false;
export function setShowAllFemaleDOB(v) { _showAllFemaleDOB = !!v; }
export function getShowAllFemaleDOB() { return _showAllFemaleDOB; }

// Resolve whether a person's DOB should be hidden.
// Order of precedence:
//   1. Explicit `birth.hidden === true`         → always hidden (privacy lock)
//   2. Admin global "show all female DOB" ON    → shown
//   3. Female                                   → hidden (admin's hide choice is master,
//                                                 overrides any `birth.hidden: false`)
//   4. Otherwise                                → shown
// Note: `birth.hidden: false` is treated as a no-op for females — the admin
// toggle is authoritative. Use it only on males if you need to make explicit.
export function isBirthHidden(p) {
  if (!p) return false;
  const explicit = p.birth?.hidden;
  if (explicit === true) return true;
  if (_showAllFemaleDOB) return false;
  return p.gender === "female";
}

// Walk up the patrilineal chain (fatherId) from a person and return the
// nearest ancestor (or self) that has a `tribalRootId` set. This allows
// the profile view to show tribal kinship for every patrilineal descendant
// without repeating the field on every record. Returns { rootId, viaId }
// where viaId is the ancestor whose explicit tribalRootId we used.
export function getInheritedTribalRoot(personId) {
  if (!DATA) return null;
  const seen = new Set();
  let cursorId = personId;
  while (cursorId && !seen.has(cursorId)) {
    seen.add(cursorId);
    const p = DATA.people[cursorId];
    if (!p) return null;
    if (p.tribalRootId) {
      return { rootId: p.tribalRootId, viaId: cursorId };
    }
    cursorId = p.fatherId;
  }
  return null;
}

// Find groups of persons whose normalized full name matches another person.
// Returns: [{ key, ids: [id1, id2, ...] }, ...] for groups of size 2+.
export function findDuplicateGroups() {
  if (!DATA) return [];
  const byName = new Map();
  for (const [id, p] of Object.entries(DATA.people)) {
    const key = arabicNormalize(p.fullName);
    if (!key) continue;
    if (!byName.has(key)) byName.set(key, []);
    byName.get(key).push(id);
  }
  return [...byName.entries()]
    .filter(([_, ids]) => ids.length > 1)
    .map(([key, ids]) => ({ key, ids }));
}

// Is the current user marked as admin in the data?
export function isCurrentUserAdmin() {
  if (!DATA) return false;
  const cur = DATA.currentUserId;
  if (!cur) return false;
  const admins = Array.isArray(DATA.adminUserIds) ? DATA.adminUserIds : [];
  return admins.includes(cur);
}

// Format birth/death year(s) for compact display, with gender-aware verbs.
export function lifespan(p) {
  const b = isBirthHidden(p) ? null : p.birth?.year;
  const d = p.death?.year;
  const f = p.gender === "female";
  if (!b && !d) return "";
  if (b && d) return `${b}–${d}`;
  if (b) return `${f ? "وُلدت" : "وُلد"} ${b}`;
  if (d) return `${f ? "تُوفيت" : "تُوفي"} ${d}`;
  return "";
}

export function fullDate(date) {
  if (!date) return "";
  if (date.hidden) return "محجوب";
  if (date.day && date.month && date.year) return `${date.day}/${date.month}/${date.year}م`;
  if (date.month && date.year) return `${date.month}/${date.year}م`;
  if (date.year) return `${date.approximate ? "حوالي " : ""}${date.year}م${date.approxRange ? ` (${date.approxRange[0]}–${date.approxRange[1]})` : ""}`;
  return "";
}
