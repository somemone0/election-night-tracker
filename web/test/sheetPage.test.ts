// Reading the Google Sheet's Page tab, published as CSV or served by the Apps Script.
import { describe, expect, it } from "vitest";
import { decodePage, parseCsv } from "../src/lib/sheetPage";
import { looksLikeResults } from "../src/hooks/useResults";
import { mockResults } from "./helpers";

// how Google publishes a tab: quote a field when it needs it, double its quotes, CRLF between rows
const csvField = (s: string) => (/[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
const toCsv = (rows: string[][]) => rows.map(r => r.map(csvField).join(",")).join("\r\n");

// sheet.py page_rows, padded to one width as the sheet stores it
function pageRows(results: unknown, history: unknown, chunk: number): string[][] {
  const rows = (Object.entries({ results, history }) as [string, unknown][]).map(([name, v]) => {
    const text = JSON.stringify(v), cells = [name];
    for (let i = 0; i < text.length; i += chunk) cells.push("~" + text.slice(i, i + chunk));
    return cells;
  });
  const width = Math.max(...rows.map(r => r.length));
  return rows.map(r => r.concat(Array(width - r.length).fill("")));
}

describe("sheet page", () => {
  it("parses quoted CSV", () => {
    expect(parseCsv('a,"b,""c""",d\r\n"x\ny",,\r\n')).toEqual([["a", 'b,"c"', "d"], ["x\ny", "", ""]]);
  });

  it("reads results and history back from the published CSV", () => {
    const D = mockResults(8803), hist = [{ t: "2026-11-03T20:05:00", state_yes_pct: 51.2 }];
    const page = decodePage(toCsv(pageRows(D, hist, 4000)));
    expect(looksLikeResults(page.results)).toBe(true);
    expect(page.results).toEqual(D);
    expect(page.history).toEqual(hist);
  });

  it("reads the Apps Script's JSON", () => {
    expect(decodePage(' {"results":null,"history":[]}')).toEqual({ results: null, history: [] });
  });
});
