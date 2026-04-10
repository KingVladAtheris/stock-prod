// src/utils/exportUtils.ts
// npm install jspdf jspdf-autotable xlsx

import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import type { CellHookData, Styles } from 'jspdf-autotable';
import * as XLSX from 'xlsx';

export interface ExportColumn  { header: string; key: string; align?: 'left' | 'right' | 'center'; }
export interface ExportRow     { [key: string]: string | number; }
export interface ExportTotals  { label: string; values: (string | number)[]; }

// ── Diacritics → ASCII for jsPDF's built-in Helvetica ─────────────────────
const DM: Record<string, string> = {
  'ă':'a','â':'a','î':'i','ș':'s','ş':'s','ț':'t','ţ':'t',
  'Ă':'A','Â':'A','Î':'I','Ș':'S','Ş':'S','Ț':'T','Ţ':'T',
};
const pd = (s: string) => s.replace(/[ăâîșşțţĂÂÎȘŞȚŢ]/g, c => DM[c] ?? c);
const pds = (v: string | number) => pd(String(v ?? ''));

// ── Shared colours ─────────────────────────────────────────────────────────
const C_HEAD:  [number,number,number] = [26,  25,  23 ];
const C_HTXT:  [number,number,number] = [245, 244, 240];
const C_ALT:   [number,number,number] = [248, 247, 242];
const C_TOT:   [number,number,number] = [220, 218, 210];  // totals footer rows
const C_PTOT:  [number,number,number] = [200, 198, 190];  // previous-period totals

// ── Column styles helper ───────────────────────────────────────────────────
function colStyles(aligns: ('left'|'right'|'center'|undefined)[]): Record<string, Partial<Styles>> {
  const cs: Record<string, Partial<Styles>> = {};
  aligns.forEach((a, i) => {
    if (a) cs[i] = { halign: a as Styles['halign'] };
  });
  return cs;
}


// ══════════════════════════════════════════════════════════════════════════
// exportToPDF  — flat table with optional totals footer rows
// Used by MonthlySummary and YearlySummary
// ══════════════════════════════════════════════════════════════════════════
export function exportToPDF(
  title: string,
  subtitle: string,
  columns: ExportColumn[],
  rows: ExportRow[],
  filename: string,
  totals?: ExportTotals[],   // e.g. [{ label: 'Prev', values: [...] }, { label: 'Period', values: [...] }]
) {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });

  doc.setFontSize(14); doc.setFont('helvetica', 'bold');
  doc.text(pd(title), 14, 16);
  doc.setFontSize(9);  doc.setFont('helvetica', 'normal'); doc.setTextColor(120);
  doc.text(pd(subtitle), 14, 22);
  doc.setTextColor(0);

  const aligns = columns.map(c => c.align);

  // Build body
  const body = rows.map(r => columns.map(c => pds(r[c.key] ?? '')));

  // Build footer rows (prev totals first, period totals second)
  const footerRows: string[][] = (totals ?? []).map(t => [
    pds(t.label),
    ...t.values.map(pds),
  ]);

  const bodyLen = body.length;

  autoTable(doc, {
    startY: 27,
    head: [columns.map(c => pd(c.header))],
    body: [...body, ...footerRows],
    columnStyles: colStyles(aligns),
    headStyles:         { fillColor: C_HEAD, textColor: C_HTXT, fontStyle: 'bold', fontSize: 8, halign: 'right' },
    bodyStyles:         { fontSize: 9 },
    alternateRowStyles: { fillColor: C_ALT },
    margin:             { left: 14, right: 14 },
    didParseCell(data: CellHookData) {
      if (data.section === 'head') {
        // First column header left, rest right
        data.cell.styles.halign = data.column.index === 0 ? 'left' : 'right';
        return;
      }
      if (data.section !== 'body') return;
      const ri = data.row.index;
      const ci = data.column.index;
      // Footer rows: all cells right-aligned
      if (totals && ri >= bodyLen) {
        data.cell.styles.halign = 'right';
        if (ri === bodyLen) {
          // Previous-period totals
          data.cell.styles.fillColor = C_PTOT;
          data.cell.styles.fontStyle = 'bold';
          data.cell.styles.fontSize  = 8.5;
        } else if (ri === bodyLen + 1) {
          // Current-period totals
          data.cell.styles.fillColor = C_HEAD;
          data.cell.styles.textColor = C_HTXT;
          data.cell.styles.fontStyle = 'bold';
          data.cell.styles.fontSize  = 8.5;
        }
      }
    },
  });

  doc.save(`${filename}.pdf`);
}


// ══════════════════════════════════════════════════════════════════════════
// exportGroupedPDF  — grouped table for DayView (entries & exits)
//
// Each "group" is one counterparty. Instead of putting the counterparty
// as a body row (which distorts column widths), we:
//   - print the counterparty name + meta as doc.text() above each sub-table
//   - render only item rows in autoTable (so column widths are driven by data)
//   - append a totals row at the end of each section's combined table
// ══════════════════════════════════════════════════════════════════════════

export interface GroupItem  { cells: (string | number)[]; }
export interface Group {
  name: string;          // counterparty name
  meta: string[];        // short strings placed in cols 1, 2, ... of the group header row
  items: GroupItem[];
}
export interface StockSummary {
  prevLabel: string;  prevNoVat: string; prevVat: string; prevTotal: string;
  endLabel:  string;  endNoVat:  string; endVat:  string; endTotal:  string;
}
export interface GroupedSection {
  sectionTitle: string;
  headers: string[];
  aligns: ('left'|'right'|'center'|undefined)[];
  groups: Group[];
  totalsRow?: (string | number)[];
}

export function exportGroupedPDF(
  title: string,
  subtitle: string,
  sections: GroupedSection[],
  filename: string,
  stockSummary?: StockSummary,
) {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  let y = 27;

  // Title block
  doc.setFontSize(14); doc.setFont('helvetica', 'bold');
  doc.text(pd(title), 14, 16);
  doc.setFontSize(9); doc.setFont('helvetica', 'normal'); doc.setTextColor(120);
  doc.text(pd(subtitle), 14, 22);
  doc.setTextColor(0);

  for (const section of sections) {
    if (section.groups.length === 0) continue;

    // Section heading
    doc.setFontSize(9); doc.setFont('helvetica', 'bold'); doc.setTextColor(50);
    doc.text(pd(section.sectionTitle), 14, y + 5);
    doc.setTextColor(0); doc.setFont('helvetica', 'normal');
    y += 9;

    const body: string[][] = [];
    const groupHeaderRows = new Set<number>();

    for (const group of section.groups) {
      // Counterparty row: name in col 0, meta[0] in col 1, meta[1] in col 2, rest empty.
      // This keeps column widths driven by item data, not long label strings.
      const cpRow: string[] = section.headers.map((_, i) => {
        if (i === 0) return pd(group.name);
        if (i <= group.meta.length) return pd(group.meta[i - 1]);
        return '';
      });
      groupHeaderRows.add(body.length);
      body.push(cpRow);

      // Item rows: product name indented in col 0, numeric values in remaining cols
      for (const item of group.items) {
        body.push(item.cells.map((c, i) =>
          i === 0 ? `  ${pds(c)}` : pds(c)
        ));
      }
    }

    const totalsIndex = section.totalsRow ? body.length : -1;
    if (section.totalsRow) {
      body.push(section.totalsRow.map(pds));
    }

    autoTable(doc, {
      startY: y,
      head: [section.headers.map(pd)],
      body,
      columnStyles: colStyles(section.aligns),
      headStyles:         { fillColor: C_HEAD, textColor: C_HTXT, fontStyle: 'bold', fontSize: 8 },
      bodyStyles:         { fontSize: 8.5, fillColor: [255, 255, 255] },
      alternateRowStyles: { fillColor: [255, 255, 255] },
      margin:             { left: 14, right: 14 },
      didParseCell(data: CellHookData) {
        if (data.section === 'head') {
          // First column (name) = left, everything else = right
          data.cell.styles.halign = data.column.index === 0 ? 'left' : 'right';
          return;
        }

        if (data.section !== 'body') return;

        const ri = data.row.index;

        if (groupHeaderRows.has(ri)) {
          data.cell.styles.fillColor = [200, 198, 190];
          data.cell.styles.fontStyle = 'bold';
          data.cell.styles.fontSize  = 8.5;
          data.cell.styles.textColor = [26, 25, 23];

          // Meta cells left, name already left from head
          if (data.column.index >= 1) {
            data.cell.styles.halign = 'right';
          }
        } 
        else if (ri === totalsIndex) {
          data.cell.styles.fillColor = C_HEAD;
          data.cell.styles.textColor = C_HTXT;
          data.cell.styles.fontStyle = 'bold';
          data.cell.styles.fontSize  = 8.5;
          data.cell.styles.halign    = 'right';   // all totals right
        } 
        else {
          // Normal item rows
          data.cell.styles.fillColor = ri % 2 === 0 ? [255, 255, 255] : C_ALT;
          
          // Force numeric columns right (starting from column 4)
          if (data.column.index >= 4) {
            data.cell.styles.halign = 'right';
          }
        }
      },
    });

    y = (doc as any).lastAutoTable.finalY + 10;
    if (y > 185) { doc.addPage(); y = 14; }
  }

  // ── Stock summary block ──────────────────────────────────────────────────
  if (stockSummary) {
    if (y > 175) { doc.addPage(); y = 14; }

    const ss = stockSummary;
    const stockBody = [
      [
        pd(ss.prevLabel),
        pd(ss.prevNoVat), pd(ss.prevVat), pd(ss.prevTotal),
      ],
      [
        pd(ss.endLabel),
        pd(ss.endNoVat), pd(ss.endVat), pd(ss.endTotal),
      ],
    ];

    autoTable(doc, {
      startY: y,
      head: [['', 'Fara TVA', 'TVA', 'Total']],
      body: stockBody,
      columnStyles: {
        0: { halign: 'left'  as Styles['halign'], fontStyle: 'bold' },
        1: { halign: 'right' as Styles['halign'] },
        2: { halign: 'right' as Styles['halign'] },
        3: { halign: 'right' as Styles['halign'], fontStyle: 'bold' },
      },
      headStyles:        { fillColor: C_HEAD, textColor: C_HTXT, fontStyle: 'bold', fontSize: 8 },
      bodyStyles:        { fontSize: 9 },
      margin:            { left: 14, right: 14 },
      tableWidth:        120,
      didParseCell(data: CellHookData) {
        if (data.section !== 'body') return;
        if (data.row.index === 0) {
          // Previous stock — medium grey
          data.cell.styles.fillColor = C_PTOT;
        } else {
          // End of day stock — dark with light text
          data.cell.styles.fillColor = C_HEAD;
          data.cell.styles.textColor = C_HTXT;
          data.cell.styles.fontStyle = 'bold';
        }
      },
    });
  }

  doc.save(`${filename}.pdf`);
}


// ══════════════════════════════════════════════════════════════════════════
// exportToExcel — unchanged, xlsx handles unicode natively
// ══════════════════════════════════════════════════════════════════════════
export function exportToExcel(
  sheetName: string,
  columns: ExportColumn[],
  rows: ExportRow[],
  filename: string,
) {
  const wsData: (string | number)[][] = [
    columns.map(c => c.header),
    ...rows.map(r => columns.map(c => {
      const v = r[c.key];
      if (typeof v === 'number') return v;
      const n = parseFloat(String(v).replace(/\./g, '').replace(',', '.'));
      return isNaN(n) ? String(v ?? '') : n;
    })),
  ];
  const ws = XLSX.utils.aoa_to_sheet(wsData);
  ws['!cols'] = columns.map((_, ci) =>
    ({ wch: Math.max(...wsData.map(row => String(row[ci] ?? '').length)) + 2 })
  );
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName.slice(0, 31));
  XLSX.writeFile(wb, `${filename}.xlsx`);
}