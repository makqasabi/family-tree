// Add/edit person modal. Exposes every editable field, including
// multiple marriages, milk-kinship, kunya/alias, and a "hide DOB" flag.

import {
  getData, getPerson, allPeople, addPerson, updatePerson,
  addMarriage, removeMarriage, setMilkRelationForPerson,
  spousesOf, milkRelationsOf, isBirthHidden,
  arabicNormalize
} from "./data.js";

const root = document.getElementById("modal-root");

// Per-form working state for marriages and milk:
let stagedAdds = [];      // {tempKey, spouseId, year, order}
let stagedRemovals = [];  // marriage ids to delete on save

export function open({ editId = null, prefilledFatherId = null, prefilledMotherId = null, onSave } = {}) {
  stagedAdds = [];
  stagedRemovals = [];

  const editing = editId ? getPerson(editId) : null;
  const initial = editing ? { id: editId, ...editing } : {
    fullName: "", given: "", family: "القصبي", gender: "male",
    fatherId: prefilledFatherId, motherId: prefilledMotherId,
    kunya: "", alias: "",
    birth: {}, death: {}, places: [], occupations: [], notes: "",
    isPlaceholder: false, external: false, tribe: ""
  };

  const existingMarriages = editing ? spousesOf(editId) : [];
  const existingMilk = editing ? milkRelationsOf(editId)[0] : null;

  root.innerHTML = `
    <div class="form-modal" id="pf-modal">
      <div class="form-card">
        <h2>${editing ? "تعديل" : "إضافة شخص"}</h2>

        <div class="row">
          <div>
            <label>الاسم الأول *</label>
            <input id="f-given" value="${attr(initial.given)}" />
          </div>
          <div>
            <label>اسم العائلة</label>
            <input id="f-family" value="${attr(initial.family)}" />
          </div>
        </div>

        <label>الاسم الكامل (اتركه فارغًا للتعبئة التلقائية من الأب والجد)</label>
        <input id="f-fullName" value="${attr(initial.fullName)}" placeholder="مثال: عثمان عبدالله عبدالعزيز القصبي" />

        <div class="row">
          <div>
            <label>الكنية</label>
            <input id="f-kunya" value="${attr(initial.kunya)}" placeholder="مثال: أبو عثمان" />
          </div>
          <div>
            <label>اللقب / الشهرة</label>
            <input id="f-alias" value="${attr(initial.alias)}" />
          </div>
        </div>

        <div class="row">
          <div>
            <label>الجنس</label>
            <select id="f-gender">
              <option value="male"${initial.gender === "male" ? " selected" : ""}>ذكر</option>
              <option value="female"${initial.gender === "female" ? " selected" : ""}>أنثى</option>
              <option value=""${!initial.gender ? " selected" : ""}>غير محدد</option>
            </select>
          </div>
          <div>
            <label>القبيلة</label>
            <input id="f-tribe" value="${attr(initial.tribe)}" />
          </div>
        </div>

        <div class="row">
          <div>
            <label>الأب</label>
            ${personPicker("f-father", initial.fatherId)}
          </div>
          <div>
            <label>الأم</label>
            ${personPicker("f-mother", initial.motherId)}
          </div>
        </div>

        <fieldset class="fset">
          <legend>الزواج</legend>
          <div id="marriages-list">
            ${existingMarriages.map(m => marriageRowExisting(m)).join("")}
          </div>
          <div id="marriages-pending"></div>
          <button type="button" class="ghost" id="add-marriage-btn">+ إضافة زواج</button>
        </fieldset>

        <fieldset class="fset">
          <legend>الميلاد</legend>
          <div class="row">
            <div>
              <label>السنة</label>
              <input id="f-birth-year" type="number" value="${attr(initial.birth?.year)}" />
            </div>
            <div>
              <label>الشهر</label>
              <input id="f-birth-month" type="number" min="1" max="12" value="${attr(initial.birth?.month)}" />
            </div>
            <div>
              <label>اليوم</label>
              <input id="f-birth-day" type="number" min="1" max="31" value="${attr(initial.birth?.day)}" />
            </div>
            <div>
              <label>المكان</label>
              <input id="f-birth-place" value="${attr(initial.birth?.place)}" />
            </div>
          </div>
          <label class="inline-check">
            <input type="checkbox" id="f-birth-hidden" ${isBirthHidden(initial) ? "checked" : ""}/>
            إخفاء تاريخ الميلاد (الافتراضي للإناث)
          </label>
          <label class="inline-check">
            <input type="checkbox" id="f-birth-approx" ${initial.birth?.approximate ? "checked" : ""}/>
            تاريخ تقريبي
          </label>
        </fieldset>

        <fieldset class="fset">
          <legend>الوفاة</legend>
          <div class="row">
            <div>
              <label>السنة</label>
              <input id="f-death-year" type="number" value="${attr(initial.death?.year)}" />
            </div>
            <div>
              <label>الشهر</label>
              <input id="f-death-month" type="number" min="1" max="12" value="${attr(initial.death?.month)}" />
            </div>
            <div>
              <label>اليوم</label>
              <input id="f-death-day" type="number" min="1" max="31" value="${attr(initial.death?.day)}" />
            </div>
            <div>
              <label>المكان</label>
              <input id="f-death-place" value="${attr(initial.death?.place)}" />
            </div>
          </div>
        </fieldset>

        <label>الأماكن (مفصولة بفواصل)</label>
        <input id="f-places" value="${attr((initial.places || []).join("، "))}" />

        <label>المهن (مفصولة بفواصل)</label>
        <input id="f-occupations" value="${attr((initial.occupations || []).join("، "))}" />

        <fieldset class="fset">
          <legend>الرضاعة</legend>
          <label>إخوة الرضاعة (مفصولين بفواصل)</label>
          <input id="f-milk-names" value="${attr((existingMilk?.milkSiblingNames || []).join("، "))}" />
          <label>ملاحظة عن الرضاعة</label>
          <input id="f-milk-notes" value="${attr(existingMilk?.notes)}" />
        </fieldset>

        <fieldset class="fset">
          <legend>الأحداث الحياتية</legend>
          <p class="muted" style="margin: 0 0 6px; font-size: 0.85em;">سطر لكل حدث بصيغة: <code>السنة - الوصف</code> (مثال: <code>١٩٧١ - قَدِم إلى الرياض</code>). الأحداث ستظهر في تبويب "الأحداث".</p>
          <textarea id="f-events" rows="4" placeholder="١٩٧٢ - تخرّج من الجامعة&#10;١٩٧٥ - سافر إلى أمريكا">${escapeHTML(eventsToText(initial.events))}</textarea>
        </fieldset>

        <label>ملاحظات عامة</label>
        <textarea id="f-notes">${escapeHTML(initial.notes || "")}</textarea>

        <div class="row">
          <div>
            <label class="inline-check">
              <input type="checkbox" id="f-placeholder" ${initial.isPlaceholder ? "checked" : ""}/>
              غير موثّق (placeholder)
            </label>
          </div>
          <div>
            <label class="inline-check">
              <input type="checkbox" id="f-external" ${initial.external ? "checked" : ""}/>
              من عائلة خارجية (زوج/ة)
            </label>
          </div>
        </div>

        <div class="actions">
          <button id="pf-cancel" class="ghost">إلغاء</button>
          <button id="pf-save" class="primary">حفظ</button>
        </div>
      </div>
    </div>
  `;

  bindPicker("f-father", initial.fatherId);
  bindPicker("f-mother", initial.motherId);
  bindMarriageRows();

  // Sync hidden-DOB checkbox with gender unless the user has manually toggled it.
  let userToggledHidden = false;
  const hiddenBox = document.getElementById("f-birth-hidden");
  hiddenBox.addEventListener("change", () => { userToggledHidden = true; });
  document.getElementById("f-gender").addEventListener("change", e => {
    if (userToggledHidden) return;
    hiddenBox.checked = e.target.value === "female";
  });

  document.getElementById("add-marriage-btn").addEventListener("click", addPendingMarriage);

  const close = () => { root.innerHTML = ""; stagedAdds = []; stagedRemovals = []; };
  document.getElementById("pf-cancel").addEventListener("click", close);
  document.getElementById("pf-modal").addEventListener("click", e => {
    if (e.target.id === "pf-modal") close();
  });

  document.getElementById("pf-save").addEventListener("click", () => {
    const given = val("f-given").trim();
    if (!given) { alert("الاسم الأول مطلوب"); return; }
    const family = val("f-family").trim();
    let fullName = val("f-fullName").trim();
    if (!fullName) {
      const fatherId = readPicker("f-father");
      const father = fatherId ? getPerson(fatherId) : null;
      const grand = father?.fatherId ? getPerson(father.fatherId) : null;
      const lineageBits = [given];
      if (father) lineageBits.push(father.given || father.fullName.split(" ")[0]);
      if (grand) lineageBits.push(grand.given || grand.fullName.split(" ")[0]);
      if (family) lineageBits.push(family);
      fullName = lineageBits.join(" ");
    }
    const data = {
      fullName,
      given,
      family,
      kunya: val("f-kunya").trim() || null,
      alias: val("f-alias").trim() || null,
      gender: val("f-gender") || null,
      tribe: val("f-tribe").trim() || null,
      fatherId: readPicker("f-father") || null,
      motherId: readPicker("f-mother") || null,
      birth: pickDate("birth", true),
      death: pickDate("death", false),
      places: splitList(val("f-places")),
      occupations: splitList(val("f-occupations")),
      events: parseEvents(val("f-events")),
      notes: val("f-notes").trim(),
      isPlaceholder: document.getElementById("f-placeholder").checked,
      external: document.getElementById("f-external").checked
    };
    cleanup(data);

    let id;
    if (editing) {
      updatePerson(editId, data);
      id = editId;
    } else {
      id = addPerson(data);
    }

    // Marriage updates
    for (const mid of stagedRemovals) removeMarriage(mid);
    document.querySelectorAll("#marriages-pending .pending-marriage").forEach(row => {
      const spouseId = row.querySelector("[data-value]").value;
      if (!spouseId) return;
      const year = row.querySelector(".m-year").value;
      const order = row.querySelector(".m-order").value;
      addMarriage(id, spouseId, {
        ...(year ? { year: +year } : {}),
        ...(order ? { order: +order } : {})
      });
    });

    // Milk-kinship update
    setMilkRelationForPerson(id, {
      siblingNames: splitList(val("f-milk-names")),
      notes: val("f-milk-notes").trim()
    });

    close();
    if (onSave) onSave(id);
  });
}

function marriageRowExisting(m) {
  const sp = getPerson(m.spouseId);
  const name = sp ? sp.fullName : "(غير معروف)";
  const year = m.marriage.year ? ` — ${m.marriage.year}م` : "";
  const order = m.marriage.order ? ` — زواج ${m.marriage.order}` : "";
  return `
    <div class="marriage-row" data-marriage-id="${m.marriage.id}">
      <span>⚭ ${escapeHTML(name)}${escapeHTML(year)}${escapeHTML(order)}</span>
      <button type="button" class="ghost danger remove-marriage">حذف</button>
    </div>
  `;
}
function bindMarriageRows() {
  document.querySelectorAll(".marriage-row .remove-marriage").forEach(btn => {
    btn.addEventListener("click", () => {
      const row = btn.closest(".marriage-row");
      stagedRemovals.push(row.dataset.marriageId);
      row.remove();
    });
  });
}
let pendingCounter = 0;
function addPendingMarriage() {
  pendingCounter++;
  const id = `pending-${pendingCounter}`;
  const wrap = document.getElementById("marriages-pending");
  const div = document.createElement("div");
  div.className = "pending-marriage";
  div.innerHTML = `
    <div class="row">
      <div style="flex:2">${personPicker(id, "")}</div>
      <div style="flex:0 0 90px">
        <input class="m-year" type="number" placeholder="السنة" />
      </div>
      <div style="flex:0 0 90px">
        <input class="m-order" type="number" placeholder="ترتيب" min="1" />
      </div>
      <div style="flex:0 0 80px">
        <button type="button" class="ghost danger remove-pending">إزالة</button>
      </div>
    </div>
  `;
  wrap.appendChild(div);
  bindPicker(id, "");
  div.querySelector(".remove-pending").addEventListener("click", () => div.remove());
}

function attr(v) { return v == null ? "" : escapeHTML(String(v)); }
function val(id) { return document.getElementById(id).value; }
function splitList(s) { return s.split(/[،,]/).map(x => x.trim()).filter(Boolean); }
function pickDate(prefix, includeBirthExtras) {
  const y = val(`f-${prefix}-year`);
  const m = val(`f-${prefix}-month`);
  const d = val(`f-${prefix}-day`);
  const place = val(`f-${prefix}-place`);
  const out = {};
  if (y) out.year = +y;
  if (m) out.month = +m;
  if (d) out.day = +d;
  if (place) out.place = place;
  if (includeBirthExtras) {
    if (document.getElementById("f-birth-hidden").checked) out.hidden = true;
    if (document.getElementById("f-birth-approx").checked) out.approximate = true;
  }
  return Object.keys(out).length ? out : null;
}
function cleanup(data) {
  if (!data.birth) delete data.birth;
  if (!data.death) delete data.death;
  if (!data.places.length) delete data.places;
  if (!data.occupations.length) delete data.occupations;
  if (!data.events.length) delete data.events;
  if (!data.notes) delete data.notes;
  if (!data.tribe) delete data.tribe;
  if (!data.gender) delete data.gender;
  if (!data.kunya) delete data.kunya;
  if (!data.alias) delete data.alias;
  if (!data.isPlaceholder) delete data.isPlaceholder;
  if (!data.external) delete data.external;
  if (!data.fatherId) delete data.fatherId;
  if (!data.motherId) delete data.motherId;
}

// Parse the events textarea: each non-empty line in the form
// "YEAR - description" (or YEAR : description / YEAR — description),
// supporting Arabic-Indic digits. Returns [{year, label}, …].
function parseEvents(text) {
  return (text || "")
    .split("\n")
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => {
      const m = line.match(/^([٠-٩۰-۹0-9]+)\s*[-—:]\s*(.+)$/);
      if (!m) return null;
      const year = parseInt(arabicDigitsToLatin(m[1]), 10);
      if (!year) return null;
      return { year, label: m[2].trim() };
    })
    .filter(Boolean)
    .sort((a, b) => a.year - b.year);
}

function eventsToText(events) {
  if (!Array.isArray(events) || !events.length) return "";
  return events
    .slice()
    .sort((a, b) => (a.year || 0) - (b.year || 0))
    .map(e => `${e.year || "؟"} - ${e.label || ""}`)
    .join("\n");
}

function arabicDigitsToLatin(s) {
  return String(s).replace(/[٠-٩]/g, c => String.fromCharCode(c.charCodeAt(0) - 0x0630))
                  .replace(/[۰-۹]/g, c => String.fromCharCode(c.charCodeAt(0) - 0x06C0));
}

function personPicker(id, initialId) {
  const initial = initialId ? getPerson(initialId) : null;
  return `
    <div class="picker" data-picker="${id}">
      <input type="text" data-input
        placeholder="ابحث بالاسم أو اتركه فارغًا"
        value="${attr(initial ? initial.fullName : "")}"
        autocomplete="off" />
      <input type="hidden" data-value value="${attr(initialId || "")}" />
      <ul class="search-results" data-results></ul>
    </div>
  `;
}
function bindPicker(id, initialId) {
  const wrap = document.querySelector(`[data-picker="${id}"]`);
  if (!wrap) return;
  const input = wrap.querySelector("[data-input]");
  const hidden = wrap.querySelector("[data-value]");
  const results = wrap.querySelector("[data-results]");
  input.addEventListener("input", () => {
    const q = arabicNormalize(input.value);
    if (!q) { results.classList.remove("open"); hidden.value = ""; return; }
    const matches = allPeople()
      .filter(p => arabicNormalize(p.fullName).includes(q))
      .slice(0, 12);
    results.innerHTML = matches.map(p => `<li data-id="${p.id}">${escapeHTML(p.fullName)}</li>`).join("");
    results.classList.toggle("open", matches.length > 0);
    results.querySelectorAll("li").forEach(li => {
      li.addEventListener("click", () => {
        const pid = li.dataset.id;
        const p = getPerson(pid);
        input.value = p.fullName;
        hidden.value = pid;
        results.classList.remove("open");
      });
    });
  });
  document.addEventListener("click", e => {
    if (!wrap.contains(e.target)) results.classList.remove("open");
  });
}
function readPicker(id) {
  const wrap = document.querySelector(`[data-picker="${id}"]`);
  return wrap ? wrap.querySelector("[data-value]").value : "";
}

function escapeHTML(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;" }[c]));
}
