/* ═══════════════════════════════════════════════
   STAFFING BUDGET MODEL — v1
   System Pilot — 2026-04-12
   Architecture: All calculations are pure, deterministic JS.
   No hardcoded employee data. State persisted in localStorage.
═══════════════════════════════════════════════ */

'use strict';

// ─── STATE ──────────────────────────────────────
const State = {
  employees: [],       // working scenario (mutable)
  original: [],        // original upload (immutable reference)
  year: 2026,
  scenario: 'Base Case',
  contextTargetId: null,
  sortCol: null,       // column key currently sorted on
  sortDir: 'asc',     // 'asc' | 'desc'
  activeView: 'grid',  // 'grid' | 'report'
};

// ─── CHARTS ─────────────────────────────────────
let chartInstances = [];

// Apply global defaults once library is loaded
if (window.Chart) {
  Chart.defaults.color = '#9ca3af';
  Chart.defaults.font.family = 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
}

// ─── CONSTANTS ──────────────────────────────────
const WEEKS_PER_MONTH = 52 / 12; // 4.3333...
const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

// ─── PERSISTENCE ────────────────────────────────
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || '';
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY || '';
const supabase = supabaseUrl && supabaseKey ? createClient(supabaseUrl, supabaseKey) : null;

async function saveState() {
  if (supabase) {
    try {
      const payload = State.employees.map(emp => ({
          id: emp.id,
          name: emp.name,
          position: emp.position,
          department: emp.department,
          employeeType: emp.employeeType,
          annualSalary: emp.annualSalary,
          hourlyRate: emp.hourlyRate,
          hoursPerWeek: emp.hoursPerWeek,
          startDate: emp.startDate,
          termDate: emp.termDate,
          status: emp.status,
          billRate: emp.billRate,
          utilizationRate: emp.utilizationRate,
          vacationDays: emp.vacationDays,
          compensationHistory: emp.compensationHistory,
          notes: emp.notes
      }));
      if (payload.length > 0) {
          const { error } = await supabase.from('staffing_employees').upsert(payload);
          if (error) console.error('Supabase Save Error', error);
      }
    } catch(e) { console.error('Supabase Save Error', e); }
  } else {
    try {
      localStorage.setItem('staffing_scenario_active', JSON.stringify({
        employees: State.employees,
        year: State.year,
        scenario: State.scenario,
      }));
    } catch (e) { /* storage full — silent */ }
  }
}

function saveOriginal() {
  try {
    localStorage.setItem('staffing_original', JSON.stringify(State.original));
  } catch (e) {}
}

async function loadState() {
  if (supabase) {
    try {
      const { data, error } = await supabase.from('staffing_employees').select('*');
      if (error) throw error;
      if (data && data.length > 0) {
        State.employees = data;
        State.year = 2026;
        State.scenario = 'Base Case';
        return true;
      }
      return false;
    } catch (e) {
      console.error('Supabase Load Error', e);
      return false;
    }
  } else {
    try {
      const raw = localStorage.getItem('staffing_scenario_active');
      if (!raw) return false;
      const data = JSON.parse(raw);
      State.employees = data.employees || [];
      State.year = data.year || new Date().getFullYear();
      State.scenario = data.scenario || 'Base Case';
      return true;
    } catch (e) { return false; }
  }
}

function loadOriginal() {
  try {
    const raw = localStorage.getItem('staffing_original');
    if (!raw) return false;
    State.original = JSON.parse(raw);
    return true;
  } catch (e) { return false; }
}

// ─── UUID ────────────────────────────────────────
function uuid() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });
}

// ─── CALCULATION ENGINE ──────────────────────────

/**
 * Returns the number of calendar days in a given month.
 */
function daysInMonth(year, month) {
  return new Date(year, month, 0).getDate();
}

/**
 * Returns the applicable compensationHistory entry for a given JS Date.
 * Falls back to flat fields if no history exists.
 */
function getCompensationAt(emp, date) {
  if (!emp.compensationHistory || emp.compensationHistory.length === 0) {
    return { annualSalary: emp.annualSalary, hourlyRate: emp.hourlyRate,
             hoursPerWeek: emp.hoursPerWeek || 40, billRate: emp.billRate,
             utilizationRate: emp.utilizationRate, employeeType: emp.employeeType };
  }
  const sorted = [...emp.compensationHistory]
    .sort((a, b) => new Date(a.effectiveDate) - new Date(b.effectiveDate));
  let applicable = sorted[0];
  for (const entry of sorted) {
    if (new Date(entry.effectiveDate + 'T00:00:00') <= date) applicable = entry;
  }
  return applicable;
}

/**
 * Ensures an employee record has a compensationHistory array.
 * Migrates flat fields into the initial history entry.
 */
function migrateEmployee(emp) {
  if (!emp.compensationHistory || emp.compensationHistory.length === 0) {
    emp.compensationHistory = [{
      effectiveDate:   emp.startDate || `${State.year}-01-01`,
      annualSalary:    parseFloat(emp.annualSalary)    || 0,
      hourlyRate:      parseFloat(emp.hourlyRate)      || 0,
      hoursPerWeek:    parseFloat(emp.hoursPerWeek)    || 40,
      billRate:        parseFloat(emp.billRate)        || 0,
      utilizationRate: parseFloat(emp.utilizationRate) || 0,
      employeeType:    emp.employeeType || 'salary',
      changedAt:       new Date().toISOString(),
      changeNote:      'Initial',
    }];
  }
  return emp;
}

/**
 * Returns the number of active days in a date range [startDate, endDate] (inclusive)
 * constrained by the employee's startDate / termDate.
 */
function activeDaysInRange(emp, startDate, endDate) {
  const empStart = emp.startDate ? new Date(emp.startDate + 'T00:00:00') : null;
  const empEnd   = emp.termDate  ? new Date(emp.termDate  + 'T00:00:00') : null;
  if (empStart && empStart > endDate)   return 0;
  if (empEnd   && empEnd   < startDate) return 0;
  const effStart = (empStart && empStart > startDate) ? empStart : startDate;
  const effEnd   = (empEnd   && empEnd   < endDate)   ? empEnd   : endDate;
  if (effStart > effEnd) return 0;
  return Math.round((effEnd - effStart) / 86400000) + 1;
}

/**
 * Returns the total active days for an employee in a calendar month.
 */
function activeDaysInMonth(emp, year, month) {
  const total     = daysInMonth(year, month);
  const monthStart = new Date(year, month - 1, 1);
  const monthEnd   = new Date(year, month - 1, total);
  return activeDaysInRange(emp, monthStart, monthEnd);
}

/**
 * Calculates monthly EXPENSE, splitting at any mid-month compensation changes.
 */
function calcMonthlyExpense(emp, year, month) {
  const totalDays  = daysInMonth(year, month);
  if (activeDaysInMonth(emp, year, month) <= 0) return 0;

  // Collect change-point days within this month (day-of-month that a new rate kicks in)
  const history = emp.compensationHistory || [];
  const changePoints = [];
  for (const entry of history) {
    const ed = new Date(entry.effectiveDate + 'T00:00:00');
    if (ed.getFullYear() === year && (ed.getMonth() + 1) === month && ed.getDate() > 1) {
      changePoints.push(ed.getDate());
    }
  }
  const uniquePoints = [...new Set(changePoints)].sort((a, b) => a - b);

  // Build day segments
  const segments = [];
  let seg = 1;
  for (const cp of uniquePoints) { segments.push([seg, cp - 1]); seg = cp; }
  segments.push([seg, totalDays]);

  let total = 0;
  for (const [startDay, endDay] of segments) {
    const segDate  = new Date(year, month - 1, startDay);
    const segEnd   = new Date(year, month - 1, endDay);
    const comp     = getCompensationAt(emp, segDate);
    const active   = activeDaysInRange(emp, segDate, segEnd);
    if (active <= 0) continue;
    const ratio    = active / totalDays;
    const type     = comp.employeeType || emp.employeeType || 'salary';
    if (type === 'hourly') {
      total += (comp.hourlyRate || 0) * (comp.hoursPerWeek || 40) * WEEKS_PER_MONTH * ratio;
    } else {
      total += ((comp.annualSalary || 0) / 12) * ratio;
    }
  }
  return total;
}

/**
 * Calculates monthly BILLABLE REVENUE, splitting at mid-month rate changes.
 */
function calcMonthlyRevenue(emp, year, month) {
  const totalDays  = daysInMonth(year, month);
  if (activeDaysInMonth(emp, year, month) <= 0) return 0;

  const history = emp.compensationHistory || [];
  const changePoints = [];
  for (const entry of history) {
    const ed = new Date(entry.effectiveDate + 'T00:00:00');
    if (ed.getFullYear() === year && (ed.getMonth() + 1) === month && ed.getDate() > 1) {
      changePoints.push(ed.getDate());
    }
  }
  const uniquePoints = [...new Set(changePoints)].sort((a, b) => a - b);
  const segments = [];
  let seg = 1;
  for (const cp of uniquePoints) { segments.push([seg, cp - 1]); seg = cp; }
  segments.push([seg, totalDays]);

  let revenue = 0;
  for (const [startDay, endDay] of segments) {
    const segDate = new Date(year, month - 1, startDay);
    const segEnd  = new Date(year, month - 1, endDay);
    const comp    = getCompensationAt(emp, segDate);
    const br      = parseFloat(comp.billRate)        || 0;
    const util    = parseFloat(comp.utilizationRate) || 0;
    if (br <= 0 || util <= 0) continue;
    const active  = activeDaysInRange(emp, segDate, segEnd);
    if (active <= 0) continue;
    const ratio   = active / totalDays;
    const hrs     = parseFloat(comp.hoursPerWeek) || 40;
    revenue += br * (hrs * util) * WEEKS_PER_MONTH * ratio;
  }
  return revenue;
}

// Legacy helpers retained for month check — no direct calls needed any more
function _legacyActiveDaysInMonth(emp, year, month) {
  const total = daysInMonth(year, month);
  const monthStart = new Date(year, month - 1, 1);
  const monthEnd   = new Date(year, month - 1, total);
  const empStart = emp.startDate ? new Date(emp.startDate) : null;
  const empEnd   = emp.termDate  ? new Date(emp.termDate)  : null;
  if (empStart && empStart > monthEnd) return 0;
  if (empEnd   && empEnd   < monthStart) return 0;
  const effectiveStart = (empStart && empStart > monthStart) ? empStart : monthStart;
  const effectiveEnd   = (empEnd   && empEnd   < monthEnd)   ? empEnd   : monthEnd;
  return Math.round((effectiveEnd - effectiveStart) / 86400000) + 1;
}

// ─── COMP HISTORY ACTIONS ────────────────────────

/**
 * Push a new compensation history entry (or overwrite same effectiveDate).
 */
function applyCompensationChange(emp, fields, effectiveDate, note) {
  // Guard: ensure effectiveDate is a valid YYYY-MM-DD string
  const testDate = new Date(effectiveDate + 'T00:00:00');
  if (!effectiveDate || isNaN(testDate.getTime())) {
    effectiveDate = new Date().toISOString().slice(0, 10);
  }
  const current = getCompensationAt(emp, new Date(effectiveDate + 'T00:00:00'));
  const newEntry = {
    effectiveDate,
    annualSalary:    fields.annualSalary    !== undefined ? fields.annualSalary    : (current.annualSalary    || 0),
    hourlyRate:      fields.hourlyRate      !== undefined ? fields.hourlyRate      : (current.hourlyRate      || 0),
    hoursPerWeek:    fields.hoursPerWeek    !== undefined ? fields.hoursPerWeek    : (current.hoursPerWeek    || 40),
    billRate:        fields.billRate        !== undefined ? fields.billRate        : (current.billRate        || 0),
    utilizationRate: fields.utilizationRate !== undefined ? fields.utilizationRate : (current.utilizationRate || 0),
    employeeType:    fields.employeeType    !== undefined ? fields.employeeType    : (current.employeeType    || emp.employeeType),
    vacationDays:    fields.vacationDays    !== undefined ? fields.vacationDays    : (current.vacationDays    !== undefined ? current.vacationDays : (emp.vacationDays !== undefined ? emp.vacationDays : null)),
    changedAt:       new Date().toISOString(),
    changeNote:      note || '',
  };
  // Remove same effectiveDate duplicate
  emp.compensationHistory = (emp.compensationHistory || []).filter(e => e.effectiveDate !== effectiveDate);
  emp.compensationHistory.push(newEntry);
  emp.compensationHistory.sort((a, b) => new Date(a.effectiveDate) - new Date(b.effectiveDate));
  // Sync flat snapshot to latest
  const latest = emp.compensationHistory[emp.compensationHistory.length - 1];
  emp.annualSalary    = latest.annualSalary;
  emp.hourlyRate      = latest.hourlyRate;
  emp.hoursPerWeek    = latest.hoursPerWeek;
  emp.billRate        = latest.billRate;
  emp.utilizationRate = latest.utilizationRate;
  emp.employeeType    = latest.employeeType;
  if (latest.vacationDays !== null && latest.vacationDays !== undefined) emp.vacationDays = latest.vacationDays;
}

// ─── CSV DIFF ENGINE ─────────────────────────────

const COMP_FIELDS = ['annualSalary','hourlyRate','hoursPerWeek','billRate','utilizationRate','employeeType','vacationDays'];
const META_FIELDS = ['position','department','status','startDate','termDate','notes'];

function normName(s) { return String(s || '').trim().toLowerCase(); }

function fmtFieldVal(field, val) {
  if (val === null || val === undefined || val === '') return '—';
  if (['annualSalary','hourlyRate','billRate'].includes(field)) return fmt$(parseFloat(val));
  if (field === 'utilizationRate') return fmtPct(parseFloat(val));
  if (['startDate','termDate'].includes(field)) return fmtDate(val);
  return String(val);
}

function diffCSV(incoming, existing) {
  const existMap = new Map(existing.map(e => [normName(e.name), e]));
  const incMap   = new Map(incoming.map(e => [normName(e.name), e]));

  const added = [], removed = [], changed = [], unchanged = [];

  for (const [nm, inc] of incMap) {
    if (!existMap.has(nm)) { added.push(inc); continue; }
    const ext = existMap.get(nm);
    // Get current effective comp for comparison
    const currentComp = getCompensationAt(ext, new Date());

    const fieldDiffs = [];
    for (const field of COMP_FIELDS) {
      const oldVal = field === 'annualSalary'    ? (currentComp.annualSalary    ?? ext.annualSalary)
                   : field === 'hourlyRate'      ? (currentComp.hourlyRate      ?? ext.hourlyRate)
                   : field === 'hoursPerWeek'    ? (currentComp.hoursPerWeek    ?? ext.hoursPerWeek)
                   : field === 'billRate'        ? (currentComp.billRate        ?? ext.billRate)
                   : field === 'utilizationRate' ? (currentComp.utilizationRate ?? ext.utilizationRate)
                   : (currentComp.employeeType   ?? ext.employeeType);
      const newVal = parseFloat(inc[field]) || inc[field];
      const oldNum = parseFloat(oldVal);
      const newNum = parseFloat(newVal);
      const numericallyDifferent = !isNaN(oldNum) && !isNaN(newNum) && Math.abs(oldNum - newNum) > 0.01;
      const stringDifferent = isNaN(oldNum) && String(oldVal || '').toLowerCase() !== String(newVal || '').toLowerCase();
      if (numericallyDifferent || stringDifferent) {
        fieldDiffs.push({ field, oldVal, newVal, isComp: true });
      }
    }
    for (const field of META_FIELDS) {
      const oldVal = String(ext[field] || '').trim();
      const newVal = String(inc[field] || '').trim();
      if (oldVal.toLowerCase() !== newVal.toLowerCase()) {
        fieldDiffs.push({ field, oldVal, newVal, isComp: false });
      }
    }
    if (fieldDiffs.length > 0) changed.push({ existing: ext, incoming: inc, fieldDiffs });
    else unchanged.push(ext);
  }
  for (const [nm, ext] of existMap) {
    if (!incMap.has(nm)) removed.push(ext);
  }
  return { added, removed, changed, unchanged };
}

// ─── IMPORT REVIEW MODAL ────────────────────────

let _importDiff   = null;
let _importIncoming = null;

function openModalImportReview(diff, incoming) {
  _importDiff    = diff;
  _importIncoming = incoming;

  const today = new Date().toISOString().slice(0, 10);
  const totalChanged = diff.changed.length;
  const totalNew     = diff.added.length;
  const totalDropped = diff.removed.length;
  const totalUnchanged = diff.unchanged.length;

  function buildChangedHtml() {
    if (totalChanged === 0) return '<div style="color:var(--text-muted);font-size:12px;padding:20px 0;text-align:center">No compensation or metadata changes detected.</div>';
    return diff.changed.map((item, idx) => {
      const compDiffs = item.fieldDiffs.filter(f => f.isComp);
      const metaDiffs = item.fieldDiffs.filter(f => !f.isComp);
      const fieldRows = item.fieldDiffs.map(f =>
        `<div class="diff-field">
          <span class="diff-field-label">${f.field}</span>
          <span class="diff-field-old">${fmtFieldVal(f.field, f.oldVal)}</span>
          <span class="diff-field-new">${fmtFieldVal(f.field, f.newVal)}</span>
        </div>`).join('');
      const effDateRow = compDiffs.length > 0 ? `
        <div class="diff-eff-date">
          <label>Effective Date</label>
          <input type="date" class="form-input" id="eff-date-${idx}" value="${today}" />
          <input type="text" class="form-input" id="eff-note-${idx}" placeholder="Change note (optional)" />
        </div>` : `<div style="font-size:10px;color:var(--text-muted);margin-top:6px">Metadata update — applied immediately, no effective date needed.</div>`;
      return `<div class="diff-card" id="diff-card-${idx}">
        <div class="diff-card-header">
          <div><div class="diff-card-name">${escHtml(item.existing.name)}</div><div class="diff-card-pos">${escHtml(item.existing.position)} · ${escHtml(item.existing.department)}</div></div>
          <label><input type="checkbox" id="apply-chk-${idx}" checked /> Apply</label>
        </div>
        <div class="diff-field-list">${fieldRows}</div>
        ${effDateRow}
      </div>`;
    }).join('');
  }

  function buildAddedHtml() {
    if (totalNew === 0) return '<div style="color:var(--text-muted);font-size:12px;padding:20px 0;text-align:center">No new employees in this CSV.</div>';
    return diff.added.map((emp, idx) =>
      `<div class="diff-card">
        <div class="diff-card-header">
          <div><div class="diff-card-name">${escHtml(emp.name)}</div><div class="diff-card-pos">${escHtml(emp.position)} · ${escHtml(emp.department)} · ${escHtml(emp.startDate)}</div></div>
          <label><input type="checkbox" id="add-chk-${idx}" checked /> Add</label>
        </div>
      </div>`).join('');
  }

  function buildDroppedHtml() {
    if (totalDropped === 0) return '<div style="color:var(--text-muted);font-size:12px;padding:20px 0;text-align:center">No employees removed from this CSV.</div>';
    return diff.removed.map((emp, idx) =>
      `<div class="diff-card">
        <div class="diff-card-header">
          <div><div class="diff-card-name">${escHtml(emp.name)}</div><div class="diff-card-pos">${escHtml(emp.position)} · ${escHtml(emp.department)}</div></div>
          <label style="gap:4px">
            <input type="checkbox" id="drop-chk-${idx}" checked />
            <select class="form-select" id="drop-action-${idx}" style="padding:3px 8px;font-size:11px;width:auto">
              <option value="term">Mark as Termed</option>
              <option value="delete">Delete Row</option>
            </select>
          </label>
        </div>
        <div class="diff-eff-date"><label>Term Date</label><input type="date" class="form-input" id="drop-date-${idx}" value="${today}" /></div>
      </div>`).join('');
  }

  const body = `
    <div class="diff-summary">
      <span class="diff-pill green">🟢 ${totalNew} New</span>
      <span class="diff-pill red">🔴 ${totalDropped} Dropped</span>
      <span class="diff-pill amber">🟡 ${totalChanged} Changed</span>
      <span class="diff-pill muted">✅ ${totalUnchanged} Unchanged</span>
    </div>
    <div class="diff-tabs">
      <button class="diff-tab tab-amber active" id="dtab-changed" onclick="switchDiffTab('changed')">Changes (${totalChanged})</button>
      <button class="diff-tab tab-green"  id="dtab-added"   onclick="switchDiffTab('added')"  >New (${totalNew})</button>
      <button class="diff-tab tab-red"    id="dtab-dropped" onclick="switchDiffTab('dropped')">Dropped (${totalDropped})</button>
    </div>
    <div class="diff-list" id="diff-panel-changed">${buildChangedHtml()}</div>
    <div class="diff-list" id="diff-panel-added"   style="display:none">${buildAddedHtml()}</div>
    <div class="diff-list" id="diff-panel-dropped" style="display:none">${buildDroppedHtml()}</div>
  `;

  document.getElementById('modal-title').textContent    = 'Import Review';
  document.getElementById('modal-subtitle').textContent = `Reviewing ${incoming.length} incoming employees against ${State.employees.length} existing`;
  document.getElementById('modal-body').innerHTML = body;
  document.getElementById('modal-save').style.display = '';
  document.getElementById('modal-save').textContent = 'Apply Selected Changes';
  modalSaveCallback = commitImport;
  document.getElementById('modal-overlay').classList.add('open');
}

window.switchDiffTab = function(tab) {
  ['changed','added','dropped'].forEach(t => {
    document.getElementById(`dtab-${t}`).classList.toggle('active', t === tab);
    document.getElementById(`diff-panel-${t}`).style.display = t === tab ? '' : 'none';
  });
};

function commitImport() {
  const diff = _importDiff;
  if (!diff) return;

  // Apply changed
  diff.changed.forEach((item, idx) => {
    const chk = document.getElementById(`apply-chk-${idx}`);
    if (!chk || !chk.checked) return;
    const emp = item.existing;

    const compDiffs = item.fieldDiffs.filter(f => f.isComp);
    const metaDiffs = item.fieldDiffs.filter(f => !f.isComp);

    // Apply meta fields immediately
    metaDiffs.forEach(f => { emp[f.field] = f.newVal; });

    // Apply comp changes with effective date
    if (compDiffs.length > 0) {
      const effDateEl = document.getElementById(`eff-date-${idx}`);
      const effNoteEl = document.getElementById(`eff-note-${idx}`);
      const effDate   = effDateEl ? effDateEl.value : new Date().toISOString().slice(0, 10);
      const note      = effNoteEl ? effNoteEl.value.trim() : 'CSV import update';
      const fields    = {};
      compDiffs.forEach(f => {
        fields[f.field] = isNaN(parseFloat(f.newVal)) ? f.newVal : parseFloat(f.newVal);
      });
      applyCompensationChange(emp, fields, effDate, note || 'CSV import update');
    }
  });

  // Apply added
  diff.added.forEach((inc, idx) => {
    const chk = document.getElementById(`add-chk-${idx}`);
    if (!chk || !chk.checked) return;
    const newEmp = { ...inc, id: uuid() };
    migrateEmployee(newEmp);
    State.employees.push(newEmp);
  });

  // Apply dropped
  diff.removed.forEach((emp, idx) => {
    const chk    = document.getElementById(`drop-chk-${idx}`);
    if (!chk || !chk.checked) return;
    const action = document.getElementById(`drop-action-${idx}`)?.value || 'term';
    if (action === 'delete') {
      State.employees = State.employees.filter(e => e.id !== emp.id);
    } else {
      const termDate = document.getElementById(`drop-date-${idx}`)?.value || new Date().toISOString().slice(0, 10);
      emp.termDate = termDate;
      emp.status   = 'termed';
    }
  });

  renderAll();
  toast(`Import applied. ${diff.changed.length} updated, ${diff.added.length} added, ${diff.removed.length} actioned.`, 'success');
}

// ─── VIEW CHANGE HISTORY MODAL ──────────────────

function openModalViewHistory(emp) {
  const history = (emp.compensationHistory || []).slice().reverse();
  const FIELD_LABELS = {
    annualSalary: 'Annual Salary', hourlyRate: 'Hourly Rate',
    hoursPerWeek: 'Hrs / Week', billRate: 'Bill Rate',
    utilizationRate: 'Utilization', employeeType: 'Emp Type',
  };

  let html = `<div class="history-timeline">`;
  history.forEach((entry, i) => {
    const prev  = history[i + 1];
    const changedAt = entry.changedAt ? new Date(entry.changedAt).toLocaleString('en-US', { month:'short', day:'numeric', year:'numeric', hour:'numeric', minute:'2-digit' }) : '—';
    const effDisp   = fmtDate(entry.effectiveDate);

    const fieldRows = Object.keys(FIELD_LABELS).map(field => {
      const newVal = entry[field];
      const oldVal = prev ? prev[field] : null;
      const changed = prev && String(oldVal) !== String(newVal);
      const display = fmtFieldVal(field, newVal);
      const oldDisplay = prev ? fmtFieldVal(field, oldVal) : null;
      if (i === history.length - 1 || changed) {
        return `<div class="history-field-row">
          <span class="history-field-label">${FIELD_LABELS[field]}</span>
          ${changed ? `<span class="history-field-old">${oldDisplay}</span><span class="history-field-new">${display}</span>`
                    : `<span class="history-field-val">${display}</span>`}
        </div>`;
      }
      return '';
    }).join('');

    html += `<div class="history-entry">
      <div class="history-entry-date">${changedAt}</div>
      <div class="history-entry-effective">Effective: ${effDisp}</div>
      ${entry.changeNote ? `<div class="history-entry-note">${escHtml(entry.changeNote)}</div>` : ''}
      ${fieldRows}
    </div>`;
  });
  html += '</div>';
  if (history.length === 0) html = '<div style="color:var(--text-muted);text-align:center;padding:20px">No history yet.</div>';

  openModal('Change History', emp.name, html, null);
}

/**
 * Builds the full expense + revenue grid for all employees in a given year.
 * @param {object[]} employees
 * @param {number}   year
 * @returns {object}  { rows: [{emp, expenses[12], revenues[12], expTotal, revTotal}], monthExpTotals[12], monthRevTotals[12], grandExpTotal, grandRevTotal }
 */
function buildGrid(employees, year) {
  const rows = employees.map(emp => {
    const expenses  = [];
    const revenues  = [];
    let expTotal = 0;
    let revTotal = 0;

    for (let m = 1; m <= 12; m++) {
      const e = calcMonthlyExpense(emp, year, m);
      const r = calcMonthlyRevenue(emp, year, m);
      expenses.push(e);
      revenues.push(r);
      expTotal += e;
      revTotal += r;
    }

    return { emp, expenses, revenues, expTotal, revTotal };
  });

  const monthExpTotals = Array.from({ length: 12 }, (_, i) =>
    rows.reduce((s, r) => s + r.expenses[i], 0));
  const monthRevTotals = Array.from({ length: 12 }, (_, i) =>
    rows.reduce((s, r) => s + r.revenues[i], 0));

  const grandExpTotal = monthExpTotals.reduce((a, b) => a + b, 0);
  const grandRevTotal = monthRevTotals.reduce((a, b) => a + b, 0);

  return { rows, monthExpTotals, monthRevTotals, grandExpTotal, grandRevTotal };
}

// ─── FORMATTERS ──────────────────────────────────
function fmt$(n, decimals = 0) {
  if (!n && n !== 0) return '—';
  if (n === 0) return '—';
  return '$' + Number(n).toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

function fmtDate(d) {
  if (!d) return '—';
  try {
    const dt = new Date(d + 'T12:00:00');
    return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  } catch { return d; }
}

function fmtPct(n) {
  if (!n && n !== 0) return '—';
  return (parseFloat(n) * 100).toFixed(0) + '%';
}

// ─── CSV PARSER ──────────────────────────────────
function parseCSV(text) {
  // Strip BOM
  const clean = text.replace(/^\uFEFF/, '');
  const lines = clean.split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) throw new Error('CSV must have a header row and at least one data row.');

  // Header mapping (case-insensitive, strip quotes/spaces)
  const rawHeaders = lines[0].split(',').map(h => h.replace(/["']/g, '').trim().toLowerCase());
  const headerMap = {
    name: ['name', 'fullname', 'full name', 'employee name', 'employee'],
    position: ['position', 'title', 'job title', 'role'],
    department: ['department', 'dept', 'team'],
    employeeType: ['employeetype', 'type', 'emp type', 'employment type'],
    annualSalary: ['annualsalary', 'salary', 'annual salary', 'base salary', 'annual pay'],
    hourlyRate: ['hourlyrate', 'hourly rate', 'hourly', 'rate'],
    hoursPerWeek: ['hoursperweek', 'hours per week', 'hours/week', 'hours'],
    startDate: ['startdate', 'start date', 'hire date', 'hiredate', 'start'],
    termDate: ['termdate', 'term date', 'termination date', 'end date', 'enddate', 'end'],
    billRate: ['billrate', 'bill rate', 'billing rate', 'client rate'],
    utilizationRate: ['utilizationrate', 'utilization rate', 'utilization', 'util', 'util rate', 'util%'],
    status: ['status'],
    notes: ['notes', 'note', 'comments'],
  };

  // Map raw headers → field keys
  const colIndex = {};
  Object.entries(headerMap).forEach(([field, aliases]) => {
    const idx = rawHeaders.findIndex(h => aliases.includes(h));
    if (idx !== -1) colIndex[field] = idx;
  });

  if (!('name' in colIndex)) throw new Error('CSV is missing a "name" column.');

  const errors = [];
  const employees = [];

  lines.slice(1).forEach((line, i) => {
    if (!line.trim()) return;
    // Basic CSV split (handles quoted commas)
    const cols = line.match(/(".*?"|[^,]+|(?<=,)(?=,)|(?<=,)$|^(?=,))/g) || line.split(',');
    const get = field => {
      const idx = colIndex[field];
      if (idx === undefined || idx >= cols.length) return '';
      return (cols[idx] || '').replace(/^["']|["']$/g, '').trim();
    };

    const rawType = get('employeeType').toLowerCase();
    const empType = rawType.startsWith('h') ? 'hourly' : 'salary';

    const rawStatus = get('status').toLowerCase();
    let status = 'active';
    if (rawStatus === 'termed' || rawStatus === 'terminated') status = 'termed';
    else if (rawStatus === 'planned') status = 'planned';

    const rawUtil = get('utilizationRate');
    let utilRate = parseFloat(rawUtil) || 0;
    // Accept "80" or "80%" or "0.80"
    if (utilRate > 1) utilRate = utilRate / 100;

    const emp = {
      id: uuid(),
      name: get('name'),
      position: get('position') || '—',
      department: get('department') || '—',
      employeeType: empType,
      annualSalary: parseFloat(get('annualSalary')) || 0,
      hourlyRate: parseFloat(get('hourlyRate')) || 0,
      hoursPerWeek: parseFloat(get('hoursPerWeek')) || 40,
      startDate: get('startDate') || null,
      termDate: get('termDate') || null,
      status,
      billRate: parseFloat(get('billRate')) || 0,
      utilizationRate: utilRate,
      notes: get('notes') || '',
    };

    if (!emp.name) {
      errors.push(`Row ${i + 2}: Missing employee name — skipped.`);
      return;
    }

    employees.push(emp);
  });

  return { employees, errors };
}

// ─── RENDER ──────────────────────────────────────

function renderReport(grid) {
  const container = document.getElementById('view-report');
  
  // Cleanup old charts to prevent overlapping canvases
  chartInstances.forEach(c => c.destroy());
  chartInstances = [];

  // Calculate Aggregate Monthly Arrays
  const aggExp = Array(12).fill(0);
  const aggRev = Array(12).fill(0);
  
  // Calculate Department Rollups
  const dpts = {};

  grid.rows.forEach(r => {
    // monthlies
    for(let i=0; i<12; i++) {
        aggExp[i] += r.expenses[i];
        aggRev[i] += r.revenues[i];
    }
    
    // dpts
    const dName = r.emp.department || 'Unassigned';
    if (!dpts[dName]) dpts[dName] = { hc: 0, utilSum: 0, expTotal: 0, revTotal: 0 };
    if (r.emp.status !== 'termed') dpts[dName].hc++;
    dpts[dName].utilSum += (r.emp.utilizationRate || 0);
    dpts[dName].expTotal += r.expTotal;
    dpts[dName].revTotal += r.revTotal;
  });

  // Calculate Quarterlies
  const qExp = [0,0,0,0];
  const qRev = [0,0,0,0];
  for(let i=0; i<12; i++) {
    qExp[Math.floor(i/3)] += aggExp[i];
    qRev[Math.floor(i/3)] += aggRev[i];
  }

  // Generate HTML for Visual Analytics Section
  let tHTML = `
    <div class="report-section">
      <div class="report-section-header">Financial Story</div>
      <div class="report-grid">
        <div class="report-card" style="grid-column: 1 / -1;">
          <div class="report-card-title">Fiscal Year Trajectory (Cost vs Revenue Pacing)</div>
          <div class="chart-container-line"><canvas id="chart-monthly"></canvas></div>
        </div>
        <div class="report-card" style="grid-column: 1 / -1;">
          <div class="report-card-title">Department Economics (Margin Distribution)</div>
          <div class="chart-container-bar"><canvas id="chart-dpts"></canvas></div>
        </div>
      </div>
    </div>
  `;

  // Generate HTML for Monthlies
  let mHTML = `<div class="report-section"><div class="report-section-header">Monthly Aggregates</div><div class="report-grid">`;
  ['Q1','Q2','Q3','Q4'].forEach((q, qi) => {
    let qRows = '';
    for(let m=0; m<3; m++) {
      const idx = qi*3 + m;
      const mName = MONTH_NAMES[idx];
      const net = aggRev[idx] - aggExp[idx];
      qRows += `<div class="report-row"><span class="report-label">${mName}</span><span class="report-val"><span class="val-exp">${fmt$(aggExp[idx])}</span> &nbsp;|&nbsp; <span class="val-rev">${fmt$(aggRev[idx])}</span></span></div>`;
    }
    qRows += `<div class="report-row report-total"><span class="report-label">${q} Total</span><span class="report-val"><span class="val-exp">${fmt$(qExp[qi])}</span> &nbsp;|&nbsp; <span class="val-rev">${fmt$(qRev[qi])}</span></span></div>`;
    
    mHTML += `<div class="report-card"><div class="report-card-title">${q} Snapshot ( Cost | Rev )</div>${qRows}</div>`;
  });
  mHTML += `</div></div>`;
  
  // Generate HTML for Departments
  let dHTML = `<div class="report-section"><div class="report-section-header">Department Rollups & Pacing</div><div class="report-grid">`;
  const sortedDpts = Object.keys(dpts).sort();
  
  // Prepare data arrays for the department bar chart
  const dblabels = [];
  const dbexp = [];
  const dbrev = [];

  sortedDpts.forEach(dName => {
    const d = dpts[dName];
    const avgUtil = d.hc > 0 ? (d.utilSum / d.hc) : 0;
    const margin = d.revTotal - d.expTotal;

    dblabels.push(dName);
    dbexp.push(d.expTotal);
    dbrev.push(d.revTotal);
    
    // Simulate a pacing target for the CSS Bullet Chart (Since we don't have actuals yet)
    // Budget Target: 95% of current projected cost (to simulate if we are over budget)
    const target = d.expTotal * 0.95;
    const maxAxis = Math.max(d.expTotal, target) * 1.2 || 1;
    const targetPct = (target / maxAxis) * 100;
    const valPct = (d.expTotal / maxAxis) * 100;

    dHTML += `
    <div class="report-card">
      <div class="report-card-title">${dName}</div>
      <div class="report-row"><span class="report-label">Active Headcount</span><span class="report-val">${d.hc}</span></div>
      <div class="report-row"><span class="report-label">Avg Utilization</span><span class="report-val">${fmtPct(avgUtil)}</span></div>
      <div class="report-row"><span class="report-label">Annual Cost</span><span class="report-val val-exp">${fmt$(d.expTotal)}</span></div>
      <div class="report-row"><span class="report-label">Annual Revenue</span><span class="report-val val-rev">${fmt$(d.revTotal)}</span></div>
      <div class="report-row report-total"><span class="report-label">Net Margin</span><span class="report-val val-net">${fmt$(margin)}</span></div>
      
      <div class="report-row" style="flex-direction:column; border-bottom:none; margin-top:8px;">
        <div style="display:flex; justify-content:space-between; font-size:10px; color:var(--text-muted);">
          <span>Forecasted Cost vs Budget Target</span><span>${fmt$(target)}</span>
        </div>
        <div class="bullet-wrap" title="Cost: ${fmt$(d.expTotal)} | Target: ${fmt$(target)}">
          <div class="bullet-bg" style="width: ${targetPct}%"></div>
          <div class="bullet-bar ${d.expTotal > target ? 'bg-amber' : ''}" style="width: ${valPct}%"></div>
          <div class="bullet-target" style="left: ${targetPct}%"></div>
        </div>
      </div>
    </div>`;
  });
  dHTML += `</div></div>`;

  container.innerHTML = tHTML + mHTML + dHTML;

  // Initialize Line Chart (MoM Trajectory)
  if (window.Chart) {
    const ctxMonthly = document.getElementById('chart-monthly');
    if (ctxMonthly) {
      const c1 = new Chart(ctxMonthly, {
        type: 'line',
        data: {
          labels: MONTH_NAMES,
          datasets: [
            { label: 'Forecasted Revenue', data: aggRev, borderColor: '#10b981', backgroundColor: '#10b98120', pointBackgroundColor: '#10b981', fill: true, tension: 0.3, borderWidth: 2 },
            { label: 'Forecasted Payroll', data: aggExp, borderColor: '#8b5cf6', backgroundColor: '#8b5cf610', pointBackgroundColor: '#8b5cf6', fill: true, tension: 0.3, borderWidth: 2 }
          ]
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          interaction: { mode: 'index', intersect: false },
          scales: {
            y: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { callback: v => '$' + (v/1000).toFixed(0) + 'k' }, beginAtZero: true },
            x: { grid: { display: false } }
          },
          plugins: { legend: { position: 'top' }, tooltip: { callbacks: { label: (ctx) => ctx.dataset.label + ': ' + fmt$(ctx.raw) } } }
        }
      });
      chartInstances.push(c1);
    }

    // Initialize Bar Chart (Department Margins)
    const ctxDpts = document.getElementById('chart-dpts');
    if (ctxDpts && dblabels.length > 0) {
      const c2 = new Chart(ctxDpts, {
        type: 'bar',
        data: {
          labels: dblabels,
          datasets: [
            { label: 'Annual Revenue', data: dbrev, backgroundColor: '#10b981', borderRadius: 4, maxBarThickness: 48 },
            { label: 'Annual Cost', data: dbexp, backgroundColor: '#3b82f6', borderRadius: 4, maxBarThickness: 48 }
          ]
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          interaction: { mode: 'index', intersect: false },
          scales: {
            y: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { callback: v => '$' + (v/1000).toFixed(0) + 'k' }, beginAtZero: true },
            x: { grid: { display: false } }
          },
          plugins: { legend: { position: 'top' }, tooltip: { callbacks: { label: (ctx) => ctx.dataset.label + ': ' + fmt$(ctx.raw) } } }
        }
      });
      chartInstances.push(c2);
    }
  }
}

function renderAll() {
  const grid = buildGrid(State.employees, State.year);
  renderKPIs(grid);
  
  if (State.activeView === 'report') {
    renderReport(grid);
  } else {
    renderTable(grid);
  }
  saveState();
}

window.switchView = function(view) {
  State.activeView = view;
  document.getElementById('tab-grid').className = 'view-tab' + (view === 'grid' ? ' active' : '');
  document.getElementById('tab-report').className = 'view-tab' + (view === 'report' ? ' active' : '');
  document.getElementById('view-grid').style.display = view === 'grid' ? '' : 'none';
  document.getElementById('view-report').style.display = view === 'report' ? '' : 'none';
  renderAll();
};

function renderKPIs(grid) {
  const activeCount = State.employees.filter(e => e.status !== 'termed').length;
  document.getElementById('kpi-annual-val').textContent  = fmt$(grid.grandExpTotal);
  document.getElementById('kpi-annual-sub').textContent  = `${State.employees.length} total employees`;
  document.getElementById('kpi-revenue-val').textContent = fmt$(grid.grandRevTotal);
  document.getElementById('kpi-revenue-sub').textContent = grid.grandRevTotal > 0
    ? `margin: ${fmt$(grid.grandRevTotal - grid.grandExpTotal)}`
    : 'no bill rates set';
  document.getElementById('kpi-hc-val').textContent  = activeCount;
  document.getElementById('kpi-hc-sub').textContent  = `${State.employees.length - activeCount} termed`;
  document.getElementById('kpi-burn-val').textContent = fmt$(grid.grandExpTotal / 12);
}

function renderTable(grid) {
  const empty = document.getElementById('empty-state');
  const table = document.getElementById('emp-table');

  if (State.employees.length === 0) {
    empty.style.display = 'flex';
    table.style.display  = 'none';
    return;
  }

  empty.style.display = 'none';
  table.style.display  = '';

  renderTableHead();
  renderTableBody(grid);
  renderTableFoot(grid);
}

// Column definitions for sortable headers
// key: used to sort State.employees; label: displayed text; align: css class
const SORT_COLS = [
  { key: '#',            label: '#',         cls: 'col-name',                  sort: (a,b) => 0 },
  { key: 'name',         label: 'Employee',  cls: 'col-name',   style: 'min-width:160px', sort: (a,b,d) => d * a.name.localeCompare(b.name) },
  { key: 'position',     label: 'Position',  cls: '',           sort: (a,b,d) => d * (a.position||'').localeCompare(b.position||'') },
  { key: 'department',   label: 'Dept',      cls: '',           sort: (a,b,d) => d * (a.department||'').localeCompare(b.department||'') },
  { key: 'employeeType', label: 'Type',      cls: 'center',     sort: (a,b,d) => d * a.employeeType.localeCompare(b.employeeType) },
  { key: 'rate',         label: 'Rate',      cls: 'right',      sort: (a,b,d) => d * ((a.annualSalary||a.hourlyRate||0) - (b.annualSalary||b.hourlyRate||0)) },
  { key: 'billRate',     label: 'Bill Rate', cls: 'right',      sort: (a,b,d) => d * ((a.billRate||0) - (b.billRate||0)) },
  { key: 'util',         label: 'Util',      cls: 'center',     sort: (a,b,d) => d * ((a.utilizationRate||0) - (b.utilizationRate||0)) },
  { key: 'startDate',    label: 'Start',     cls: '',           sort: (a,b,d) => d * (new Date(a.startDate||0) - new Date(b.startDate||0)) },
  { key: 'termDate',     label: 'End',       cls: '',           sort: (a,b,d) => d * (new Date(a.termDate||'9999') - new Date(b.termDate||'9999')) },
];

function sortEmployees(employees) {
  if (!State.sortCol || State.sortCol === '#') return employees;
  const col = SORT_COLS.find(c => c.key === State.sortCol);
  if (!col || !col.sort) return employees;
  const d = State.sortDir === 'asc' ? 1 : -1;
  return [...employees].sort((a, b) => col.sort(a, b, d));
}

function renderTableHead() {
  const thead = document.getElementById('table-head');
  const dir = State.sortDir;

  function thSort(col) {
    const active = State.sortCol === col.key;
    const arrow  = active ? (dir === 'asc' ? ' ▲' : ' ▼') : '';
    const style  = col.style ? ` style="${col.style}"` : '';
    const clickable = col.key === '#' ? '' : ` class="sort-th${active ? ' sort-active' : ''}" onclick="setSort('${col.key}')" title="Sort by ${col.label}"`;
    return `<th${style}${clickable}>${col.label}${arrow}</th>`;
  }

  const staticCols = SORT_COLS.map(thSort);
  const monthExpCols = MONTH_NAMES.map(m => `<th class="month-col">${m} Exp</th>`);
  const monthRevCols = MONTH_NAMES.map(m => `<th class="month-col" style="color:var(--green)">${m} Rev</th>`);
  const totalCols = [
    `<th class="sort-th${State.sortCol==='expTotal'?' sort-active':''}" style="min-width:90px" onclick="setSort('expTotal')" title="Sort by Annual Expense">Exp Total${State.sortCol==='expTotal'?(dir==='asc'?' ▲':' ▼'):''}</th>`,
    `<th class="sort-th${State.sortCol==='revTotal'?' sort-active':''}" style="min-width:90px;color:var(--green)" onclick="setSort('revTotal')" title="Sort by Annual Revenue">Rev Total${State.sortCol==='revTotal'?(dir==='asc'?' ▲':' ▼'):''}</th>`,
  ];

  thead.innerHTML = `<tr>${[...staticCols, ...monthExpCols, ...monthRevCols, ...totalCols].join('')}</tr>`;
}

window.setSort = function(key) {
  if (State.sortCol === key) {
    State.sortDir = State.sortDir === 'asc' ? 'desc' : 'asc';
  } else {
    State.sortCol = key;
    State.sortDir = 'asc';
  }
  renderAll();
};

function renderTableBody(grid) {
  const tbody = document.getElementById('table-body');
  const today = new Date();
  const curMonth = today.getMonth(); // 0-indexed

  // Sort rows by the active sort column
  let rows = grid.rows;
  if (State.sortCol && State.sortCol !== '#') {
    const d = State.sortDir === 'asc' ? 1 : -1;
    if (State.sortCol === 'expTotal') {
      rows = [...rows].sort((a, b) => d * (a.expTotal - b.expTotal));
    } else if (State.sortCol === 'revTotal') {
      rows = [...rows].sort((a, b) => d * (a.revTotal - b.revTotal));
    } else {
      const col = SORT_COLS.find(c => c.key === State.sortCol);
      if (col && col.sort) rows = [...rows].sort((a, b) => col.sort(a.emp, b.emp, d));
    }
  }

  let html = '';
  rows.forEach(({ emp, expenses, revenues, expTotal, revTotal }, idx) => {
    const rowClass = emp.status === 'termed' ? 'row-termed'
                   : emp.status === 'planned' ? 'row-planned' : '';

    const typeBadge = emp.employeeType === 'hourly'
      ? `<span class="badge badge-hourly">Hourly</span>`
      : `<span class="badge badge-salary">Salary</span>`;

    const statusBadge = `<span class="badge badge-${emp.status}">${emp.status}</span>`;

    const rateDisplay = emp.employeeType === 'hourly'
      ? `${fmt$(emp.hourlyRate)}/hr`
      : fmt$(emp.annualSalary);

    // Month expense cells
    const expCells = expenses.map((e, mi) => {
      const cls = e === 0 ? 'money zero' : mi === curMonth ? 'money active-month' : 'money';
      return `<td class="${cls}">${e === 0 ? '—' : fmt$(e)}</td>`;
    }).join('');

    // Month revenue cells
    const revCells = revenues.map((r, mi) => {
      const cls = r === 0 ? 'money zero' : 'revenue-col';
      return `<td class="${cls}">${r === 0 ? '—' : fmt$(r)}</td>`;
    }).join('');

    html += `<tr class="${rowClass}" data-id="${emp.id}" data-idx="${idx}">
      <td class="col-name" style="color:var(--text-muted);font-size:11px">${idx + 1}</td>
      <td class="col-name">
        <div style="display:flex;flex-direction:column;gap:2px">
          <span style="font-weight:600">${escHtml(emp.name)}</span>
          <span style="display:flex;gap:4px">${statusBadge}</span>
        </div>
      </td>
      <td style="color:var(--text-dim)">${escHtml(emp.position)}</td>
      <td style="color:var(--text-muted)">${escHtml(emp.department)}</td>
      <td style="text-align:center">${typeBadge}</td>
      <td class="right" style="text-align:right;font-variant-numeric:tabular-nums">${rateDisplay}</td>
      <td class="right" style="text-align:right;color:var(--sky)">${emp.billRate ? fmt$(emp.billRate) + '/hr' : '—'}</td>
      <td style="text-align:center;color:var(--amber)">${emp.utilizationRate ? fmtPct(emp.utilizationRate) : '—'}</td>
      <td style="color:var(--text-muted)">${fmtDate(emp.startDate)}</td>
      <td style="color:${emp.termDate ? 'var(--red)' : 'var(--text-muted)'}">${fmtDate(emp.termDate)}</td>
      ${expCells}
      ${revCells}
      <td class="total-col">${fmt$(expTotal)}</td>
      <td class="revenue-col">${revTotal > 0 ? fmt$(revTotal) : '—'}</td>
    </tr>`;
  });

  tbody.innerHTML = html;

  // Attach right-click listeners
  tbody.querySelectorAll('tr').forEach(tr => {
    tr.addEventListener('contextmenu', onRowContextMenu);
  });
}

function renderTableFoot(grid) {
  const tfoot = document.getElementById('table-foot');
  const expCells = grid.monthExpTotals.map(t =>
    `<td class="money">${fmt$(t)}</td>`).join('');
  const revCells = grid.monthRevTotals.map(t =>
    `<td class="revenue-col">${t > 0 ? fmt$(t) : '—'}</td>`).join('');

  tfoot.innerHTML = `<tr>
    <td class="col-name"></td>
    <td class="col-name" style="font-weight:700;font-size:12px">TOTALS</td>
    <td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td>
    ${expCells}
    ${revCells}
    <td class="money" style="font-size:13px">${fmt$(grid.grandExpTotal)}</td>
    <td class="revenue-col" style="font-size:13px">${grid.grandRevTotal > 0 ? fmt$(grid.grandRevTotal) : '—'}</td>
  </tr>`;
}

function escHtml(s) {
  return String(s || '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[c]);
}

// ─── CONTEXT MENU ────────────────────────────────
const ctxMenu = document.getElementById('context-menu');

function onRowContextMenu(e) {
  e.preventDefault();
  const tr = e.currentTarget;
  State.contextTargetId = tr.dataset.id;

  const emp = State.employees.find(em => em.id === tr.dataset.id);
  if (!emp) return;

  document.getElementById('ctx-emp-name').textContent = emp.name;

  // Position menu near cursor but keep inside viewport
  const vw = window.innerWidth, vh = window.innerHeight;
  const mw = 200, mh = 280;
  let x = e.clientX, y = e.clientY;
  if (x + mw > vw) x = vw - mw - 8;
  if (y + mh > vh) y = vh - mh - 8;

  ctxMenu.style.left = x + 'px';
  ctxMenu.style.top  = y + 'px';
  ctxMenu.style.display = 'block';
}

function closeContextMenu() {
  ctxMenu.style.display = 'none';
  State.contextTargetId = null;
}

document.addEventListener('mousedown', e => {
  if (!ctxMenu.contains(e.target)) closeContextMenu();
});

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') { closeContextMenu(); closeModal(); }
});

function getTargetEmp() {
  return State.employees.find(em => em.id === State.contextTargetId);
}

// Context menu actions
document.getElementById('ctx-edit-emp').addEventListener('click', () => {
  const emp = getTargetEmp(); if (!emp) return;
  closeContextMenu();
  openModalEditEmployee(emp);
});

document.getElementById('ctx-history').addEventListener('click', () => {
  const emp = getTargetEmp(); if (!emp) return;
  closeContextMenu();
  openModalViewHistory(emp);
});

document.getElementById('ctx-view').addEventListener('click', () => {
  const emp = getTargetEmp(); if (!emp) return;
  closeContextMenu();
  openModalViewDetails(emp);
});

document.getElementById('ctx-duplicate').addEventListener('click', () => {
  const emp = getTargetEmp(); if (!emp) return;
  closeContextMenu();
  const clone = { ...emp, id: uuid(), name: emp.name + ' (Copy)' };
  State.employees.push(clone);
  renderAll();
  toast(`Duplicated: ${emp.name}`, 'success');
});

document.getElementById('ctx-delete').addEventListener('click', () => {
  const emp = getTargetEmp(); if (!emp) return;
  closeContextMenu();
  if (!confirm(`Delete "${emp.name}"? This only affects the current scenario.`)) return;
  State.employees = State.employees.filter(e => e.id !== emp.id);
  renderAll();
  toast(`Deleted: ${emp.name}`, 'warning');
});

// ─── MODALS ──────────────────────────────────────
const overlay = document.getElementById('modal-overlay');
let modalSaveCallback = null;

function openModal(title, subtitle, bodyHtml, onSave) {
  document.getElementById('modal-title').textContent = title;
  document.getElementById('modal-subtitle').textContent = subtitle;
  document.getElementById('modal-body').innerHTML = bodyHtml;
  modalSaveCallback = onSave;

  // Show/hide save button
  const saveBtn = document.getElementById('modal-save');
  saveBtn.style.display = onSave ? '' : 'none';

  overlay.classList.add('open');
}

function closeModal() {
  overlay.classList.remove('open');
  modalSaveCallback = null;
}

document.getElementById('modal-close').addEventListener('click', closeModal);
document.getElementById('modal-cancel').addEventListener('click', closeModal);
overlay.addEventListener('mousedown', e => { if (e.target === overlay) closeModal(); });

document.getElementById('modal-save').addEventListener('click', () => {
  if (modalSaveCallback) {
    const result = modalSaveCallback();
    if (result !== false) closeModal();
  }
});

// ─── MODAL: Comprehensive Edit Employee ──────────
function openModalEditEmployee(emp) {
  const isSalary = emp.employeeType === 'salary';
  const body = `
    <!-- Identity -->
    <div class="form-section-title">Identity</div>
    <div class="form-group">
      <label class="form-label" for="ee-name">Full Name *</label>
      <input class="form-input" id="ee-name" type="text" value="${escHtml(emp.name)}" />
    </div>
    <div class="form-row">
      <div class="form-group">
        <label class="form-label" for="ee-pos">Position / Title</label>
        <input class="form-input" id="ee-pos" type="text" value="${escHtml(emp.position)}" />
      </div>
      <div class="form-group">
        <label class="form-label" for="ee-dept">Department</label>
        <input class="form-input" id="ee-dept" type="text" value="${escHtml(emp.department)}" />
      </div>
    </div>
    <div class="form-row">
      <div class="form-group">
        <label class="form-label" for="ee-status">Status</label>
        <select class="form-select" id="ee-status">
          <option value="active"  ${emp.status === 'active'  ? 'selected' : ''}>Active</option>
          <option value="planned" ${emp.status === 'planned' ? 'selected' : ''}>Planned</option>
          <option value="termed"  ${emp.status === 'termed'  ? 'selected' : ''}>Termed</option>
        </select>
      </div>
      <div class="form-group">
        <label class="form-label" for="ee-type">Employee Type</label>
        <select class="form-select" id="ee-type" onchange="eeToggleCompFields()">
          <option value="salary" ${!isSalary ? '' : 'selected'}>Salary</option>
          <option value="hourly" ${isSalary  ? '' : 'selected'}>Hourly</option>
        </select>
      </div>
    </div>

    <!-- Compensation -->
    <div class="form-section-title">Compensation</div>
    <div id="ee-salary-fields" style="${isSalary ? '' : 'display:none'}">
      <div class="form-group">
        <label class="form-label" for="ee-salary">Annual Salary ($)</label>
        <input class="form-input" id="ee-salary" type="number" min="0" step="1000" value="${emp.annualSalary || ''}" placeholder="e.g. 85000" />
        <div class="form-hint">Monthly expense = annual salary ÷ 12, pro-rated for partial months</div>
      </div>
    </div>
    <div id="ee-hourly-fields" style="${isSalary ? 'display:none' : ''}">
      <div class="form-row">
        <div class="form-group">
          <label class="form-label" for="ee-hrate">Hourly Rate ($/hr)</label>
          <input class="form-input" id="ee-hrate" type="number" min="0" step="0.5" value="${emp.hourlyRate || ''}" placeholder="e.g. 45.00" />
        </div>
        <div class="form-group">
          <label class="form-label" for="ee-hrs">Hours Per Week</label>
          <input class="form-input" id="ee-hrs" type="number" min="1" max="80" step="1" value="${emp.hoursPerWeek || 40}" />
        </div>
      </div>
      <div class="form-hint">Monthly expense = hourly rate × hours/week × 4.33 weeks</div>
    </div>
    <!-- Dates -->
    <div class="form-section-title">Dates</div>
    <div class="form-row">
      <div class="form-group">
        <label class="form-label" for="ee-start">Start Date *</label>
        <input class="form-input" id="ee-start" type="date" value="${emp.startDate || ''}" />
      </div>
      <div class="form-group">
        <label class="form-label" for="ee-term">Term Date (leave blank if active)</label>
        <input class="form-input" id="ee-term" type="date" value="${emp.termDate || ''}" />
      </div>
    </div>

    <!-- Billing -->
    <div class="form-section-title">Billing</div>
    <div class="form-row">
      <div class="form-group">
        <label class="form-label" for="ee-billrate">Bill Rate ($/hr)</label>
        <input class="form-input" id="ee-billrate" type="number" min="0" step="5" value="${emp.billRate || ''}" placeholder="e.g. 150" />
        <div class="form-hint">Hourly rate charged to client → tracked with effective date</div>
      </div>
      <div class="form-group">
        <label class="form-label" for="ee-util">Utilization Rate (%)</label>
        <input class="form-input" id="ee-util" type="number" min="0" max="100" step="5" value="${emp.utilizationRate ? Math.round(emp.utilizationRate * 100) : ''}" placeholder="e.g. 80" />
        <div class="form-hint">% of time billed to clients → tracked with effective date</div>
      </div>
    </div>

    <!-- Benefits -->
    <div class="form-section-title">Benefits <span style="font-size:10px;font-weight:400;color:var(--text-muted);text-transform:none">(stored for forecasting)</span></div>
    <div class="form-row">
      <div class="form-group">
        <label class="form-label" for="ee-vacation">Vacation Accrual (days/year)</label>
        <input class="form-input" id="ee-vacation" type="number" min="0" max="60" step="1" value="${emp.vacationDays !== undefined ? emp.vacationDays : ''}" placeholder="e.g. 15" />
        <div class="form-hint">Will drive vacation cost forecast in a future step → tracked with effective date</div>
      </div>
    </div>
    <div class="form-row">
      <div class="form-group">
        <label class="form-label" for="ee-bonus-amt">Bonus Amount ($)</label>
        <input class="form-input" id="ee-bonus-amt" type="number" min="0" step="500" value="${emp.bonusAmount !== undefined ? emp.bonusAmount : ''}" placeholder="e.g. 5000" />
        <div class="form-hint">Flat bonus — not yet included in expense calculations</div>
      </div>
      <div class="form-group">
        <label class="form-label" for="ee-bonus-pct">Bonus % of Salary</label>
        <input class="form-input" id="ee-bonus-pct" type="number" min="0" max="100" step="1" value="${emp.bonusPct !== undefined ? emp.bonusPct : ''}" placeholder="e.g. 10" />
        <div class="form-hint">% of annual salary — not yet included in expense calculations</div>
      </div>
    </div>

    <!-- Notes -->
    <div class="form-section-title">Notes</div>
    <div class="form-group">
      <input class="form-input" id="ee-notes" type="text" value="${escHtml(emp.notes || '')}" placeholder="Optional notes..." />
    </div>

    <!-- Effective Date for changes -->
    <div style="background:var(--bg2);border:1px solid var(--border-soft);border-radius:var(--radius-sm);padding:10px 12px;margin-top:16px">
      <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;color:var(--accent);margin-bottom:4px">Change Details</div>
      <div style="font-size:10px;color:var(--text-muted);margin-bottom:8px">Effective date applies to: salary, hourly rate, hours/week, bill rate, utilization, vacation accrual</div>
      <div class="form-row">
        <div class="form-group">
          <label class="form-label" for="ee-eff-date">Effective Date</label>
          <input class="form-input" id="ee-eff-date" type="date" value="${new Date().toISOString().slice(0,10)}" />
        </div>
        <div class="form-group">
          <label class="form-label" for="ee-change-note">Change Note</label>
          <input class="form-input" id="ee-change-note" type="text" placeholder="e.g. Merit increase Q2" />
        </div>
      </div>
      <div style="font-size:10px;color:var(--text-muted)">Past dates retroactively split affected months in the budget grid. All changes are logged in history.</div>
    </div>

  `;

  openModal('Edit Employee', emp.name, body, () => {
    const name  = document.getElementById('ee-name').value.trim();
    const start = document.getElementById('ee-start').value;
    if (!name)  { toast('Name is required.', 'error');       return false; }
    if (!start) { toast('Start date is required.', 'error'); return false; }

    const type     = document.getElementById('ee-type').value;
    const term     = document.getElementById('ee-term').value;
    const effDate  = document.getElementById('ee-eff-date').value  || new Date().toISOString().slice(0,10);
    const changeNote = document.getElementById('ee-change-note').value.trim() || 'Manual edit';
    const rawUtil  = parseFloat(document.getElementById('ee-util').value);
    const newUtil  = isNaN(rawUtil) ? emp.utilizationRate : (rawUtil > 1 ? rawUtil / 100 : rawUtil);

    // ── Non-compensation fields: apply directly (no history entry needed) ──
    emp.name        = name;
    emp.position    = document.getElementById('ee-pos').value.trim()  || emp.position;
    emp.department  = document.getElementById('ee-dept').value.trim() || emp.department;
    emp.status      = document.getElementById('ee-status').value;
    emp.startDate   = start;
    emp.termDate    = term || null;
    emp.notes       = document.getElementById('ee-notes').value.trim();

    // Auto-status if term date set
    if (emp.termDate && new Date(emp.termDate) < new Date() && emp.status === 'active') {
      emp.status = 'termed';
    }

    // ── Compensation fields: build changed-fields object and push to history ──
    const compFields = {};
    let compChanged = false;

    if (type !== (getCompensationAt(emp, new Date()).employeeType || emp.employeeType)) {
      compFields.employeeType = type;
      compChanged = true;
    } else {
      compFields.employeeType = type;
    }

    if (type === 'salary') {
      const sal = parseFloat(document.getElementById('ee-salary').value);
      const currentSal = getCompensationAt(emp, new Date()).annualSalary || emp.annualSalary || 0;
      if (!isNaN(sal) && Math.abs(sal - currentSal) > 0.01) { compFields.annualSalary = sal; compChanged = true; }
      else if (!isNaN(sal)) compFields.annualSalary = sal;
    } else {
      const rate = parseFloat(document.getElementById('ee-hrate').value);
      const hrs  = parseFloat(document.getElementById('ee-hrs').value);
      const currentRate = getCompensationAt(emp, new Date()).hourlyRate || emp.hourlyRate || 0;
      const currentHrs  = getCompensationAt(emp, new Date()).hoursPerWeek || emp.hoursPerWeek || 40;
      if (!isNaN(rate) && Math.abs(rate - currentRate) > 0.01) { compFields.hourlyRate = rate;   compChanged = true; }
      else if (!isNaN(rate)) compFields.hourlyRate = rate;
      if (!isNaN(hrs)  && Math.abs(hrs  - currentHrs)  > 0.01) { compFields.hoursPerWeek = hrs; compChanged = true; }
      else if (!isNaN(hrs)) compFields.hoursPerWeek = hrs;
    }

    const brVal = parseFloat(document.getElementById('ee-billrate').value);
    const currentBr   = getCompensationAt(emp, new Date()).billRate        || emp.billRate        || 0;
    const currentUtil = getCompensationAt(emp, new Date()).utilizationRate || emp.utilizationRate || 0;
    if (!isNaN(brVal) && Math.abs(brVal - currentBr) > 0.01) { compFields.billRate = brVal; compChanged = true; }
    else if (!isNaN(brVal)) compFields.billRate = brVal;
    if (Math.abs(newUtil - currentUtil) > 0.001) { compFields.utilizationRate = newUtil; compChanged = true; }
    else compFields.utilizationRate = newUtil;

    // Vacation accrual — tracked with effective date (will drive calcs in a future step)
    const vacVal = parseFloat(document.getElementById('ee-vacation').value);
    const currentVac = getCompensationAt(emp, new Date()).vacationDays !== undefined
      ? getCompensationAt(emp, new Date()).vacationDays
      : (emp.vacationDays !== undefined ? emp.vacationDays : null);
    if (!isNaN(vacVal)) {
      if (currentVac === null || Math.abs(vacVal - currentVac) > 0.01) { compFields.vacationDays = vacVal; compChanged = true; }
      else compFields.vacationDays = vacVal;
    }

    // Bonus — flat storage only, not in expense calculations yet
    const bonusAmt = parseFloat(document.getElementById('ee-bonus-amt').value);
    const bonusPct = parseFloat(document.getElementById('ee-bonus-pct').value);
    if (!isNaN(bonusAmt)) emp.bonusAmount = bonusAmt;
    if (!isNaN(bonusPct)) emp.bonusPct    = bonusPct;

    // Always write a history entry (either new version if changed, or update existing for today)
    applyCompensationChange(emp, compFields, effDate, compChanged ? changeNote : 'No comp change');

    renderAll();
    toast(`Saved: ${emp.name}${compChanged ? ' — compensation change logged' : ''}`, 'success');

  });
}

// Global toggle for compensation section in edit modal
window.eeToggleCompFields = function() {
  const t = document.getElementById('ee-type').value;
  document.getElementById('ee-salary-fields').style.display = t === 'salary' ? '' : 'none';
  document.getElementById('ee-hourly-fields').style.display = t === 'hourly' ? '' : 'none';
};

// MODAL: View Details
function openModalViewDetails(emp) {
  const grid = buildGrid([emp], State.year);
  const row  = grid.rows[0];
  const body = `
    <div class="detail-grid">
      <div class="detail-item">
        <div class="detail-item-label">Employee Type</div>
        <div class="detail-item-value">${emp.employeeType === 'salary' ? '💼 Salary' : '⏰ Hourly'}</div>
      </div>
      <div class="detail-item">
        <div class="detail-item-label">Status</div>
        <div class="detail-item-value"><span class="badge badge-${emp.status}">${emp.status}</span></div>
      </div>
      <div class="detail-item">
        <div class="detail-item-label">Department</div>
        <div class="detail-item-value">${escHtml(emp.department)}</div>
      </div>
      <div class="detail-item">
        <div class="detail-item-label">Position</div>
        <div class="detail-item-value">${escHtml(emp.position)}</div>
      </div>
      <div class="detail-item">
        <div class="detail-item-label">Start Date</div>
        <div class="detail-item-value">${fmtDate(emp.startDate)}</div>
      </div>
      <div class="detail-item">
        <div class="detail-item-label">Term Date</div>
        <div class="detail-item-value">${fmtDate(emp.termDate)}</div>
      </div>
      ${emp.employeeType === 'salary' ? `
      <div class="detail-item">
        <div class="detail-item-label">Annual Salary</div>
        <div class="detail-item-value">${fmt$(emp.annualSalary)}</div>
      </div>
      <div class="detail-item">
        <div class="detail-item-label">Monthly Rate</div>
        <div class="detail-item-value">${fmt$(emp.annualSalary / 12)}</div>
      </div>
      ` : `
      <div class="detail-item">
        <div class="detail-item-label">Hourly Rate</div>
          <div class="detail-item-value">${fmt$(emp.hourlyRate)}/hr</div>
      </div>
      <div class="detail-item">
        <div class="detail-item-label">Hours / Week</div>
        <div class="detail-item-value">${emp.hoursPerWeek || 40} hrs</div>
      </div>
      `}
      <div class="detail-item">
        <div class="detail-item-label">Bill Rate</div>
          <div class="detail-item-value" style="color:var(--sky)">${emp.billRate ? fmt$(emp.billRate) + '/hr' : '—'}</div>
      </div>
      <div class="detail-item">
        <div class="detail-item-label">Utilization</div>
        <div class="detail-item-value" style="color:var(--amber)">${emp.utilizationRate ? fmtPct(emp.utilizationRate) : '—'}</div>
      </div>
      <div class="detail-item">
        <div class="detail-item-label">Annual Expense</div>
        <div class="detail-item-value" style="color:var(--accent)">${fmt$(row.expTotal)}</div>
      </div>
      <div class="detail-item">
        <div class="detail-item-label">Annual Revenue</div>
        <div class="detail-item-value" style="color:var(--green)">${row.revTotal > 0 ? fmt$(row.revTotal) : '—'}</div>
      </div>
    </div>
    ${emp.notes ? `<div class="form-group" style="margin-top:16px">
      <div class="form-label">Notes</div>
      <div style="color:var(--text-dim);font-size:12px;padding:8px 10px;background:var(--bg2);border-radius:var(--radius-sm)">${escHtml(emp.notes)}</div>
    </div>` : ''}
  `;

  openModal('Employee Details', emp.name, body, null);
}

// ─── ADD EMPLOYEE MODAL ──────────────────────────
function openModalAddEmployee() {
  const body = `
    <div class="form-group">
      <label class="form-label" for="ae-name">Full Name *</label>
      <input class="form-input" id="ae-name" type="text" placeholder="Jane Smith" />
    </div>
    <div class="form-row">
      <div class="form-group">
        <label class="form-label" for="ae-pos">Position / Title</label>
        <input class="form-input" id="ae-pos" type="text" placeholder="Senior Analyst" />
      </div>
      <div class="form-group">
        <label class="form-label" for="ae-dept">Department</label>
        <input class="form-input" id="ae-dept" type="text" placeholder="Finance" />
      </div>
    </div>

    <div class="form-section-title">Employment</div>
    <div class="form-row">
      <div class="form-group">
        <label class="form-label" for="ae-type">Employee Type</label>
        <select class="form-select" id="ae-type" onchange="toggleAeRateFields()">
          <option value="salary">Salary</option>
          <option value="hourly">Hourly</option>
        </select>
      </div>
      <div class="form-group">
        <label class="form-label" for="ae-status">Status</label>
        <select class="form-select" id="ae-status">
          <option value="active">Active</option>
          <option value="planned">Planned</option>
          <option value="termed">Termed</option>
        </select>
      </div>
    </div>
    <div id="ae-salary-fields">
      <div class="form-group">
        <label class="form-label" for="ae-salary">Annual Salary ($)</label>
        <input class="form-input" id="ae-salary" type="number" min="0" step="1000" placeholder="75000" />
      </div>
    </div>
    <div id="ae-hourly-fields" style="display:none">
      <div class="form-row">
        <div class="form-group">
          <label class="form-label" for="ae-hrate">Hourly Rate ($/hr)</label>
          <input class="form-input" id="ae-hrate" type="number" min="0" step="0.5" placeholder="45.00" />
        </div>
        <div class="form-group">
          <label class="form-label" for="ae-hrs">Hours / Week</label>
          <input class="form-input" id="ae-hrs" type="number" min="1" max="80" value="40" />
        </div>
      </div>
    </div>

    <div class="form-section-title">Dates</div>
    <div class="form-row">
      <div class="form-group">
        <label class="form-label" for="ae-start">Start Date *</label>
        <input class="form-input" id="ae-start" type="date" value="${State.year}-01-01" />
      </div>
      <div class="form-group">
        <label class="form-label" for="ae-term">Term Date</label>
        <input class="form-input" id="ae-term" type="date" />
      </div>
    </div>

    <div class="form-section-title">Billing</div>
    <div class="form-row">
      <div class="form-group">
        <label class="form-label" for="ae-billrate">Bill Rate ($/hr)</label>
        <input class="form-input" id="ae-billrate" type="number" min="0" step="5" placeholder="150.00" />
      </div>
      <div class="form-group">
        <label class="form-label" for="ae-util">Utilization Rate (%)</label>
        <input class="form-input" id="ae-util" type="number" min="0" max="100" step="5" placeholder="80" />
      </div>
    </div>

    <div class="form-group">
      <label class="form-label" for="ae-notes">Notes</label>
      <input class="form-input" id="ae-notes" type="text" placeholder="Optional notes..." />
    </div>
  `;

  openModal('Add Employee', 'Manually add an employee to this scenario', body, () => {
    const name = document.getElementById('ae-name').value.trim();
    if (!name) { toast('Employee name is required.', 'error'); return false; }

    const start = document.getElementById('ae-start').value;
    if (!start) { toast('Start date is required.', 'error'); return false; }

    const type   = document.getElementById('ae-type').value;
    const status = document.getElementById('ae-status').value;
    const rawUtil = parseFloat(document.getElementById('ae-util').value) || 0;

    const emp = {
      id: uuid(),
      name,
      position: document.getElementById('ae-pos').value.trim() || '—',
      department: document.getElementById('ae-dept').value.trim() || '—',
      employeeType: type,
      annualSalary: type === 'salary' ? (parseFloat(document.getElementById('ae-salary').value) || 0) : 0,
      hourlyRate:   type === 'hourly' ? (parseFloat(document.getElementById('ae-hrate').value)  || 0) : 0,
      hoursPerWeek: type === 'hourly' ? (parseFloat(document.getElementById('ae-hrs').value) || 40)  : 40,
      startDate: start,
      termDate: document.getElementById('ae-term').value || null,
      status,
      billRate: parseFloat(document.getElementById('ae-billrate').value) || 0,
      utilizationRate: rawUtil > 1 ? rawUtil / 100 : rawUtil,
      notes: document.getElementById('ae-notes').value.trim(),
    };

    migrateEmployee(emp);
    State.employees.push(emp);
    renderAll();
    toast(`Added: ${emp.name}`, 'success');
  });
}

// Global toggle function for add-employee form
window.toggleAeRateFields = function() {
  const t = document.getElementById('ae-type').value;
  document.getElementById('ae-salary-fields').style.display = t === 'salary' ? '' : 'none';
  document.getElementById('ae-hourly-fields').style.display = t === 'hourly' ? '' : 'none';
};

// ─── CSV UPLOAD ──────────────────────────────────
document.getElementById('btn-upload').addEventListener('click', () => {
  document.getElementById('csv-file-input').click();
});

document.getElementById('csv-file-input').addEventListener('change', e => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = ev => {
    try {
      const { employees: incoming, errors } = parseCSV(ev.target.result);
      if (incoming.length === 0) { toast('No valid employees found in CSV.', 'error'); return; }
      if (errors.length) errors.forEach(err => console.warn(err));

      // If we already have employees, run the diff flow
      if (State.employees.length > 0) {
        const diff = diffCSV(incoming, State.employees);
        closeModal();
        openModalImportReview(diff, incoming);
      } else {
        // First load — directly import
        incoming.forEach(migrateEmployee);
        State.employees = incoming;
        State.original  = JSON.parse(JSON.stringify(incoming));
        saveOriginal();
        renderAll();
        toast(`Loaded ${incoming.length} employees.`, 'success');
      }
    } catch (err) {
      toast(`CSV Error: ${err.message}`, 'error');
    }
  };
  reader.readAsText(file);
  e.target.value = '';
});

// ─── SAMPLE DATA ────────────────────────────────
function loadSampleData() {
  const y = State.year;
  const samples = [
    { id: uuid(), name: 'Alex Johnson', position: 'Director of Operations', department: 'Operations', employeeType: 'salary', annualSalary: 130000, hourlyRate: 0, hoursPerWeek: 40, startDate: `${y}-01-01`, termDate: null, status: 'active', billRate: 0, utilizationRate: 0, notes: 'Full year active' },
    { id: uuid(), name: 'Maria Chen', position: 'Senior Consultant', department: 'Consulting', employeeType: 'salary', annualSalary: 110000, hourlyRate: 0, hoursPerWeek: 40, startDate: `${y}-01-01`, termDate: null, status: 'active', billRate: 195, utilizationRate: 0.80, notes: '80% billable at $195/hr' },
    { id: uuid(), name: 'Jordan Lee', position: 'Data Analyst', department: 'Analytics', employeeType: 'salary', annualSalary: 85000, hourlyRate: 0, hoursPerWeek: 40, startDate: `${y}-04-15`, termDate: null, status: 'active', billRate: 145, utilizationRate: 0.75, notes: 'Mid-year start, pro-rated April' },
    { id: uuid(), name: 'Sam Rivera', position: 'Hourly Contractor', department: 'IT', employeeType: 'hourly', annualSalary: 0, hourlyRate: 65, hoursPerWeek: 32, startDate: `${y}-01-01`, termDate: `${y}-06-30`, status: 'termed', billRate: 120, utilizationRate: 1.0, notes: '32 hrs/wk, termed mid-year' },
    { id: uuid(), name: 'Taylor Kim', position: 'Marketing Manager', department: 'Marketing', employeeType: 'salary', annualSalary: 92000, hourlyRate: 0, hoursPerWeek: 40, startDate: `${y}-01-01`, termDate: `${y}-09-15`, status: 'termed', billRate: 0, utilizationRate: 0, notes: 'Termed Sep 15 — pro-rated' },
    { id: uuid(), name: 'Casey Patel', position: 'Junior Consultant', department: 'Consulting', employeeType: 'hourly', annualSalary: 0, hourlyRate: 42, hoursPerWeek: 40, startDate: `${y}-01-01`, termDate: null, status: 'active', billRate: 85, utilizationRate: 0.70, notes: '70% utilization' },
    { id: uuid(), name: 'Morgan Walsh', position: 'VP Finance', department: 'Finance', employeeType: 'salary', annualSalary: 175000, hourlyRate: 0, hoursPerWeek: 40, startDate: `${y}-01-01`, termDate: null, status: 'active', billRate: 0, utilizationRate: 0, notes: 'Non-billable' },
    { id: uuid(), name: 'Riley Nguyen', position: 'Planned Hire — Dev', department: 'Engineering', employeeType: 'salary', annualSalary: 105000, hourlyRate: 0, hoursPerWeek: 40, startDate: `${y}-07-01`, termDate: null, status: 'planned', billRate: 165, utilizationRate: 0.85, notes: 'Planned H2 hire' },
  ];

  State.employees = samples;
  State.original  = JSON.parse(JSON.stringify(samples));
  saveOriginal();
  renderAll();
  toast('Sample data loaded — 8 employees across all scenarios.', 'success');
}

// ─── EXPORT CSV ──────────────────────────────────
function exportCSV() {
  if (State.employees.length === 0) { toast('No data to export.', 'warning'); return; }

  const grid = buildGrid(State.employees, State.year);
  const headers = [
    'Name', 'Position', 'Department', 'Type', 'Annual Salary', 'Hourly Rate', 'Hrs/Wk',
    'Start Date', 'Term Date', 'Status', 'Bill Rate', 'Utilization',
    ...MONTH_NAMES.map(m => m + ' Expense'),
    ...MONTH_NAMES.map(m => m + ' Revenue'),
    'Annual Expense', 'Annual Revenue',
  ];

  const rows = grid.rows.map(({ emp, expenses, revenues, expTotal, revTotal }) => [
    emp.name, emp.position, emp.department, emp.employeeType,
    emp.annualSalary || '', emp.hourlyRate || '', emp.hoursPerWeek || '',
    emp.startDate || '', emp.termDate || '', emp.status,
    emp.billRate || '', emp.utilizationRate ? (emp.utilizationRate * 100).toFixed(0) + '%' : '',
    ...expenses.map(e => e.toFixed(2)),
    ...revenues.map(r => r.toFixed(2)),
    expTotal.toFixed(2), revTotal.toFixed(2),
  ]);

  const csv = [headers, ...rows].map(row =>
    row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(',')
  ).join('\n');

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `staffing_budget_${State.scenario.replace(/\s+/g,'_')}_${State.year}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  toast('CSV exported.', 'success');
}

// ─── TOAST ──────────────────────────────────────
function toast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = message;
  container.appendChild(el);
  setTimeout(() => {
    el.style.animation = 'toastOut 0.3s ease forwards';
    setTimeout(() => el.remove(), 300);
  }, 3500);
}

// ─── EVENT BINDINGS ──────────────────────────────
document.getElementById('btn-sample').addEventListener('click', loadSampleData);
document.getElementById('btn-add-emp').addEventListener('click', openModalAddEmployee);
document.getElementById('btn-export').addEventListener('click', exportCSV);

document.getElementById('btn-reset').addEventListener('click', () => {
  if (State.original.length === 0) { toast('No original data to reset to.', 'warning'); return; }
  if (!confirm('Reset to original uploaded data? All scenario edits will be lost.')) return;
  State.employees = JSON.parse(JSON.stringify(State.original));
  renderAll();
  toast('Reset to original data.', 'success');
});

document.getElementById('budget-year').addEventListener('change', e => {
  const y = parseInt(e.target.value);
  if (!isNaN(y) && y >= 2020 && y <= 2040) {
    State.year = y;
    renderAll();
  }
});

document.getElementById('scenario-name').addEventListener('input', e => {
  State.scenario = e.target.value;
  saveState();
});

// ─── INIT ────────────────────────────────────────
(async function init() {
  const restored = await loadState();
  loadOriginal();

  if (restored) {
    // Migrate any employees loaded from localStorage that predate compensationHistory
    State.employees.forEach(migrateEmployee);
    document.getElementById('budget-year').value   = State.year;
    document.getElementById('scenario-name').value = State.scenario;
    renderAll();
    if (State.employees.length > 0) {
      toast(`Restored: ${State.employees.length} employees from last session.`, 'success');
    }
  } else {
    renderAll(); // show empty state
  }
})();