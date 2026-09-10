#!/usr/bin/env python3
"""Convert a Markdown file to .docx.

Handles: ATX headings, paragraphs, bullet/numbered lists, pipe tables,
fenced code blocks, blockquotes, horizontal rules, and inline
**bold** / *italic* / `code` / [text](url).

Usage: python3 md2docx.py input.md [output.docx]
"""

import re
import sys
from pathlib import Path

from docx import Document
from docx.enum.table import WD_TABLE_ALIGNMENT
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml.ns import qn
from docx.shared import Pt, RGBColor, Inches

INLINE = re.compile(
    r"(\*\*.+?\*\*|__.+?__|(?<!\*)\*(?!\*).+?(?<!\*)\*(?!\*)|`[^`]+`"
    r"|\$[^$]+\$|\[[^\]]+\]\([^)]+\))"
)


def add_inline(paragraph, text):
    """Render inline markdown into runs on an existing paragraph."""
    for part in INLINE.split(text):
        if not part:
            continue
        if part.startswith("**") and part.endswith("**"):
            paragraph.add_run(part[2:-2]).bold = True
        elif part.startswith("__") and part.endswith("__"):
            paragraph.add_run(part[2:-2]).bold = True
        elif part.startswith("*") and part.endswith("*"):
            paragraph.add_run(part[1:-1]).italic = True
        elif part.startswith("$") and part.endswith("$"):
            # Inline mathematics. Set in the body face, italic, not in the
            # monospace code style: an equation is prose, not a code listing.
            run = paragraph.add_run(part[1:-1])
            run.italic = True
            run.font.name = "Cambria Math"
        elif part.startswith("`") and part.endswith("`"):
            run = paragraph.add_run(part[1:-1])
            run.font.name = "Menlo"
            run.font.size = Pt(9.5)
            run.font.color.rgb = RGBColor(0xB0, 0x30, 0x60)
        elif part.startswith("["):
            label, url = re.match(r"\[([^\]]+)\]\(([^)]+)\)", part).groups()
            run = paragraph.add_run(label)
            run.font.color.rgb = RGBColor(0x10, 0x55, 0xA0)
            run.underline = True
            # keep the URL visible in print; docx hyperlinks need raw XML
            if url not in label:
                tail = paragraph.add_run(f" ({url})")
                tail.font.size = Pt(8)
                tail.font.color.rgb = RGBColor(0x70, 0x70, 0x70)
        else:
            paragraph.add_run(part)


def strip_inline(text):
    """Plain text with inline markers removed (for table cells that need it)."""
    text = re.sub(r"\[([^\]]+)\]\(([^)]+)\)", r"\1", text)
    return text.replace("**", "").replace("`", "").replace("$", "")


def is_block_start(line):
    """True if this line begins a new block rather than continuing a paragraph.

    Markdown source is hard-wrapped for readability, but a wrapped line is not a
    new paragraph. Without this the converter emitted one Word paragraph per
    source line, so body text came out as a column of short ragged lines with
    paragraph spacing between each one.
    """
    s = line.strip()
    if not s:
        return True
    if s.startswith("```") or s.startswith(">"):
        return True
    if re.fullmatch(r"(-{3,}|\*{3,}|_{3,})", s):
        return True
    if re.fullmatch(r"!\[(.*?)\]\((.+?)\)", s):
        return True
    if re.match(r"#{1,6}\s", s):
        return True
    if re.match(r"\d+[.)]\s", s) or re.match(r"[-*+]\s", s):
        return True
    if is_table_row(s):
        return True
    return False


def gather(lines, i):
    """Collect a wrapped block starting at i. Returns (text, next_index)."""
    buf = [lines[i].strip()]
    i += 1
    while i < len(lines) and not is_block_start(lines[i]):
        buf.append(lines[i].strip())
        i += 1
    return " ".join(buf), i


def is_table_row(line):
    return line.strip().startswith("|") and line.strip().endswith("|")


def split_row(line):
    return [c.strip() for c in line.strip().strip("|").split("|")]


def convert(md_path: Path, docx_path: Path):
    lines = md_path.read_text(encoding="utf-8").splitlines()
    doc = Document()

    normal = doc.styles["Normal"]
    normal.font.name = "Calibri"
    normal.font.size = Pt(10.5)
    normal.element.rPr.rFonts.set(qn("w:eastAsia"), "Calibri")
    normal.paragraph_format.space_after = Pt(6)

    i = 0
    while i < len(lines):
        line = lines[i]
        stripped = line.strip()

        if not stripped:
            i += 1
            continue

        # fenced code block
        if stripped.startswith("```"):
            lang = stripped[3:].strip().lower()
            i += 1
            block = []
            while i < len(lines) and not lines[i].strip().startswith("```"):
                block.append(lines[i])
                i += 1
            i += 1
            if lang == "math":
                # Display equation: centred, italic, in the body face.
                for line_text in block:
                    if not line_text.strip():
                        continue
                    para = doc.add_paragraph()
                    para.alignment = WD_ALIGN_PARAGRAPH.CENTER
                    para.paragraph_format.space_before = Pt(6)
                    para.paragraph_format.space_after = Pt(10)
                    run = para.add_run(line_text.strip())
                    run.italic = True
                    run.font.name = "Cambria Math"
                    run.font.size = Pt(11)
                continue
            para = doc.add_paragraph()
            para.paragraph_format.left_indent = Pt(18)
            para.paragraph_format.space_after = Pt(10)
            run = para.add_run("\n".join(block))
            run.font.name = "Menlo"
            run.font.size = Pt(8.5)
            continue

        # image:  ![caption](relative/or/absolute/path)
        m_img = re.fullmatch(r"!\[(.*?)\]\((.+?)\)", stripped)
        if m_img:
            caption, src = m_img.group(1), m_img.group(2)
            path = Path(src)
            if not path.is_absolute():
                path = (md_path.parent / src).resolve()
            if path.exists():
                doc.add_picture(str(path), width=Inches(6.2))
                doc.paragraphs[-1].alignment = WD_ALIGN_PARAGRAPH.CENTER
                if caption:
                    cap = doc.add_paragraph()
                    cap.alignment = WD_ALIGN_PARAGRAPH.CENTER
                    run = cap.add_run(caption)
                    run.italic = True
                    run.font.size = Pt(9)
            else:
                para = doc.add_paragraph()
                run = para.add_run(f"[missing image: {src}]")
                run.italic = True
            i += 1
            continue

        # horizontal rule
        if re.fullmatch(r"(-{3,}|\*{3,}|_{3,})", stripped):
            doc.add_paragraph().add_run("").add_break()
            i += 1
            continue

        # table
        if is_table_row(stripped) and i + 1 < len(lines) and re.fullmatch(
            r"\|[\s:|-]+\|", lines[i + 1].strip()
        ):
            header = split_row(stripped)
            i += 2
            rows = []
            while i < len(lines) and is_table_row(lines[i].strip()):
                rows.append(split_row(lines[i].strip()))
                i += 1
            table = doc.add_table(rows=1, cols=len(header))
            table.style = "Light Grid Accent 1"
            table.alignment = WD_TABLE_ALIGNMENT.CENTER
            for cell, text in zip(table.rows[0].cells, header):
                cell.text = ""
                para = cell.paragraphs[0]
                run = para.add_run(strip_inline(text))
                run.bold = True
                run.font.size = Pt(9)
            for row in rows:
                cells = table.add_row().cells
                for cell, text in zip(cells, row):
                    cell.text = ""
                    para = cell.paragraphs[0]
                    para.paragraph_format.space_after = Pt(2)
                    add_inline(para, text)
                    for run in para.runs:
                        run.font.size = Pt(9)
            doc.add_paragraph()
            continue

        # heading
        m = re.match(r"(#{1,6})\s+(.*)", stripped)
        if m:
            level = len(m.group(1))
            para = doc.add_heading(level=min(level, 4))
            add_inline(para, m.group(2))
            for run in para.runs:
                run.font.color.rgb = RGBColor(0x1A, 0x1A, 0x1A)
            i += 1
            continue

        # blockquote
        if stripped.startswith(">"):
            buf = []
            while i < len(lines) and lines[i].strip().startswith(">"):
                buf.append(lines[i].strip().lstrip("> ").strip())
                i += 1
            para = doc.add_paragraph()
            para.paragraph_format.left_indent = Pt(18)
            add_inline(para, " ".join(buf))
            for run in para.runs:
                run.italic = True
            continue

        # numbered list
        m = re.match(r"\d+[.)]\s+(.*)", stripped)
        if m:
            buf = [m.group(1)]
            i += 1
            while i < len(lines) and not is_block_start(lines[i]):
                buf.append(lines[i].strip())
                i += 1
            para = doc.add_paragraph(style="List Number")
            add_inline(para, " ".join(buf))
            continue

        # bullet list (supports one level of nesting)
        m = re.match(r"[-*+]\s+(.*)", stripped)
        if m:
            indent = len(line) - len(line.lstrip())
            style = "List Bullet 2" if indent >= 2 else "List Bullet"
            buf = [m.group(1)]
            i += 1
            while i < len(lines) and not is_block_start(lines[i]):
                buf.append(lines[i].strip())
                i += 1
            para = doc.add_paragraph(style=style)
            add_inline(para, " ".join(buf))
            continue

        # body paragraph: rejoin every wrapped source line into one paragraph
        text, i = gather(lines, i)
        para = doc.add_paragraph()
        if text.startswith("\u2192"):
            para.paragraph_format.left_indent = Pt(18)
        para.alignment = WD_ALIGN_PARAGRAPH.JUSTIFY
        para.paragraph_format.space_after = Pt(8)
        add_inline(para, text)

    doc.save(docx_path)
    return docx_path


if __name__ == "__main__":
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    src = Path(sys.argv[1])
    dst = Path(sys.argv[2]) if len(sys.argv) > 2 else src.with_suffix(".docx")
    print(f"wrote {convert(src, dst)}")
