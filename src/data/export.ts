import type { IndexedItem } from "./item-index.js";

/**
 * Phase 6 — export the current result set to CSV or JSON. Pure string
 * builders here (unit-testable, Foundry-free); the browser download side-effect
 * lives in {@link triggerDownload} and the `download*` helpers.
 *
 * Columns mirror the results list plus the matched ability **Tags**:
 * `Name, Level, Rarity, Price (gp), Traits, Tags, Source`.
 */

/** One flat export row derived from an {@link IndexedItem}. */
export interface ExportRow {
  name: string;
  level: number;
  rarity: string;
  /** gp-equivalent price, or null for priceless items. */
  priceGp: number | null;
  /** Trait slugs. */
  traits: string[];
  /** Matched ability-tag names. */
  tags: string[];
  /** Publication/source title, or null. */
  source: string | null;
}

/** CSV header row (also the JSON field order intent). */
const CSV_HEADERS = ["Name", "Level", "Rarity", "Price (gp)", "Traits", "Tags", "Source"] as const;

/** Project the (already filtered + sorted) items into export rows. */
export function buildExportRows(items: readonly IndexedItem[]): ExportRow[] {
  return items.map((item) => ({
    name: item.name,
    level: item.level,
    rarity: item.rarity,
    priceGp: item.priceGp,
    traits: [...item.traits],
    tags: [...item.tags],
    source: item.source,
  }));
}

/** Plain numeric gp (no thousands separators) so spreadsheets parse it as a
 * number; blank for a priceless item. */
function formatPrice(priceGp: number | null): string {
  if (priceGp == null) return "";
  // Trim to at most 3 decimals, dropping trailing zeros (matches "0.###").
  return (Math.round(priceGp * 1000) / 1000).toString();
}

/** RFC 4180 field escape: quote when the field contains a comma, quote, CR or
 * LF, doubling embedded quotes. */
function escapeCsv(field: string): string {
  const needsQuoting = /[",\r\n]/.test(field);
  return needsQuoting ? `"${field.replace(/"/g, '""')}"` : field;
}

/** Serialize rows to RFC 4180 CSV with CRLF terminators (opens cleanly in Excel
 * & Sheets). The BOM is added at download time, not here. */
export function toCsv(rows: readonly ExportRow[]): string {
  const lines: string[] = [];
  lines.push(CSV_HEADERS.map(escapeCsv).join(","));
  for (const r of rows) {
    lines.push(
      [
        r.name,
        String(r.level),
        r.rarity,
        formatPrice(r.priceGp),
        r.traits.join(", "),
        r.tags.join(", "),
        r.source ?? "",
      ]
        .map(escapeCsv)
        .join(","),
    );
  }
  // Trailing CRLF so the file ends on a newline (Excel-friendly).
  return lines.join("\r\n") + "\r\n";
}

/** Serialize rows to pretty-printed JSON (structured, same fields as CSV). */
export function toJson(rows: readonly ExportRow[]): string {
  return JSON.stringify(rows, null, 2);
}

/** A filesystem-safe `YYYY-MM-DD_HHMMSS` local timestamp for export filenames. */
export function exportTimestamp(date: Date = new Date()): string {
  const p = (n: number): string => String(n).padStart(2, "0");
  return (
    `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}` +
    `_${p(date.getHours())}${p(date.getMinutes())}${p(date.getSeconds())}`
  );
}

/**
 * Trigger a browser download of `content` as `filename`. CSV is emitted UTF-8
 * **with a BOM** (`﻿`) so Excel detects the encoding and non-ASCII item
 * names render without mojibake; JSON is plain UTF-8.
 */
export function triggerDownload(filename: string, content: string, mime: string, withBom: boolean): void {
  const parts = withBom ? ["﻿", content] : [content];
  const blob = new Blob(parts, { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoke on the next tick so the click has a chance to start the download.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/** Download the rows as a timestamped CSV file (UTF-8 + BOM). */
export function downloadCsv(rows: readonly ExportRow[], date: Date = new Date()): void {
  triggerDownload(`pf2e-items_${exportTimestamp(date)}.csv`, toCsv(rows), "text/csv", true);
}

/** Download the rows as a timestamped JSON file. */
export function downloadJson(rows: readonly ExportRow[], date: Date = new Date()): void {
  triggerDownload(`pf2e-items_${exportTimestamp(date)}.json`, toJson(rows), "application/json", false);
}
