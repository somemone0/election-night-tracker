// Reads the Google Sheet's Page tab, where the tracker writes results.json and the end of history.json after every
// poll (sheet.py page_rows). Two ways in: the tab published to the web as CSV, or the sheet's Apps Script /exec URL,
// which answers {"results", "history"} as JSON (tools/sheet/Code.gs doGet).

export interface SheetPage { results: unknown; history: unknown }

// RFC 4180 CSV, as Google publishes it: fields with commas, quotes or line breaks are quoted, quotes doubled.
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], field = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c !== '"') field += c;
      else if (text[i + 1] === '"') { field += '"'; i++; }
      else quoted = false;
    } else if (c === '"') quoted = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field); rows.push(row); row = []; field = "";
    } else field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows;
}

// Each row is [name, "~chunk", "~chunk", ...]; the "~" keeps the sheet from reading a chunk as a formula or number.
export function decodePage(text: string): SheetPage {
  if (text.trimStart().startsWith("{")) return JSON.parse(text) as SheetPage;
  const files: Record<string, string> = {};
  for (const [name, ...cells] of parseCsv(text)) files[name] = cells.filter(Boolean).map(c => c.slice(1)).join("");
  return { results: files.results ? JSON.parse(files.results) : null, history: files.history ? JSON.parse(files.history) : [] };
}
