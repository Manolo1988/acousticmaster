// md2pdf.mjs - Minimal markdown to PDF converter using only Node.js built-ins
// Renders markdown text content into a basic PDF

import { readFileSync, writeFileSync } from "fs";

const inputFile = process.argv[2];
if (!inputFile) { console.error("Usage: node md2pdf.mjs <input.md> [output.pdf]"); process.exit(1); }
const outputFile = process.argv[3] || inputFile.replace(/\.(md|html)$/, ".pdf");

const markdown = readFileSync(inputFile, "utf-8");

// Convert markdown to plain text with some formatting
const lines = [];
let inCodeBlock = false;
let inTable = false;

const raw = markdown.split(/\r?\n/);
for (let i = 0; i < raw.length; i++) {
  const line = raw[i];

  // Skip image/data: lines (can't render in plain PDF)
  if (/^!\[.*\]\(data:/.test(line)) continue;
  if (/^(图|Fig)\s/.test(line.trim())) continue;

  // Code blocks - skip start/end markers
  if (line.trim().startsWith("```")) {
    inCodeBlock = !inCodeBlock;
    continue;
  }
  if (inCodeBlock) {
    lines.push("    " + line);
    continue;
  }

  // Headings
  const hMatch = line.match(/^(#{1,6})\s+(.+)$/);
  if (hMatch) {
    const level = hMatch[1].length;
    const text = hMatch[2].trim();
    const prefix = level <= 1 ? "\n" : "";
    const size = [22, 18, 15, 13, 12, 11][level - 1] || 11;
    lines.push(`${prefix}<b><font size="${size}">${text}</font></b><br/>`);
    continue;
  }

  // Table rows
  if (/^\|.+\|$/.test(line.trim()) && !/^[\|\s\-:]+$/.test(line.trim())) {
    if (!inTable) { lines.push("<br/>"); inTable = true; }
    lines.push("  " + line.trim() + "<br/>");
    continue;
  }
  if (/^[\|\s\-:]+$/.test(line.trim()) && inTable) continue; // skip table divider
  inTable = false;

  // Blockquotes
  if (/^>\s/.test(line)) {
    lines.push(`<i>${line.replace(/^>\s?/, "")}</i><br/>`);
    continue;
  }

  // Horizontal rules
  if (/^[-*_]{3,}\s*$/.test(line.trim())) {
    lines.push("<br/>");
    continue;
  }

  // Regular paragraph
  if (line.trim() === "") {
    lines.push("<br/>");
  } else {
    lines.push(line + "<br/>");
  }
}

// Build clean body text
const bodyHtml = lines.join("\n")
  .replace(/\*\*(.+?)\*\*/g, "<b>$1</b>")
  .replace(/\*(.+?)\*/g, "<i>$1</i>")
  .replace(/`([^`]+)`/g, "<code>$1</code>")
  .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1")
  .replace(/<br\/>\s*<br\/>\s*<br\/>/g, "<br/><br/>");

const pdfHtml = `<!DOCTYPE html>
<html><head><meta charset="utf-8"/>
<style>
@page { size: A4; margin: 20mm; }
body { font-family: "Microsoft YaHei", "SimSun", sans-serif; line-height: 1.8; color: #1a1a1a; font-size: 12pt; }
b { color: #000; }
h1,h2,h3 { page-break-after: avoid; }
</style></head>
<body>${bodyHtml}</body></html>`;

writeFileSync("/tmp/report-for-pdf.html", pdfHtml, "utf-8");
console.log(`PDF-ready HTML written to /tmp/report-for-pdf.html`);

// Try to generate actual PDF using ghostscript or python
import { execSync } from "child_process";
let pdfGenerated = false;

// Method 1: Use python3 with reportlab (install on the fly)
try {
  execSync("pip3 install reportlab --quiet 2>/dev/null", { timeout: 30000 });
  const pyScript = `
from reportlab.lib.pagesizes import A4
from reportlab.platypus import SimpleDocTemplate, Paragraph
from reportlab.lib.styles import getSampleStyleSheet
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
import sys, re, os

markdown = open("${inputFile}", "r").read()

# Build simple document
doc = SimpleDocTemplate("${outputFile}", pagesize=A4, leftMargin=20, rightMargin=20, topMargin=20, bottomMargin=20)
styles = getSampleStyleSheet()
story = []

# Split by double newlines = paragraphs
paras = markdown.split("\\n\\n")
for p in paras:
    p = p.strip()
    if not p: continue
    # Skip image lines
    if p.startswith("![") or p.startswith("图 ") or p.startswith("data:"): continue
    # Skip pure markdown table
    if "| ---" in p: continue
    # Clean up markdown
    p = re.sub(r'\\*\\*(.+?)\\*\\*', r'<b>\\1</b>', p)
    p = re.sub(r'#####?\\s+(.+)', r'<b><font size="14">\\1</font></b>', p)
    p = re.sub(r'######?\\s+(.+)', r'<b><font size="12">\\1</font></b>', p)
    p = re.sub(r'#+\\s+', '', p)
    p = re.sub(r'\\[(.+?)\\]\\([^)]+\\)', r'\\1', p)
    p = re.sub(r'\\{\\{[^}]+\\}\\}', '[静态资源占位符]', p)
    p = re.sub(r'[\\[\\]图片占位符[：:]\\s*([^\\]]+)\\]', r'[设备图片: \\1]', p)
    p = re.sub(r'`([^`]+)`', r'<code>\\1</code>', p)
    p = p.replace("\\n", "<br/>")
    story.append(Paragraph(p, styles["Normal"]))

doc.build(story)
print(f"PDF saved: ${outputFile}")
`
  execSync(`python3 -c '${pyScript.replace(/'/g, "'\\''")}'`, { timeout: 30000 });
  pdfGenerated = true;
} catch (e) {
  // fall through
}

if (!pdfGenerated) {
  // Method 2: use ghostscript with text output
  try {
    // Just copy the HTML as the best-effort PDF source
    writeFileSync(outputFile.replace('.pdf', '_for_print.html'), pdfHtml, "utf-8");
    console.log("PDF generation requires reportlab. Printing-friendly HTML saved instead.");
    console.log(`Open ${outputFile.replace('.pdf', '_for_print.html')} in browser → Ctrl+P → Save as PDF`);
  } catch (e2) {
    console.log("All PDF methods failed. Use the HTML file directly.");
  }
}

console.log(`Done. Output: ${outputFile}`);
