// Encrypted blob persistence. Source of truth is localStorage; export/import
// for portability across devices and for syncing back to the hosted file.

import { encryptJSON, decryptJSON } from "./crypto.js";

const LS_KEY = "qassabi_family_blob_v1";
const LS_HINT = "qassabi_family_hint_v1";

export function hasLocalBlob() {
  return !!localStorage.getItem(LS_KEY);
}

export function getStoredBlob() {
  const raw = localStorage.getItem(LS_KEY);
  return raw ? JSON.parse(raw) : null;
}

export function saveBlob(blob) {
  localStorage.setItem(LS_KEY, JSON.stringify(blob));
}

export function setHint(hint) {
  if (hint) localStorage.setItem(LS_HINT, hint);
}

export function getHint() {
  return localStorage.getItem(LS_HINT) || "";
}

export async function unlockWithPassword(password) {
  const blob = getStoredBlob();
  if (!blob) throw new Error("لا توجد بيانات محفوظة");
  return decryptJSON(blob, password);
}

export async function persistEncrypted(data, password) {
  const blob = await encryptJSON(data, password);
  saveBlob(blob);
  return blob;
}

export async function fetchSeed() {
  const res = await fetch("data/seed.json");
  if (!res.ok) throw new Error("تعذّر تحميل ملف البذرة (seed.json)");
  return res.json();
}

// Merge from seed.json into current data — fully non-destructive:
//   * narrative fields (events, occupations, places, notes, kunya, alias) are unioned per existing person
//   * NEW persons from seed are added only when no current person matches by ID or by normalized fullName
//   * fatherId/motherId on existing persons are filled in only when null in current (no overwrite)
//   * marriages in seed are added only when no equivalent marriage exists between the same pair
//   * milkRelations in seed are added by ID only if missing
//   * currentUserId is set only when current doesn't have one
// All ID references are remapped through a name-index so user's existing entries are reused
// instead of duplicated.
export function mergeSeedNarrative(currentData, seedData) {
  const r = {
    evAdded: 0, occAdded: 0, placeAdded: 0, noteUpdated: 0,
    kunyaUpdated: 0, aliasUpdated: 0, userIdSet: false,
    personsAdded: 0, parentLinkAdded: 0, marriagesAdded: 0, milkAdded: 0
  };

  const norm = s => (s || "")
    .replace(/[ً-ْ]/g, "")
    .replace(/[إأآا]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

  // Map normalized fullName → effective current ID (existing or newly added).
  const nameToCurrentId = new Map();
  for (const [id, p] of Object.entries(currentData.people)) {
    const k = norm(p.fullName);
    if (k && !nameToCurrentId.has(k)) nameToCurrentId.set(k, id);
  }

  // Pre-compute which user IDs are claimed by seed-id matches (these
  // user records are reserved for that specific seed entry; no other
  // seed entry may dedup onto them via name match — otherwise two seed
  // entries fight over the same target every merge, never converging).
  const claimedUserIds = new Set();
  for (const seedId of Object.keys(seedData.people || {})) {
    if (currentData.people[seedId]) claimedUserIds.add(seedId);
  }

  // Pass 1: decide for each seed person whether it exists by ID or name, or needs adding.
  // Build seedId → effectiveId map.
  const seedToEffective = new Map();
  for (const [seedId, seedP] of Object.entries(seedData.people || {})) {
    if (currentData.people[seedId]) {
      seedToEffective.set(seedId, seedId);
      continue;
    }
    const k = norm(seedP.fullName);
    const nameMatchUserId = k ? nameToCurrentId.get(k) : null;
    if (nameMatchUserId && !claimedUserIds.has(nameMatchUserId)) {
      // Name match is safe only if no other seed entry already claims
      // that user record by ID. Otherwise we'd cause an alias collision.
      seedToEffective.set(seedId, nameMatchUserId);
      continue;
    }
    // New person: copy from seed; parent links will be remapped in pass 2 below.
    currentData.people[seedId] = JSON.parse(JSON.stringify(seedP));
    seedToEffective.set(seedId, seedId);
    claimedUserIds.add(seedId);
    if (k) nameToCurrentId.set(k, seedId);
    r.personsAdded++;
  }

  // Pass 2: narrative merge for existing persons + remap parent IDs in newly-added persons
  // and backfill null parent links on existing persons.
  for (const [seedId, seedP] of Object.entries(seedData.people || {})) {
    const effId = seedToEffective.get(seedId);
    const cur = currentData.people[effId];
    if (!cur) continue;
    const isNewlyAdded = (effId === seedId) && !inOriginal(currentData, seedId, seedToEffective);

    // Narrative union (applies to both existing and newly-added)
    if (Array.isArray(seedP.events) && seedP.events.length) {
      const existing = Array.isArray(cur.events) ? cur.events : [];
      const sig = ev => `${ev.year}::${ev.label || ""}`;
      const have = new Set(existing.map(sig));
      const incoming = seedP.events.filter(ev => !have.has(sig(ev)));
      if (incoming.length) {
        cur.events = [...existing, ...incoming].sort((a, b) => (a.year || 0) - (b.year || 0));
        r.evAdded += incoming.length;
      }
    }
    if (Array.isArray(seedP.occupations) && seedP.occupations.length) {
      const existing = Array.isArray(cur.occupations) ? cur.occupations : [];
      const have = new Set(existing);
      for (const occ of seedP.occupations) if (!have.has(occ)) { existing.push(occ); r.occAdded++; }
      cur.occupations = existing;
    }
    if (Array.isArray(seedP.places) && seedP.places.length) {
      const existing = Array.isArray(cur.places) ? cur.places : [];
      const have = new Set(existing);
      for (const pl of seedP.places) if (!have.has(pl)) { existing.push(pl); r.placeAdded++; }
      cur.places = existing;
    }
    // Notes: replace when seed clearly has more substantive content (>2x length
    // and current is short/placeholder-like). Otherwise leave user's notes alone.
    if (seedP.notes && (!cur.notes ||
        (cur.notes.length < 200 && seedP.notes.length > cur.notes.length * 2))) {
      cur.notes = seedP.notes;
      r.noteUpdated++;
    }

    // Birth/death corrections: seed is canonical. If a seed entry has an
    // explicit year/month/day/place/approximate flag on birth or death and
    // it differs from current, copy it over. This is how data corrections
    // (e.g., birth year 1922 → 1920) propagate to existing user data.
    // We diff per-subfield so we don't clobber fields the user may have
    // filled in that the seed leaves blank.
    for (const lifeKey of ["birth", "death"]) {
      const seedLife = seedP[lifeKey];
      if (!seedLife || typeof seedLife !== "object") continue;
      let curLife = cur[lifeKey];
      if (!curLife || typeof curLife !== "object") {
        cur[lifeKey] = curLife = {};
      }
      for (const sub of ["year", "month", "day", "place", "approximate", "hidden"]) {
        if (sub in seedLife && seedLife[sub] !== curLife[sub]) {
          curLife[sub] = seedLife[sub];
          r.lifeFieldUpdated = (r.lifeFieldUpdated || 0) + 1;
        }
      }
    }

    // isDeceased flag: seed may flip it true (e.g., user reports a death).
    if ("isDeceased" in seedP && cur.isDeceased !== seedP.isDeceased) {
      cur.isDeceased = seedP.isDeceased;
      r.deceasedFlagUpdated = (r.deceasedFlagUpdated || 0) + 1;
    }

    // Name/family corrections: when seed has different given/family, propagate.
    // This handles cases like changing family from "الغامدي" → "ظهران", or
    // renaming "ابن البسام" → "عبدالقادر البسام". The seed is canonical.
    if (seedP.given && seedP.given !== cur.given) {
      cur.given = seedP.given;
      r.givenUpdated = (r.givenUpdated || 0) + 1;
    }
    if (seedP.family && seedP.family !== cur.family) {
      cur.family = seedP.family;
      r.familyUpdated = (r.familyUpdated || 0) + 1;
    }
    // fullName: if seed differs and it's not handled by lineage extension or
    // placeholder rename below (those have their own counters), apply it as
    // a direct correction. This is the catch-all path for name shortening
    // (e.g., dropping a misattributed family suffix).
    if (seedP.fullName && seedP.fullName !== cur.fullName
        && !isLineageExtension(cur.fullName, seedP.fullName)
        && !cur.isPlaceholder) {
      cur.fullName = seedP.fullName;
      r.fullNameCorrected = (r.fullNameCorrected || 0) + 1;
    }
    // For placeholders, seed corrections override any old value (since
    // placeholders are explicitly "expand later" stubs that shouldn't
    // hold stale tribal/family info). For non-placeholders, only fill
    // when empty (preserve any user-curated value).
    const allowOverride = !!cur.isPlaceholder;

    if (seedP.kunya && (allowOverride || !cur.kunya) && cur.kunya !== seedP.kunya) {
      cur.kunya = seedP.kunya; r.kunyaUpdated++;
    }
    if (seedP.alias && (allowOverride || !cur.alias) && cur.alias !== seedP.alias) {
      cur.alias = seedP.alias; r.aliasUpdated++;
    }
    if (seedP.tribe && (allowOverride || !cur.tribe) && cur.tribe !== seedP.tribe) {
      cur.tribe = seedP.tribe; r.tribeUpdated = (r.tribeUpdated || 0) + 1;
    }

    // isPlaceholder explicit override: when seed has an explicit boolean,
    // mirror it (this is how a person who was misrecorded as placeholder
    // gets promoted to a real-data entry, e.g., Naif after being demoted
    // from spouse to son and getting parents wired).
    if ("isPlaceholder" in seedP && cur.isPlaceholder !== seedP.isPlaceholder) {
      cur.isPlaceholder = seedP.isPlaceholder;
      r.placeholderFlagToggled = (r.placeholderFlagToggled || 0) + 1;
    }

    if (seedP.tribalRootId && (allowOverride || !cur.tribalRootId)) {
      const remapped = seedToEffective.get(seedP.tribalRootId) || seedP.tribalRootId;
      if (currentData.people[remapped] && cur.tribalRootId !== remapped) {
        cur.tribalRootId = remapped;
        r.tribalRootSet = (r.tribalRootSet || 0) + 1;
      }
    }

    // Placeholder name correction: if a seed entry corrects a misnamed
    // placeholder, allow the rename. We require the person to be marked
    // isPlaceholder (so we never clobber a user-curated record), and we
    // also require seed.fullName/given to differ.
    if (cur.isPlaceholder && seedP.fullName && seedP.fullName !== cur.fullName
        && !isLineageExtension(cur.fullName, seedP.fullName)) {
      cur.fullName = seedP.fullName;
      if (seedP.given) cur.given = seedP.given;
      if (seedP.family) cur.family = seedP.family;
      r.placeholderRenamed = (r.placeholderRenamed || 0) + 1;
    }

    // Upgrade fullName/family when seed has a longer lineage that extends the
    // current name (every word of the current name appears in seed in order).
    // Example: "يوسف فؤاد العامر" → "يوسف فؤاد جارالله الجارالله العامر".
    if (seedP.fullName && seedP.fullName !== cur.fullName && isLineageExtension(cur.fullName, seedP.fullName)) {
      cur.fullName = seedP.fullName;
      r.fullNameUpgraded = (r.fullNameUpgraded || 0) + 1;
      if (seedP.family && seedP.family !== cur.family) cur.family = seedP.family;
    }

    // Parent backfill / intermediate-ancestor insertion.
    // Two cases handled:
    //   1) current[key] is null → fill from seed
    //   2) current[key] points to Z and seed[key] points to Y, where seed
    //      claims Y→…→Z. That means the seed inserted an intermediate
    //      ancestor (e.g., Yusuf→Fuad→Jarallah replaced by Yusuf→Fuad→Ibrahim→Jarallah).
    //      We only accept the rewrite if walking up via `key` from Y eventually
    //      reaches Z — that proves it's a refinement, not a different family.
    for (const key of ["fatherId", "motherId"]) {
      const seedRef = seedP[key];
      if (!seedRef) continue;
      const remapped = seedToEffective.get(seedRef) || seedRef;
      if (!remapped || !currentData.people[remapped]) continue;

      if (!cur[key]) {
        cur[key] = remapped;
        r.parentLinkAdded++;
      } else if (cur[key] !== remapped) {
        // 1) Intermediate-ancestor refinement: walking up from the new
        //    parent leads to the old one — accept the new chain.
        if (walksUpTo(currentData, remapped, cur[key], key)) {
          cur[key] = remapped;
          r.intermediatesInserted = (r.intermediatesInserted || 0) + 1;
        }
        // 2) Sibling-demotion correction: current's "parent" in our data
        //    is actually a sibling per seed (e.g., Naif was a husband,
        //    now he's a son alongside Haifa). Detect by checking whether
        //    cur[key] shares parents with cur per seed AND the seed's
        //    new parent matches that shared parent. If so, re-point.
        // 3) Sibling-reassignment correction: current's parent and seed's
        //    parent are siblings per seed (e.g., motherId moves from one
        //    sister to another). This handles cases where children were
        //    originally attributed to the wrong sister/brother.
        else {
          const oldId = cur[key];
          const oldInSeed = seedData.people[oldId];
          const newInSeed = seedData.people[seedRef];
          if (oldInSeed && oldInSeed[key] === seedP[key]
              && oldInSeed[key] === seedRef) {
            cur[key] = remapped;
            r.parentLinkCorrected = (r.parentLinkCorrected || 0) + 1;
          } else if (oldInSeed && newInSeed
              && oldInSeed.fatherId && oldInSeed.fatherId === newInSeed.fatherId) {
            // Siblings (same father). The seed says cur's actual parent
            // is the new one, not the old sibling.
            cur[key] = remapped;
            r.parentLinkCorrected = (r.parentLinkCorrected || 0) + 1;
          }
        }
      }
    }
  }

  // Pass 3: marriages.
  //   * If seed marriage id matches an existing one but spouseIds differ
  //     (after remapping), update the existing record's spouseIds. This
  //     is how legacy-id marriage corrections propagate (e.g., a marriage
  //     was originally recorded with the wrong spouse and seed now points
  //     to the right one).
  //   * Otherwise add a new marriage only if both spouses exist in current
  //     and no equivalent (same pair) marriage already exists.
  for (const seedM of seedData.marriages || []) {
    const remapped = (seedM.spouseIds || []).map(sid => seedToEffective.get(sid) || sid);
    if (remapped.length !== 2) continue;
    if (!remapped.every(id => currentData.people[id])) continue;

    const existing = currentData.marriages.find(m => m.id === seedM.id);
    if (existing) {
      const sameSpouses = (existing.spouseIds || []).length === 2 &&
        remapped.every(rid => existing.spouseIds.includes(rid));
      if (!sameSpouses) {
        existing.spouseIds = remapped;
        r.marriagesUpdated = (r.marriagesUpdated || 0) + 1;
      }
      // Backfill year/month/day on the existing marriage when current is missing them.
      for (const k of ["year", "month", "day"]) {
        if (seedM[k] != null && existing[k] == null) {
          existing[k] = seedM[k];
          r.marriagesUpdated = (r.marriagesUpdated || 0) + 1;
        }
      }
      // Propagate status corrections: `dissolved` flips when seed reports
      // divorce/separation, `order` may be added or changed, notes refreshed.
      if ("dissolved" in seedM && existing.dissolved !== seedM.dissolved) {
        existing.dissolved = seedM.dissolved;
        r.marriageStatusUpdated = (r.marriageStatusUpdated || 0) + 1;
      }
      if (seedM.order != null && existing.order !== seedM.order) {
        existing.order = seedM.order;
        r.marriagesUpdated = (r.marriagesUpdated || 0) + 1;
      }
      if (seedM.notes && existing.notes !== seedM.notes) {
        existing.notes = seedM.notes;
        r.marriagesUpdated = (r.marriagesUpdated || 0) + 1;
      }
      continue;
    }

    const exists = currentData.marriages.some(m => {
      const ids = m.spouseIds || [];
      return ids.length === 2 && remapped.every(rid => ids.includes(rid));
    });
    if (exists) continue;
    currentData.marriages.push({ ...seedM, spouseIds: remapped });
    r.marriagesAdded++;
  }

  // Pass 4: milk relations — add by ID only if missing.
  for (const seedR of seedData.milkRelations || []) {
    if ((currentData.milkRelations || []).some(x => x.id === seedR.id)) continue;
    const remapped = (seedR.personIds || []).map(id => seedToEffective.get(id) || id);
    if (!remapped.every(id => currentData.people[id])) continue;
    currentData.milkRelations = currentData.milkRelations || [];
    currentData.milkRelations.push({ ...seedR, personIds: remapped });
    r.milkAdded++;
  }

  // Apply explicit removals from seed — used to retract stale entries
  // that were superseded by newer versions in seed but lingered in the
  // user's data because additive merges never delete on their own.
  if (seedData._seedRemovals) {
    const sr = seedData._seedRemovals;

    // Remove specific events from specific persons.
    if (Array.isArray(sr.events)) {
      for (const removal of sr.events) {
        const pid = seedToEffective.get(removal.personId) || removal.personId;
        const person = currentData.people[pid];
        if (!person || !Array.isArray(person.events)) continue;
        const before = person.events.length;
        person.events = person.events.filter(e =>
          !(e.year === removal.year && e.label === removal.label)
        );
        const removed = before - person.events.length;
        if (removed) r.eventsRemoved = (r.eventsRemoved || 0) + removed;
      }
    }

    // Remove specific marriage records by id.
    if (Array.isArray(sr.marriages)) {
      for (const removal of sr.marriages) {
        const idx = (currentData.marriages || []).findIndex(m => m.id === removal.id);
        if (idx >= 0) {
          currentData.marriages.splice(idx, 1);
          r.marriagesRemoved = (r.marriagesRemoved || 0) + 1;
        }
      }
    }

    // Remove specific persons by id. Disconnect any references first so
    // the rest of the tree stays consistent.
    if (Array.isArray(sr.persons)) {
      for (const removal of sr.persons) {
        if (!currentData.people[removal.id]) continue;
        // Disconnect: null out any fatherId/motherId that points to this person.
        for (const other of Object.values(currentData.people)) {
          if (other.fatherId === removal.id) other.fatherId = null;
          if (other.motherId === removal.id) other.motherId = null;
          if (other.tribalRootId === removal.id) other.tribalRootId = null;
        }
        // Strip from marriages the person was in.
        currentData.marriages = (currentData.marriages || []).filter(m =>
          !(m.spouseIds || []).includes(removal.id)
        );
        // Strip from milk relations.
        for (const mr of currentData.milkRelations || []) {
          if (mr.milkMotherId === removal.id) mr.milkMotherId = null;
          if (Array.isArray(mr.personIds)) mr.personIds = mr.personIds.filter(x => x !== removal.id);
        }
        // Strip from admin list.
        if (Array.isArray(currentData.adminUserIds)) {
          currentData.adminUserIds = currentData.adminUserIds.filter(x => x !== removal.id);
        }
        delete currentData.people[removal.id];
        r.personsRemoved = (r.personsRemoved || 0) + 1;
      }
    }
  }

  if (seedData.currentUserId && !currentData.currentUserId) {
    const remapped = seedToEffective.get(seedData.currentUserId) || seedData.currentUserId;
    if (currentData.people[remapped]) {
      currentData.currentUserId = remapped;
      r.userIdSet = true;
    }
  }

  // Admin user list: merge as a union, remapping any seed IDs through the
  // name dedup map so a user-provided entry under a different ID still
  // becomes admin if the seed designates them so.
  if (Array.isArray(seedData.adminUserIds) && seedData.adminUserIds.length) {
    const existing = Array.isArray(currentData.adminUserIds) ? currentData.adminUserIds : [];
    const have = new Set(existing);
    let added = 0;
    for (const aid of seedData.adminUserIds) {
      const remapped = seedToEffective.get(aid) || aid;
      if (currentData.people[remapped] && !have.has(remapped)) {
        existing.push(remapped);
        have.add(remapped);
        added++;
      }
    }
    if (added) {
      currentData.adminUserIds = existing;
      r.adminsAdded = added;
    } else if (!currentData.adminUserIds && existing.length) {
      currentData.adminUserIds = existing;
    }
  }

  return r;
}

// Was this seed ID present in current BEFORE we added it in pass 1?
// (Detects "newly added" persons so we can apply different logic if needed.)
function inOriginal(currentData, id, seedToEffective) {
  // If the effective is the seed ID itself, we may have just added it in this run.
  // We can't tell after the fact without a separate marker, but for the narrative
  // merge it doesn't matter — applying it is harmless.
  return true;
}

// Walks up a parent chain (via the given key, fatherId or motherId) from
// `fromId` and returns true if the chain reaches `toId`. Used to verify
// that a candidate intermediate ancestor sits in the correct lineage.
function walksUpTo(currentData, fromId, toId, key) {
  let cursor = fromId;
  const seen = new Set();
  while (cursor && !seen.has(cursor)) {
    seen.add(cursor);
    if (cursor === toId) return true;
    cursor = currentData.people[cursor]?.[key];
  }
  return false;
}

// Returns true when every space-separated token of `shorter` appears in
// `longer` in the same relative order, with at least one extra token in
// `longer`. So "يوسف فؤاد العامر" is an extension of "يوسف فؤاد جارالله الجارالله العامر".
function isLineageExtension(shorter, longer) {
  if (!shorter || !longer) return false;
  const a = shorter.split(/\s+/).filter(Boolean);
  const b = longer.split(/\s+/).filter(Boolean);
  if (b.length <= a.length) return false;
  let i = 0;
  for (const tok of a) {
    while (i < b.length && b[i] !== tok) i++;
    if (i >= b.length) return false;
    i++;
  }
  return true;
}

export async function fetchHostedEncrypted() {
  try {
    const res = await fetch("data/family.enc.json", { cache: "no-store" });
    if (!res.ok) return null;
    return await res.json();
  } catch (_) {
    return null;
  }
}

export function downloadEncrypted(blob, filename = "family.enc.json") {
  const json = JSON.stringify(blob, null, 2);
  triggerDownload(json, filename, "application/json");
}

export function downloadJSON(obj, filename) {
  triggerDownload(JSON.stringify(obj, null, 2), filename, "application/json");
}

function triggerDownload(content, filename, mime) {
  const url = URL.createObjectURL(new Blob([content], { type: mime }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function readFileAsJSON(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => {
      try { resolve(JSON.parse(r.result)); }
      catch (e) { reject(e); }
    };
    r.onerror = () => reject(r.error);
    r.readAsText(file);
  });
}
