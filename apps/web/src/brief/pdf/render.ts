import { PDFDocument, StandardFonts, rgb, degrees, type PDFFont, type PDFPage, type RGB } from 'pdf-lib';
import type { BriefBlock, BriefRow, BriefSection, BriefTableRow } from '../types';
import { NOT_PROVIDED } from '../format';
import { makeSanitizer, wrapText, type Sanitizer } from './text';

// ── Page geometry (US Letter) ──
const PAGE_W = 612;
const PAGE_H = 792;
const M_L = 60;
const M_R = 60;
const CONTENT_W = PAGE_W - M_L - M_R;
const TOP = PAGE_H - 74; // first baseline region below running header
const BOTTOM = 70; // content must stay above this
const LABEL_W = 158;

// ── Palette ──
const C = {
  ink: rgb(0.10, 0.12, 0.16),
  muted: rgb(0.40, 0.43, 0.48),
  faint: rgb(0.62, 0.65, 0.70),
  accent: rgb(0.10, 0.22, 0.38),
  rule: rgb(0.80, 0.83, 0.87),
  hairline: rgb(0.89, 0.91, 0.93),
  confidential: rgb(0.62, 0.11, 0.11),
  verbatimBar: rgb(0.52, 0.60, 0.72),
  infoBg: rgb(0.94, 0.95, 0.97),
  warnBg: rgb(1.0, 0.965, 0.90),
  warnBar: rgb(0.80, 0.52, 0.10),
  neededBg: rgb(1.0, 0.95, 0.80),
  needed: rgb(0.62, 0.36, 0.0),
  ok: rgb(0.13, 0.45, 0.25),
  tableHead: rgb(0.93, 0.94, 0.96),
};

export interface RenderConfig {
  /** Small caps line above the title on page 1. */
  kicker: string;
  /** Red tag above the title on page 1 (e.g. "CONFIDENTIAL"). */
  tag?: string;
  title: string;
  subtitle?: string;
  /** Running header text (left) on every page. */
  runningTitle: string;
  /** Running header right side (e.g. "CONFIDENTIAL" or "DRAFT"). */
  runningRight: string;
  footerLeft: string;
  footerCenter: string;
  watermark?: string;
  numberSections: boolean;
  /** Inserted after the first section if any text needed substitution. */
  sanitizedNote: string;
  meta: { title: string; subject: string; date: Date };
}

interface Fonts {
  sans: PDFFont; sansBold: PDFFont; sansItalic: PDFFont; serif: PDFFont; mono: PDFFont;
}

class Layout {
  pages: PDFPage[] = [];
  page!: PDFPage;
  y = TOP;
  sanitizedAny = false;
  constructor(readonly doc: PDFDocument, readonly f: Fonts, readonly cfg: RenderConfig, readonly clean: Sanitizer) {}

  s(text: string): string {
    const r = this.clean(text);
    if (r.replaced || r.transliterated) this.sanitizedAny = true;
    return r.text;
  }

  newPage() {
    this.page = this.doc.addPage([PAGE_W, PAGE_H]);
    this.pages.push(this.page);
    this.y = TOP;
    if (this.cfg.watermark) {
      const size = 46;
      const w = this.f.sansBold.widthOfTextAtSize(this.cfg.watermark, size);
      const ang = Math.atan2(PAGE_H, PAGE_W);
      const cx = PAGE_W / 2, cy = PAGE_H / 2;
      this.page.drawText(this.cfg.watermark, {
        x: cx - (w / 2) * Math.cos(ang) + (size / 3) * Math.sin(ang),
        y: cy - (w / 2) * Math.sin(ang) - (size / 3) * Math.cos(ang),
        size, font: this.f.sansBold, color: rgb(0.75, 0.2, 0.15), opacity: 0.07,
        rotate: degrees((ang * 180) / Math.PI),
      });
    }
    // running header
    const hy = PAGE_H - 40;
    this.page.drawText(this.cfg.runningTitle, { x: M_L, y: hy, size: 7.5, font: this.f.sans, color: C.muted });
    const rw = this.f.sansBold.widthOfTextAtSize(this.cfg.runningRight, 7.5);
    this.page.drawText(this.cfg.runningRight, { x: PAGE_W - M_R - rw, y: hy, size: 7.5, font: this.f.sansBold, color: C.confidential });
    this.page.drawLine({ start: { x: M_L, y: hy - 6 }, end: { x: PAGE_W - M_R, y: hy - 6 }, thickness: 0.5, color: C.rule });
  }

  avail() { return this.y - BOTTOM; }
  ensure(h: number) { if (this.y - h < BOTTOM) this.newPage(); }

  text(t: string, x: number, size: number, font: PDFFont, color: RGB = C.ink) {
    if (t) this.page.drawText(t, { x, y: this.y, size, font, color });
  }
}

export async function renderPdf(sections: BriefSection[], cfg: RenderConfig): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const f: Fonts = {
    sans: await doc.embedFont(StandardFonts.Helvetica),
    sansBold: await doc.embedFont(StandardFonts.HelveticaBold),
    sansItalic: await doc.embedFont(StandardFonts.HelveticaOblique),
    serif: await doc.embedFont(StandardFonts.TimesRoman),
    mono: await doc.embedFont(StandardFonts.Courier),
  };
  const L = new Layout(doc, f, cfg, makeSanitizer(f.sans.getCharacterSet()));
  L.newPage();
  drawTitleBlock(L);

  let num = 0;
  sections.forEach((sec, i) => {
    const numbered = cfg.numberSections && i > 0;
    if (numbered) num++;
    drawSectionHeading(L, numbered ? `${num}.` : '', sec.title, sec.minSpace);
    for (const b of sec.blocks) drawBlock(L, b);
    if (i === 0 && sectionsNeedSanitizing(sections, L)) {
      drawNote(L, cfg.sanitizedNote, 'warning');
    }
    L.y -= 10;
  });

  // footers with page numbers
  const total = L.pages.length;
  L.pages.forEach((p, i) => {
    const fy = 38;
    p.drawLine({ start: { x: M_L, y: fy + 12 }, end: { x: PAGE_W - M_R, y: fy + 12 }, thickness: 0.5, color: C.rule });
    const tag = cfg.footerCenter;
    p.drawText(tag, { x: M_L, y: fy, size: 7.5, font: f.sansBold, color: C.confidential });
    const tagW = f.sansBold.widthOfTextAtSize(tag, 7.5);
    const pn = `Page ${i + 1} of ${total}`;
    const pw = f.sans.widthOfTextAtSize(pn, 7.5);
    let meta = L.s(` ·  ${cfg.footerLeft}`);
    const maxMeta = CONTENT_W - tagW - pw - 16;
    while (meta.length > 4 && f.sans.widthOfTextAtSize(meta, 7) > maxMeta) meta = meta.slice(0, -2);
    if (meta !== L.s(` ·  ${cfg.footerLeft}`)) meta = meta.trimEnd() + '…';
    p.drawText(meta, { x: M_L + tagW, y: fy + 0.3, size: 7, font: f.sans, color: C.muted });
    p.drawText(pn, { x: PAGE_W - M_R - pw, y: fy, size: 7.5, font: f.sans, color: C.ink });
  });

  doc.setTitle(cfg.meta.title);
  doc.setSubject(cfg.meta.subject);
  doc.setProducer('Matra brief engine (client-side, in-browser)');
  doc.setCreator('Matra');
  doc.setCreationDate(cfg.meta.date);
  doc.setModificationDate(cfg.meta.date);
  return doc.save();
}

/** Pre-scan all text so the warning can be placed near the top of the document. */
function sectionsNeedSanitizing(sections: BriefSection[], L: Layout): boolean {
  const check = (t: string) => { const r = L.clean(t); return r.replaced || r.transliterated; };
  for (const s of sections) {
    for (const b of s.blocks) {
      switch (b.kind) {
        case 'rows': if (b.rows.some((r) => check(r.value) || check(r.label))) return true; break;
        case 'verbatim': if (check(b.text) || (b.label && check(b.label))) return true; break;
        case 'paragraph': case 'note': case 'subheading': if (check(b.text)) return true; break;
        case 'table': if (b.rows.some((r) => r.cells.some(check) || (r.detail && check(r.detail.value)))) return true; break;
        case 'checklist': if (b.items.some((it) => check(it.text))) return true; break;
        default: break;
      }
    }
  }
  return false;
}

function drawTitleBlock(L: Layout) {
  const { f, cfg } = L;
  L.text(cfg.kicker.toUpperCase(), M_L, 7.5, f.sansBold, C.muted);
  L.y -= 22;
  if (cfg.tag) {
    const tw = f.sansBold.widthOfTextAtSize(cfg.tag, 8.5);
    L.page.drawRectangle({ x: M_L, y: L.y - 4, width: tw + 12, height: 15, borderColor: C.confidential, borderWidth: 1 });
    L.text(cfg.tag, M_L + 6, 8.5, f.sansBold, C.confidential);
    L.y -= 26;
  }
  for (const line of wrapText(L.s(cfg.title), f.sansBold, 19, CONTENT_W)) {
    L.text(line, M_L, 19, f.sansBold, C.accent);
    L.y -= 23;
  }
  if (cfg.subtitle) {
    L.y += 4;
    for (const line of wrapText(L.s(cfg.subtitle), f.sans, 10, CONTENT_W)) {
      L.text(line, M_L, 10, f.sans, C.muted);
      L.y -= 14;
    }
  }
  L.y -= 2;
  L.page.drawRectangle({ x: M_L, y: L.y, width: CONTENT_W, height: 2.2, color: C.accent });
  L.y -= 26;
}

function drawSectionHeading(L: Layout, num: string, title: string, minSpace = 0) {
  L.ensure(Math.max(70, minSpace)); // keep heading with at least a few lines of content
  const { f } = L;
  const size = 10.5;
  const t = L.s(title.toUpperCase());
  let x = M_L;
  if (num) {
    L.text(num, x, size, f.sansBold, C.accent);
    x += 20;
  }
  for (const line of wrapText(t, f.sansBold, size, CONTENT_W - (x - M_L))) {
    L.text(line, x, size, f.sansBold, C.accent);
    L.y -= 14;
  }
  L.y += 8;
  L.page.drawLine({ start: { x: M_L, y: L.y }, end: { x: PAGE_W - M_R, y: L.y }, thickness: 0.8, color: C.accent });
  L.y -= 16;
}

function drawBlock(L: Layout, b: BriefBlock) {
  switch (b.kind) {
    case 'rows': drawRows(L, b.rows); break;
    case 'verbatim': drawVerbatim(L, b.text, b.label); break;
    case 'paragraph': drawParagraph(L, b.text); break;
    case 'note': drawNote(L, b.text, b.tone ?? 'info'); break;
    case 'subheading': drawSubheading(L, b.text); break;
    case 'table': drawTable(L, b.columns, b.rows); break;
    case 'signature': drawSignature(L, b.lines); break;
    case 'checklist': drawChecklist(L, b.items); break;
  }
}

function drawSubheading(L: Layout, text: string) {
  L.ensure(48);
  L.y -= 4;
  for (const line of wrapText(L.s(text), L.f.sansBold, 9.5, CONTENT_W)) {
    L.text(line, M_L, 9.5, L.f.sansBold, C.ink);
    L.y -= 13;
  }
  L.y -= 3;
}

function drawParagraph(L: Layout, text: string) {
  const size = 9.5, lh = 13.5;
  for (const line of wrapText(L.s(text), L.f.sans, size, CONTENT_W)) {
    L.ensure(lh);
    L.text(line, M_L, size, L.f.sans);
    L.y -= lh;
  }
  L.y -= 6;
}

function drawNote(L: Layout, text: string, tone: 'info' | 'warning') {
  const size = 8.3, lh = 11.2, pad = 7;
  const lines = wrapText(L.s(text), tone === 'warning' ? L.f.sans : L.f.sansItalic, size, CONTENT_W - 2 * pad - 4);
  const h = lines.length * lh + 2 * pad - 3;
  if (h < L.page.getHeight() - TOP) L.ensure(h + 4);
  const top = L.y + size;
  L.page.drawRectangle({ x: M_L, y: top - h, width: CONTENT_W, height: h, color: tone === 'warning' ? C.warnBg : C.infoBg });
  L.page.drawRectangle({ x: M_L, y: top - h, width: 2.5, height: h, color: tone === 'warning' ? C.warnBar : C.verbatimBar });
  L.y -= pad - 1;
  for (const line of lines) {
    L.text(line, M_L + pad + 4, size, tone === 'warning' ? L.f.sans : L.f.sansItalic, tone === 'warning' ? C.ink : C.muted);
    L.y -= lh;
  }
  L.y -= pad + 5;
}

function drawVerbatim(L: Layout, text: string, label?: string) {
  const size = 11, lh = 15.2, indent = 16;
  if (label) {
    L.ensure(lh + 16);
    L.text(L.s(label).toUpperCase(), M_L, 7.5, L.f.sansBold, C.muted);
    L.y -= 13;
  }
  const lines = wrapText(L.s(text), L.f.serif, size, CONTENT_W - indent);
  for (const line of lines) {
    if (L.y - lh < BOTTOM) L.newPage();
    if (line === '') { L.y -= lh * 0.55; continue; } // paragraph break
    L.page.drawRectangle({ x: M_L + 3, y: L.y - 4.5, width: 1.6, height: lh, color: C.verbatimBar });
    L.text(line, M_L + indent, size, L.f.serif);
    L.y -= lh;
  }
  L.y -= 9;
}

function rowFont(L: Layout, r: BriefRow): { font: PDFFont; size: number; lh: number; color: RGB } {
  if (r.value === NOT_PROVIDED) return { font: L.f.sansItalic, size: 9, lh: 12.5, color: C.faint };
  if (r.needed) return { font: L.f.sansBold, size: 9, lh: 12.5, color: C.needed };
  if (r.mono) return { font: L.f.mono, size: 8.2, lh: 11.5, color: C.ink };
  if (r.verbatim) return { font: L.f.serif, size: 10.5, lh: 13.8, color: C.ink };
  return { font: L.f.sans, size: 9.5, lh: 13, color: C.ink };
}

function drawRows(L: Layout, rows: BriefRow[]) {
  const valueX = M_L + LABEL_W;
  const valueW = CONTENT_W - LABEL_W;
  for (const r of rows) {
    const vf = rowFont(L, r);
    const valueText = r.needed && r.value !== NOT_PROVIDED ? r.value : r.value;
    const labelLines = wrapText(L.s(r.label), L.f.sansBold, 8.3, LABEL_W - 12);
    const valueLines = wrapText(L.s(valueText), vf.font, vf.size, valueW - (r.needed ? 8 : 0));
    const h = Math.max(labelLines.length * 11, valueLines.length * vf.lh) + 7;
    if (h <= L.avail() || h > TOP - BOTTOM) {
      // fits (or can never fit: flow across pages)
    } else L.newPage();
    if (r.needed && h <= L.avail()) {
      L.page.drawRectangle({ x: valueX - 4, y: L.y - h + 9.5, width: valueW + 4, height: h - 2, color: C.neededBg });
    }
    const startY = L.y;
    let ly = startY;
    for (const ll of labelLines) {
      L.page.drawText(ll, { x: M_L, y: ly, size: 8.3, font: L.f.sansBold, color: C.muted });
      ly -= 11;
    }
    let vy = startY;
    for (const vl of valueLines) {
      if (vy - vf.lh < BOTTOM - 4) { L.newPage(); vy = L.y; ly = L.y; }
      if (vl) L.page.drawText(vl, { x: valueX + (r.needed ? 4 : 0), y: vy, size: vf.size, font: vf.font, color: vf.color });
      vy -= vf.lh;
    }
    L.y = Math.min(ly, vy) - 2;
    L.page.drawLine({ start: { x: M_L, y: L.y + 6 }, end: { x: PAGE_W - M_R, y: L.y + 6 }, thickness: 0.4, color: C.hairline });
    L.y -= 7;
  }
  L.y -= 4;
}

function drawTable(L: Layout, columns: Array<{ header: string; width: number }>, rows: BriefTableRow[]) {
  const size = 8.2, lh = 10.8, pad = 4;
  const total = columns.reduce((a, c) => a + c.width, 0);
  const widths = columns.map((c) => (c.width / total) * CONTENT_W);
  const xs = widths.reduce<number[]>((acc, w, i) => { acc.push(i === 0 ? M_L : acc[i - 1] + widths[i - 1]); return acc; }, []);

  const header = () => {
    const hl = columns.map((c, i) => wrapText(L.s(c.header.toUpperCase()), L.f.sansBold, 7.3, widths[i] - 2 * pad));
    const h = Math.max(...hl.map((l) => l.length)) * 9.5 + 2 * pad;
    L.ensure(h + 30);
    L.page.drawRectangle({ x: M_L, y: L.y - h + 9, width: CONTENT_W, height: h, color: C.tableHead });
    hl.forEach((lines, i) => lines.forEach((t, j) => {
      L.page.drawText(t, { x: xs[i] + pad, y: L.y + 9 - pad - 7 - j * 9.5, size: 7.3, font: L.f.sansBold, color: C.muted });
    }));
    L.y -= h;
  };
  header();
  for (const r of rows) {
    const cl = r.cells.map((c, i) => wrapText(L.s(c), c === NOT_PROVIDED ? L.f.sansItalic : L.f.sans, size, widths[i] - 2 * pad));
    let h = Math.max(...cl.map((l) => l.length)) * lh + 2 * pad;
    const detailLines = r.detail ? wrapText(L.s(r.detail.value), L.f.mono, 7.4, CONTENT_W - 60 - 2 * pad) : [];
    h += detailLines.length * 10;
    if (h > L.avail() - 2) { L.newPage(); header(); }
    const top = L.y + 9;
    cl.forEach((lines, i) => lines.forEach((t, j) => {
      const np = r.cells[i] === NOT_PROVIDED;
      L.page.drawText(t, { x: xs[i] + pad, y: top - pad - 7.5 - j * lh, size, font: np ? L.f.sansItalic : L.f.sans, color: np ? C.faint : C.ink });
    }));
    if (r.detail) {
      const dy0 = top - pad - 7.5 - Math.max(...cl.map((l) => l.length)) * lh - 1;
      L.page.drawText(L.s(r.detail.label), { x: xs[0] + pad, y: dy0, size: 6.8, font: L.f.sansBold, color: C.muted });
      detailLines.forEach((t, j) => {
        L.page.drawText(t, { x: M_L + 60, y: dy0 - j * 10, size: 7.4, font: r.detail!.mono ? L.f.mono : L.f.sans, color: C.ink });
      });
    }
    L.y -= h;
    L.page.drawLine({ start: { x: M_L, y: L.y + 9 }, end: { x: PAGE_W - M_R, y: L.y + 9 }, thickness: 0.5, color: C.rule });
  }
  L.y -= 12;
}

function drawSignature(L: Layout, lines: Array<{ label: string; wide?: boolean }>) {
  // Lay out as rows: a wide line (≈62%) optionally followed by a narrow one on the same row.
  const gap = 24;
  const wideW = CONTENT_W * 0.62;
  const narrowW = CONTENT_W - wideW - gap;
  let i = 0;
  L.y -= 8;
  while (i < lines.length) {
    L.ensure(46);
    L.y -= 22;
    const a = lines[i];
    const b = lines[i + 1];
    const pair = a.wide && b && !b.wide;
    const draw = (x: number, w: number, label: string) => {
      L.page.drawLine({ start: { x, y: L.y }, end: { x: x + w, y: L.y }, thickness: 0.8, color: C.ink });
      L.page.drawText(L.s(label), { x, y: L.y - 11, size: 7.5, font: L.f.sans, color: C.muted });
    };
    draw(M_L, a.wide ? wideW : narrowW, a.label);
    if (pair) { draw(M_L + wideW + gap, narrowW, b.label); i += 2; } else i += 1;
    L.y -= 20;
  }
  L.y -= 12;
}

function drawChecklist(L: Layout, items: Array<{ text: string; status: 'ok' | 'needed' | 'warning' | 'info' }>) {
  const size = 9, lh = 12.5, tagW = 62;
  const tags = { ok: ['MET', C.ok], needed: ['NEEDED', C.needed], warning: ['CHECK', C.confidential], info: ['NOTE', C.accent] } as const;
  for (const it of items) {
    const lines = wrapText(L.s(it.text), L.f.sans, size, CONTENT_W - tagW);
    L.ensure(Math.min(lines.length * lh + 4, 120));
    const [tag, color] = tags[it.status];
    const tw = L.f.sansBold.widthOfTextAtSize(tag, 6.8);
    L.page.drawRectangle({ x: M_L, y: L.y - 3, width: tw + 8, height: 11, borderColor: color, borderWidth: 0.8 });
    L.page.drawText(tag, { x: M_L + 4, y: L.y, size: 6.8, font: L.f.sansBold, color });
    for (const line of lines) {
      L.ensure(lh);
      L.text(line, M_L + tagW, size, L.f.sans);
      L.y -= lh;
    }
    L.y -= 5;
  }
  L.y -= 4;
}
