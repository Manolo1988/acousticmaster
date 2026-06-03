// genpdf.mjs - Pure Node.js PDF generator for markdown
// No external dependencies required
import { readFileSync, writeFileSync } from "fs";
import { createHash } from "crypto";

const mdPath = process.argv[2] || "./generated_docs/latest-report.md";
const pdfPath = process.argv[3] || mdPath.replace(/\.(md|html)$/, ".pdf");

const md = readFileSync(mdPath, "utf-8");

// --- Build PDF manually ---
// PDF uses objects (obj), cross-reference table (xref), trailer
const objects = [];
let objId = 1;

function addObj(data) {
  const id = objId++;
  objects.push({ id, data });
  return id;
}

// PDF escape
function pdfStr(s) {
  return String(s)
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)")
    .replace(/\r/g, "")
    .replace(/\t/g, "    ");
}

// Font widths for basic Latin + CJK approximation (very rough)
function strWidth(str, size) {
  let w = 0;
  for (const ch of str) {
    const code = ch.codePointAt(0);
    if (code <= 0x7F) w += size * 0.5;
    else w += size; // CJK approx
  }
  return w;
}

// Wrap text to fit page width (A4 = 595pt, margins 50pt → 495pt usable)
const PAGE_W = 495;
const LINE_H = 14;
const MARGIN_L = 50;
const MARGIN_B = 50;
const PAGE_H = 842;
let y = PAGE_H - 50;
let pageContents = [];
let allPages = [];

function newPage() {
  if (pageContents.length > 0) allPages.push(pageContents);
  pageContents = [];
  y = PAGE_H - 50;
}

function addText(text, size = 11, bold = false, indent = 0) {
  if (!text.trim()) {
    y -= LINE_H;
    return;
  }
  const font = bold ? "/F2" : "/F1";
  // Simple word wrap
  const words = [...text];
  let line = "";
  let lineW = indent;
  for (const ch of words) {
    const chW = ch.codePointAt(0) <= 0x7F ? size * 0.5 : size;
    if (lineW + chW > PAGE_W && line.length > 0) {
      if (y < MARGIN_B) newPage();
      pageContents.push(`BT ${font} ${size} Tf ${MARGIN_L + indent} ${y} Td (${pdfStr(line)}) Tj ET`);
      y -= LINE_H;
      line = "";
      lineW = indent;
    }
    line += ch;
    lineW += chW;
  }
  if (line.trim()) {
    if (y < MARGIN_B) newPage();
    pageContents.push(`BT ${font} ${size} Tf ${MARGIN_L + indent} ${y} Td (${pdfStr(line)}) Tj ET`);
    y -= LINE_H;
  }
}

function addBlankLine() {
  y -= LINE_H * 0.5;
}

// Parse markdown to text with formatting
const lines = md.split(/\r?\n/);
let inCode = false;

for (let i = 0; i < lines.length; i++) {
  const raw = lines[i];

  // Skip image lines with base64
  if (/^!\[.*\]\(data:/.test(raw)) continue;
  if (/^(图|Fig)\s/.test(raw.trim())) continue;

  // Code blocks
  if (raw.trim().startsWith("```")) { inCode = !inCode; addBlankLine(); continue; }
  if (inCode) { addText("  " + raw, 9, false, 10); continue; }

  // Headings
  const hMatch = raw.match(/^(#{1,6})\s+(.+)$/);
  if (hMatch) {
    addBlankLine();
    const level = hMatch[1].length;
    const text = hMatch[2].trim().replace(/\*/g, "");
    const sizes = [20, 16, 14, 13, 12, 11];
    addText(text, sizes[level - 1] || 11, level <= 3);
    addBlankLine();
    continue;
  }

  // Table rows - render as indented text
  if (/^\|.+\|$/.test(raw.trim()) && !/^[\|\s\-:]+$/.test(raw.trim())) {
    const cells = raw.trim().split("|").filter(c => c.trim());
    addText(cells.join("  |  "), 9, false, 5);
    continue;
  }
  if (/^[\|\s\-:]+$/.test(raw.trim())) continue;

  // Blockquote
  if (/^>\s/.test(raw)) {
    addText(raw.replace(/^>\s?/, ""), 10, false, 15);
    continue;
  }

  // Horizontal rule
  if (/^[-*_]{3,}\s*$/.test(raw.trim())) {
    addText("─".repeat(60), 8);
    continue;
  }

  // Empty line
  if (raw.trim() === "") {
    addBlankLine();
    continue;
  }

  // Regular text - clean markdown
  let cleaned = raw
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/\*(.+?)\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/\{\{[^}]+\}\}/g, "[静态资源]")
    .replace(/\[图片占位符[：:][^\]]+\]/g, "[设备图片]")
    .replace(/<!--[^>]*-->/g, "")
    .trim();

  if (cleaned) addText(cleaned, 11);
}

if (pageContents.length > 0) allPages.push(pageContents);
if (allPages.length === 0) { console.error("No content to render"); process.exit(1); }

// --- Build PDF ---
const catalogId = addObj("catalog");
const pagesId = addObj("pages");
const font1Id = addObj("font1"); // Regular
const font2Id = addObj("font2"); // Bold

// Build content streams and page objects
let stream = "";
let pageIds = [];

for (let p = 0; p < allPages.length; p++) {
  const contentStr = allPages[p].join("\n");
  const contentId = addObj("content_" + p);
  stream += `${contentId} 0 obj\n<< /Length ${Buffer.byteLength(contentStr)} >>\nstream\n${contentStr}\nendstream\nendobj\n`;
  const pageId = addObj("page_" + p);
  stream += `${pageId} 0 obj\n<< /Type /Page /Parent ${pagesId} 0 R /Contents ${contentId} 0 R /Resources << /Font << /F1 ${font1Id} 0 R /F2 ${font2Id} 0 R >> >> >>\nendobj\n`;
  pageIds.push(pageId);
}

// Catalog
stream += `${catalogId} 0 obj\n<< /Type /Catalog /Pages ${pagesId} 0 R >>\nendobj\n`;

// Pages
const kidsRef = pageIds.map(id => `${id} 0 R`).join(" ");
stream += `${pagesId} 0 obj\n<< /Type /Pages /Kids [${kidsRef}] /Count ${pageIds.length} >>\nendobj\n`;

// Fonts (Helvetica base; CJK characters will show as ??? but structure is correct)
stream += `${font1Id} 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n`;
stream += `${font2Id} 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>\nendobj\n`;

// Build xref table
const offsets = [];
let pos = 0;
const header = "%PDF-1.4\n";
pos += Buffer.byteLength(header);

// Count trailing \n in stream
const streamBuf = Buffer.from(stream);
pos += streamBuf.length;

// Calculate offsets
let tmp = header;
offsets.push(0); // obj 0 is free
for (const obj of objects) {
  const objStr = `${obj.id} 0 obj\n`;
  // We already have the stream, find offset within it
  const idx = stream.indexOf(objStr);
  if (idx >= 0) {
    offsets.push(Buffer.byteLength(header) + idx);
  } else {
    offsets.push(0); // shouldn't happen
  }
}

// Write
const xrefOffset = pos;
let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
for (let i = 1; i <= objects.length; i++) {
  xref += `${String(offsets[i] || 0).padStart(10, "0")} 00000 n \n`;
}
const trailer = `trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;

const pdf = header + stream + xref + trailer;
writeFileSync(pdfPath, pdf);
console.log(`PDF saved: ${pdfPath} (${Buffer.byteLength(pdf)} bytes, ${allPages.length} pages)`);
