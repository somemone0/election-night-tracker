// The election tracker's Google Sheet (see sheet.py and the README, "Google Sheet").
//
// Setup: in the sheet, Extensions > Apps Script, paste this file, then Project Settings > Script properties: add
// SECRET (any long random string). Deploy > New deployment > Web app, Execute as: Me, Who has access: Anyone. Give the
// tracker the /exec URL and the secret (SHEET_URL, SHEET_SECRET). "Anyone" only lets a caller with the secret in.
//
// Drops tab: row 1 labels, row 2 keys (hidden), one row per ballot drop from row 3, newest at the bottom. Edit a count
// in the last row to change what the page shows; the edit goes live after 5 minutes (sheet.py HOLD). Edits to older
// rows are history and do nothing.
// _feed (hidden): the last counts from the feeds. _pending (hidden): hand edits in the last row, with what the cell
// held before and when it was edited.

const DROPS = "Drops", FEED = "_feed", PENDING = "_pending", FIRST = 3;

function doPost(e) {
  const body = JSON.parse(e.postData.contents);
  if (body.secret !== PropertiesService.getScriptProperties().getProperty("SECRET")) return json({ error: "bad secret" });
  const lock = LockService.getDocumentLock();
  lock.waitLock(20000);
  try {
    const ss = SpreadsheetApp.getActive();
    const drops = tab(ss, DROPS, false), feedTab = tab(ss, FEED, true), pendTab = tab(ss, PENDING, true);
    const values = body.values || {}, labels = body.labels || {};

    // columns: one per key, new keys added on the right
    let keys = headerKeys(drops);
    const fresh = Object.keys(values).filter(k => keys.indexOf(k) < 0);
    if (drops.getLastRow() < 2) {
      drops.getRange(1, 1, 2, 1).setValues([["Drop at"], ["_time"]]);
      drops.setFrozenRows(2);
      drops.setFrozenColumns(1);
      drops.hideRows(2);
    }
    if (fresh.length) {
      drops.getRange(1, keys.length + 2, 2, fresh.length).setValues([fresh.map(k => labels[k] || k), fresh]);
      keys = keys.concat(fresh);
    }

    // a drop: any count moved since the last post
    const old = readMap(feedTab), pend = readPending(pendTab);
    const changed = Object.keys(values).filter(k => String(old[k]) !== String(values[k]));
    if (changed.length) {
      const last = drops.getLastRow();
      const prev = last >= FIRST ? drops.getRange(last, 2, 1, keys.length).getValues()[0] : [];
      const row = keys.map((k, i) => (changed.indexOf(k) >= 0 || prev[i] === "" || prev[i] == null ? (k in values ? values[k] : "") : prev[i]));
      drops.appendRow([new Date()].concat(row));
      writeMap(feedTab, values);
      changed.forEach(k => delete pend[k]);   // the count moved: an edit still on hold is never shown
      writePending(pendTab, pend);
    }

    const last = drops.getLastRow(), shown = {};
    if (last >= FIRST) {
      const row = drops.getRange(last, 2, 1, keys.length).getValues()[0];
      keys.forEach((k, i) => { shown[k] = row[i]; });
    }
    return json({ values: shown, pending: pend, now: Date.now(), row: last });
  } finally {
    lock.releaseLock();
  }
}

// A hand edit in the last row: put it on hold (keeping what the cell showed before the first of a run of edits).
function onEdit(e) {
  const sh = e.range.getSheet();
  if (sh.getName() !== DROPS) return;
  const lock = LockService.getDocumentLock();
  lock.waitLock(20000);
  try {
    const last = sh.getLastRow(), r = e.range;
    if (r.getLastRow() < FIRST || r.getLastColumn() < 2) return;
    const keys = headerKeys(sh), pendTab = tab(sh.getParent(), PENDING, true), pend = readPending(pendTab);
    const single = r.getNumRows() === 1 && r.getNumColumns() === 1;
    const live = new Date(Date.now() + 5 * 60 * 1000), tz = Session.getScriptTimeZone();
    for (let row = r.getRow(); row <= r.getLastRow(); row++) {
      for (let col = Math.max(2, r.getColumn()); col <= r.getLastColumn(); col++) {
        const cell = sh.getRange(row, col);
        if (row !== last) { cell.setNote("Older drop: edits here do nothing. Edit the last row."); continue; }
        const k = keys[col - 2];
        if (!k) continue;
        const before = pend[k] ? pend[k].before : (single && e.oldValue !== undefined ? e.oldValue : "");
        pend[k] = { before: before, at: Date.now() };
        cell.setNote("Hand edit. On the page at " + Utilities.formatDate(live, tz, "h:mm a") + " unless it changes again first.");
      }
    }
    writePending(pendTab, pend);
  } finally {
    lock.releaseLock();
  }
}

function tab(ss, name, hidden) {
  let sh = ss.getSheetByName(name);
  if (!sh) { sh = ss.insertSheet(name); if (hidden) sh.hideSheet(); }
  return sh;
}
function headerKeys(sh) {
  const n = sh.getLastColumn();
  return n < 2 || sh.getLastRow() < 2 ? [] : sh.getRange(2, 2, 1, n - 1).getValues()[0].map(String);
}
function readMap(sh) {
  const out = {};
  if (sh.getLastRow() >= 1) sh.getRange(1, 1, sh.getLastRow(), 2).getValues().forEach(r => { out[r[0]] = r[1]; });
  return out;
}
function writeMap(sh, m) {
  sh.clearContents();
  const rows = Object.keys(m).map(k => [k, m[k]]);
  if (rows.length) sh.getRange(1, 1, rows.length, 2).setValues(rows);
}
function readPending(sh) {
  const out = {};
  if (sh.getLastRow() >= 1) sh.getRange(1, 1, sh.getLastRow(), 3).getValues().forEach(r => { if (r[0]) out[r[0]] = { before: r[1], at: Number(r[2]) }; });
  return out;
}
function writePending(sh, p) {
  sh.clearContents();
  const rows = Object.keys(p).map(k => [k, p[k].before, p[k].at]);
  if (rows.length) sh.getRange(1, 1, rows.length, 3).setValues(rows);
}
function json(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}
