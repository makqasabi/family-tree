#!/usr/bin/env node
// Validates data/seed.json. Run from repo root with:
//   node tools/validate-seed.js
//
// Categories:
//   ERROR  – data integrity issue that must be fixed (broken ref, cycle, …)
//   WARN   – data hygiene issue that should be fixed (id/name mismatch, future date, …)
//   INFO   – noteworthy but not necessarily wrong (duplicate fullName, etc.)
// Exit code 1 if any ERRORs found.

import { readFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SEED = path.resolve(__dirname, "..", "data", "seed.json");

const errors = [];
const warnings = [];
const infos = [];

function err(code, msg) { errors.push({ code, msg }); }
function warn(code, msg) { warnings.push({ code, msg }); }
function info(code, msg) { infos.push({ code, msg }); }

// Common Arabic given names → English slug variants used in our id scheme.
// Used to flag id↔name mismatches like p_anas_X with given="علي".
// Multiple variants per name are supported (e.g., عبدالله → "abdullah" or "abdallah").
const TRANSLIT = {
  "عبدالعزيز": ["abdulaziz","abdelaziz"],
  "عبدالله": ["abdullah","abdallah"],
  "عبدالرحمن": ["abdulrahman","abderahman"],
  "عبدالمحسن": ["abdulmuhsin","abdelmuhsin"],
  "عبداللطيف": ["abdullatif","abdellatif"],
  "عبدالرزاق": ["abdulrazaq","abderazak"],
  "عبدالكريم": ["abdulkarim"],
  "عبدالإله": ["abdulilah"],
  "عثمان": ["uthman","othman","osman"],
  "محمد": ["mohammed","muhammad","mohamed"],
  "أحمد": ["ahmed","ahmad"],
  "علي": ["ali"],
  "حسين": ["hussein","hussain"],
  "خالد": ["khalid","khaled"],
  "إبراهيم": ["ibrahim"],
  "ابراهيم": ["ibrahim"],
  "يوسف": ["yusuf","youssef","yousef"],
  "سليمان": ["suleiman","sulaiman","soliman"],
  "سعد": ["saad"],
  "سعود": ["saud"],
  "صالح": ["saleh"],
  "ماجد": ["majed","majid"],
  "مشعل": ["mishaal","mishal"],
  "بدر": ["bader","badr"],
  "فهد": ["fahd","fahad"],
  "ناصر": ["naser","nasser"],
  "حمدان": ["hamdan"],
  "عمر": ["omar","umar"],
  "أنس": ["anas"],
  "أسامة": ["osama","usama"],
  "اسامة": ["osama","usama"],
  "أحمد": ["ahmed","ahmad"],
  "أنس": ["anas"],
  "حمود": ["humood","hammoud"],
  "إسحاق": ["ishaq","ishak"],
  "اسحاق": ["ishaq","ishak"],
  "إياس": ["iyas"],
  "سمير": ["samir","sameer"],
  "مصطفى": ["mustafa","moustafa"],
  "أسامة": ["osama","usama"],
  "طارق": ["tariq","tareq"],
  "قاسم": ["qasim","qassim"],
  "القاسم": ["qasim","alqasim"],
  "نايف": ["naif","nayef"],
  "خولة": ["khawla","khaula"],
  "نورة": ["noura","nora"],
  "موضي": ["moudi"],
  "منيرة": ["munira","muneera"],
  "هند": ["hind"],
  "أسماء": ["asma","asmaa"],
  "اسماء": ["asma","asmaa"],
  "هديل": ["hadeel","hadil"],
  "سلوى": ["salwa"],
  "سلمى": ["salma"],
  "سلطان": ["sultan"],
  "ريم": ["reem"],
  "رنا": ["rana"],
  "هيا": ["haya"],
  "نسرين": ["nasrin","nasreen"],
  "دانة": ["dana"],
  "دانه": ["dana"],
  "ديم": ["deem"],
  "دانة": ["dana"],
  "أسيل": ["aseel","aseeel"],
  "اسيل": ["aseel"],
  "عبير": ["abeer"],
  "هالة": ["hala","halah"],
  "لولوة": ["lulwah","lulwa"],
  "ياسمين": ["yasmin","yasmine"],
  "زينة": ["zeinah","zainah","zeena"],
  "زينه": ["zeinah","zainah","zeena"],
  "مضاوي": ["mudawi","modawi"],
  "نائلة": ["naila","nailah"],
  "العنود": ["alanoud","anoud"],
  "العنود": ["alanoud"],
  "هيفاء": ["haifa"],
  "ليلى": ["layla","laila"],
  "في": ["fai","fy"],
  "مساعد": ["misaad","mosaad"],
  "ترف": ["toraf","taraf"],
  "صبا": ["saba","sabah"],
  "ود": ["wad"],
  "يارا": ["yara"],
  "ديما": ["deema","dima"],
  "ريما": ["reema","rima"],
  "بسمة": ["basma","basmah"],
  "آلاء": ["alaa","alaah"],
  "نجود": ["najood","nujood"],
  "لطيفة": ["lateefa","latifa"],
  "نوال": ["nawal"],
  "علياء": ["aliaa","alia"],
  "الجوهرة": ["aljawhara","jawhara"],
  "فاطمة": ["fatima","fatmah"],
  "فرح": ["farah"],
  "مها": ["maha"],
  "لميس": ["lamees"],
  "فيصل": ["faisal","faysal"],
  "سهام": ["siham"],
  "شهد": ["shahd"],
  "نور": ["nour","noor"],
  "سلام": ["salam"],
  "مهند": ["muhannad"],
  "رولا": ["rola"],
  "نوف": ["nawf"],
  "روان": ["rawan"],
  "أروى": ["arwa"],
  "أروى": ["arwa"],
  "مثنى": ["muthana"],
  "ندى": ["nada"],
  "هلا": ["hala"],
  "مشاعل": ["mashael"],
  "خالد": ["khalid","khaled"],
  "شيخة": ["sheikha","shaykha"],
  "لولو": ["lulu"],
  "زهية": ["zahia"],
  "دباس": ["dabbas"],
  "زامل": ["zamel"],
  "إسحاق": ["ishaq"],
  "جارالله": ["jarallah"],
  "فؤاد": ["fuad","fouad"],
  "سامي": ["sami"],
  "عماد": ["imad","emad"],
  "عبدالمحسن": ["abdulmuhsin"],
  "قماشة": ["qumasha"],
  "مشيرة": ["mushira","moushira"],
  "علي": ["ali"],
  "سجى": ["saja"],
  "ندى": ["nada"],
  "صبا": ["saba"],
  "هيا": ["haya"],
  "نائلة": ["naila"]
};

const data = JSON.parse(readFileSync(SEED, "utf8"));
const people = data.people || {};
const ids = new Set(Object.keys(people));

const norm = s => (s || "")
  .replace(/[ً-ْ]/g, "")
  .replace(/[إأآا]/g, "ا")
  .replace(/ى/g, "ي")
  .replace(/ة/g, "ه")
  .replace(/\s+/g, " ")
  .trim()
  .toLowerCase();

// ---- 1. Person record integrity ----------------------------------------
for (const [id, p] of Object.entries(people)) {
  if (!p.fullName) {
    err("missing-fullname", `${id}: no fullName`);
    continue;
  }

  // 1a. fullName must contain `given` (when both are set).
  if (p.given && !p.fullName.includes(p.given)) {
    err("name-given-mismatch",
      `${id}: given="${p.given}" not found in fullName="${p.fullName}"`);
  }

  // 1b. family name should appear somewhere in fullName.
  if (p.family && !p.fullName.includes(p.family)) {
    warn("name-family-mismatch",
      `${id}: family="${p.family}" not found in fullName="${p.fullName}"`);
  }

  // 1c. id-vs-given transliteration check. This catches the historical bug
  // where p_anas_alshuwaier had fullName/given "علي" — i.e., the slug
  // promises one name, the human-readable record gives another. Only
  // applies when the given name has a known transliteration in our table.
  if (id.startsWith("p_") && !id.startsWith("p_new_") && p.given) {
    const expected = TRANSLIT[p.given];
    if (expected) {
      const idLower = id.toLowerCase();
      const variants = Array.isArray(expected) ? expected : [expected];
      const matches = variants.some(v => idLower.includes(v));
      if (!matches) {
        warn("id-given-mismatch",
          `${id}: given="${p.given}" but id slug doesn't contain any of [${variants.join(", ")}]`);
      }
    }
  }

  // 1d. parent self-reference.
  if (p.fatherId === id) err("self-father", `${id}: fatherId === id`);
  if (p.motherId === id) err("self-mother", `${id}: motherId === id`);

  // 1e. parent must exist.
  if (p.fatherId && !ids.has(p.fatherId)) err("missing-father", `${id}: fatherId="${p.fatherId}" does not exist`);
  if (p.motherId && !ids.has(p.motherId)) err("missing-mother", `${id}: motherId="${p.motherId}" does not exist`);

  // 1f. parent gender (only when target is set and has a gender).
  if (p.fatherId && people[p.fatherId]?.gender && people[p.fatherId].gender !== "male") {
    err("father-not-male", `${id}: fatherId="${p.fatherId}" but that person's gender is "${people[p.fatherId].gender}"`);
  }
  if (p.motherId && people[p.motherId]?.gender && people[p.motherId].gender !== "female") {
    err("mother-not-female", `${id}: motherId="${p.motherId}" but that person's gender is "${people[p.motherId].gender}"`);
  }

  // 1g. tribalRootId must exist.
  if (p.tribalRootId && !ids.has(p.tribalRootId)) {
    err("missing-tribal-root", `${id}: tribalRootId="${p.tribalRootId}" does not exist`);
  }

  // 1h. date sanity.
  const by = p.birth?.year, dy = p.death?.year;
  if (by && (by < 1500 || by > 2100)) warn("birth-year-odd", `${id}: birth.year=${by} outside 1500–2100`);
  if (dy && (dy < 1500 || dy > 2100)) warn("death-year-odd", `${id}: death.year=${dy} outside 1500–2100`);
  if (by && dy && by > dy) err("birth-after-death", `${id}: birth.year=${by} > death.year=${dy}`);
  for (const k of ["birth", "death"]) {
    const d = p[k];
    if (!d) continue;
    if (d.month && (d.month < 1 || d.month > 12)) warn("bad-month", `${id}.${k}.month=${d.month}`);
    if (d.day && (d.day < 1 || d.day > 31)) warn("bad-day", `${id}.${k}.day=${d.day}`);
  }

  // 1i. parent age vs child birth (parent must have been born before child).
  if (by && p.fatherId) {
    const fy = people[p.fatherId]?.birth?.year;
    if (fy && fy >= by) err("father-not-older",
      `${id} (born ${by}) has fatherId="${p.fatherId}" born ${fy}`);
  }
  if (by && p.motherId) {
    const my = people[p.motherId]?.birth?.year;
    if (my && my >= by) err("mother-not-older",
      `${id} (born ${by}) has motherId="${p.motherId}" born ${my}`);
  }
}

// ---- 2. Marriage integrity ---------------------------------------------
for (const m of data.marriages || []) {
  if (!m.id) { err("marriage-no-id", `marriage missing id`); continue; }
  if (!Array.isArray(m.spouseIds) || m.spouseIds.length !== 2) {
    err("marriage-bad-spouses", `${m.id}: spouseIds must be array of length 2`);
    continue;
  }
  const [a, b] = m.spouseIds;
  if (a === b) err("marriage-self", `${m.id}: spouse married to themselves`);
  if (!ids.has(a)) err("marriage-missing-spouse", `${m.id}: spouseId="${a}" not found`);
  if (!ids.has(b)) err("marriage-missing-spouse", `${m.id}: spouseId="${b}" not found`);
  // Same-gender: warn only (not a hard error since we may have unknown gender).
  const gA = people[a]?.gender, gB = people[b]?.gender;
  if (gA && gB && gA === gB) warn("marriage-same-gender",
    `${m.id}: both spouses have gender="${gA}"`);
  if (m.year && (m.year < 1500 || m.year > 2100)) warn("marriage-year-odd",
    `${m.id}: year=${m.year} outside 1500–2100`);
}

// Marriage uniqueness: same pair shouldn't appear twice.
const seenPairs = new Map();
for (const m of data.marriages || []) {
  if (!Array.isArray(m.spouseIds) || m.spouseIds.length !== 2) continue;
  const key = [...m.spouseIds].sort().join("|");
  if (seenPairs.has(key)) {
    err("marriage-duplicate", `marriages ${seenPairs.get(key)} and ${m.id} record the same pair ${key}`);
  } else {
    seenPairs.set(key, m.id);
  }
}

// ---- 3. Milk relation integrity ----------------------------------------
for (const r of data.milkRelations || []) {
  if (!r.id) err("milk-no-id", `milk relation missing id`);
  for (const pid of r.personIds || []) {
    if (!ids.has(pid)) err("milk-missing-person", `${r.id}: personId="${pid}" not found`);
  }
}

// ---- 4. Top-level references -------------------------------------------
for (const rid of data.rootIds || []) {
  if (!ids.has(rid)) err("missing-root", `rootIds contains "${rid}" which doesn't exist`);
}
if (data.currentUserId && !ids.has(data.currentUserId)) {
  err("missing-current-user", `currentUserId="${data.currentUserId}" does not exist`);
}
for (const aid of data.adminUserIds || []) {
  if (!ids.has(aid)) err("missing-admin", `adminUserIds contains "${aid}" which doesn't exist`);
}

// ---- 5. Ancestry cycle detection ---------------------------------------
// Walk up via fatherId; if we revisit a node we have a cycle.
for (const id of ids) {
  const seen = new Set();
  let cursor = id;
  while (cursor) {
    if (seen.has(cursor)) {
      err("ancestry-cycle", `${id}: ancestry cycle detected at "${cursor}"`);
      break;
    }
    seen.add(cursor);
    cursor = people[cursor]?.fatherId;
  }
  // Same via motherId.
  const seen2 = new Set();
  cursor = id;
  while (cursor) {
    if (seen2.has(cursor)) {
      err("ancestry-cycle-maternal", `${id}: maternal-line cycle at "${cursor}"`);
      break;
    }
    seen2.add(cursor);
    cursor = people[cursor]?.motherId;
  }
}

// ---- 6. Duplicate fullName (info-level) --------------------------------
const byName = new Map();
for (const [id, p] of Object.entries(people)) {
  const k = norm(p.fullName);
  if (!k) continue;
  if (!byName.has(k)) byName.set(k, []);
  byName.get(k).push(id);
}
for (const [k, idsList] of byName) {
  if (idsList.length > 1) {
    info("duplicate-fullname", `"${people[idsList[0]].fullName}" appears in ${idsList.length} records: ${idsList.join(", ")}`);
  }
}

// ---- 7. Orphan placeholders (info) -------------------------------------
// External placeholders with no children, no marriages, no role.
const referenced = new Set();
for (const p of Object.values(people)) {
  if (p.fatherId) referenced.add(p.fatherId);
  if (p.motherId) referenced.add(p.motherId);
  if (p.tribalRootId) referenced.add(p.tribalRootId);
}
for (const m of data.marriages || []) {
  for (const sid of m.spouseIds || []) referenced.add(sid);
}
for (const r of data.milkRelations || []) {
  for (const pid of r.personIds || []) referenced.add(pid);
}
for (const [id, p] of Object.entries(people)) {
  if (p.isPlaceholder && !referenced.has(id) && !data.rootIds?.includes(id)) {
    info("orphan-placeholder", `${id} ("${p.fullName}") is a placeholder with no incoming refs`);
  }
}

// ---- Print report ------------------------------------------------------
function group(label, items) {
  if (!items.length) { console.log(`✓ ${label}: 0`); return; }
  console.log(`\n${label} (${items.length}):`);
  for (const x of items) console.log(`  [${x.code}] ${x.msg}`);
}

console.log("=".repeat(60));
console.log(` تحقّق من سلامة بيانات seed.json`);
console.log("=".repeat(60));
console.log(`  أشخاص: ${Object.keys(people).length}`);
console.log(`  زواجات: ${(data.marriages || []).length}`);
console.log(`  علاقات رضاعة: ${(data.milkRelations || []).length}`);

group("ERROR  ", errors);
group("WARN   ", warnings);
group("INFO   ", infos);

console.log();
if (errors.length === 0 && warnings.length === 0) {
  console.log("✓ all clean — no errors or warnings");
} else if (errors.length === 0) {
  console.log(`✓ no errors (${warnings.length} warnings, ${infos.length} info notes)`);
} else {
  console.log(`✗ ${errors.length} error(s), ${warnings.length} warning(s), ${infos.length} info note(s)`);
}

process.exit(errors.length > 0 ? 1 : 0);
