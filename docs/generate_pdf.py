#!/usr/bin/env python3
"""
Generate a beautifully styled RTL PDF from Persian markdown using fpdf2.
Uses Vazirmatn font and eye-friendly warm color palette.
"""

import re
import os
from fpdf import FPDF
import arabic_reshaper
from bidi.algorithm import get_display

# ── Paths ──────────────────────────────────────────────
BASE = os.path.dirname(os.path.abspath(__file__))
MD_PATH = os.path.join(BASE, "user-guide-fa.md")
OUT_PATH = os.path.join(BASE, "user-guide-fa.pdf")
FONT_DIR = os.path.join(BASE, "fonts", "ttf")

VAZIR_REGULAR = os.path.join(FONT_DIR, "Vazirmatn-Regular.ttf")
VAZIR_BOLD = os.path.join(FONT_DIR, "Vazirmatn-Bold.ttf")
VAZIR_MEDIUM = os.path.join(FONT_DIR, "Vazirmatn-Medium.ttf")
VAZIR_SEMIBOLD = os.path.join(FONT_DIR, "Vazirmatn-SemiBold.ttf")

# ── Eye-Friendly Color Palette ─────────────────────────
# Warm, muted tones — no harsh blues
COLORS = {
    "primary":       (88, 101, 84),     # #586154 - muted sage green (headings)
    "primary_light": (143, 163, 143),   # #8FA38F - light sage
    "accent":        (161, 136, 112),   # #A18870 - warm tan (bold text, links)
    "accent_dark":   (128, 107, 86),    # #806B56 - darker tan
    "text":          (58, 56, 52),      # #3A3834 - warm dark gray (body text)
    "text_light":    (115, 112, 107),   # #73706F - muted gray (footnotes)
    "code_bg":       (52, 52, 48),      # #343430 - soft dark (code blocks)
    "code_text":     (216, 212, 204),   # #D8D4CC - warm white
    "table_header":  (88, 101, 84),     # #586154 - sage green
    "table_even":    (247, 245, 241),   # #F7F5F1 - warm cream
    "table_odd":     (255, 253, 249),   # #FFFDF9 - off-white
    "border":        (196, 192, 186),   # #C4C0BA - warm border
    "blockquote_bg": (253, 250, 242),   # #FDFAF2 - warm ivory
    "blockquote_br": (186, 167, 128),   # #BAA780 - golden tan
    "blockquote_tx": (110, 97, 72),     # #6E6148 - olive text
    "bullet":        (88, 101, 84),     # #586154 - sage
    "separator":     (200, 196, 190),   # #C8C4BE - warm divider
}


def reshape_persian(text: str) -> str:
    reshaped = arabic_reshaper.reshape(text)
    return get_display(reshaped)


def is_persian(text: str) -> bool:
    return bool(re.search(r'[\u0600-\u06FF\u0750-\u077F\uFB50-\uFDFF\uFE70-\uFEFF]', text))


def smart_text(text: str) -> str:
    text = replace_emoji(text)
    if is_persian(text):
        return reshape_persian(text)
    return text


def replace_emoji(text: str) -> str:
    replacements = {
        '\U0001f4e5': '[+]', '\U0001f4e4': '[-]', '\U0001f680': '[>]',
        '\U0001f4ca': '[#]', '\u2705': '[OK]', '\u274c': '[X]',
    }
    for emoji, replacement in replacements.items():
        text = text.replace(emoji, replacement)
    return text


class PersianPDF(FPDF):
    def __init__(self):
        super().__init__(orientation='P', unit='mm', format='A4')
        self.set_auto_page_break(auto=True, margin=25)

        # Register Vazir font family
        self.add_font("Vazir", "", VAZIR_REGULAR)
        self.add_font("Vazir", "B", VAZIR_BOLD)
        self.add_font("Vazir", "I", VAZIR_MEDIUM)   # use Medium for italic slot
        self.add_font("Vazir", "BI", VAZIR_SEMIBOLD) # Semibold for bold-italic

    def header(self):
        if self.page_no() > 1:
            c = COLORS["primary_light"]
            self.set_font("Vazir", "", 7.5)
            self.set_text_color(*c)
            self.cell(0, 8, smart_text("راهنمای استفاده از ربات Forwardv2raybot"),
                      align='C', new_x="LMARGIN", new_y="NEXT")
            self.set_draw_color(*COLORS["separator"])
            self.set_line_width(0.3)
            self.line(20, 15, 190, 15)
            self.set_line_width(0.2)
            self.ln(5)

    def footer(self):
        self.set_y(-15)
        c = COLORS["text_light"]
        self.set_font("Vazir", "", 7.5)
        self.set_text_color(*c)
        self.cell(0, 10, smart_text(f"صفحه {self.page_no()}"), align='C')

    # ── Title ────────────────────────────────────────────
    def add_title(self, text: str):
        self.set_font("Vazir", "B", 22)
        self.set_text_color(*COLORS["primary"])
        self.ln(10)
        self.multi_cell(0, 14, smart_text(text), align='C')
        self.ln(3)
        c = COLORS["primary"]
        self.set_draw_color(*c)
        self.set_line_width(1.2)
        self.line(40, self.get_y(), 170, self.get_y())
        self.set_line_width(0.2)
        self.ln(10)

    # ── Section title (h2) ───────────────────────────────
    def add_section_title(self, text: str):
        self.ln(6)
        self.set_font("Vazir", "B", 14)
        self.set_text_color(*COLORS["primary"])
        self.multi_cell(0, 10, smart_text(text))
        c = COLORS["primary_light"]
        self.set_draw_color(*c)
        self.set_line_width(0.5)
        self.line(20, self.get_y() + 1, 190, self.get_y() + 1)
        self.set_line_width(0.2)
        self.ln(6)

    # ── Subsection title (h3) ────────────────────────────
    def add_subsection_title(self, text: str):
        self.ln(4)
        self.set_font("Vazir", "B", 12)
        self.set_text_color(*COLORS["accent_dark"])
        self.multi_cell(0, 8, smart_text(text))
        self.ln(3)

    # ── Paragraph ────────────────────────────────────────
    def add_paragraph(self, text: str):
        self.set_font("Vazir", "", 10.5)
        self.set_text_color(*COLORS["text"])
        clean = self._strip_md(text)
        self.multi_cell(0, 7.5, smart_text(clean), align='R')
        self.ln(2)

    # ── Code block ───────────────────────────────────────
    def add_code_block(self, lines: list):
        self.ln(3)
        start_y = self.get_y()
        line_h = 5.5
        block_h = len(lines) * line_h + 10

        # Check page break
        if start_y + block_h > 270:
            self.add_page()
            start_y = self.get_y()

        # Background
        bg = COLORS["code_bg"]
        self.set_fill_color(*bg)
        self.rect(22, start_y, 166, block_h, 'F')

        # Left accent bar
        bar = COLORS["primary"]
        self.set_fill_color(*bar)
        self.rect(22, start_y, 3, block_h, 'F')

        self.set_y(start_y + 5)
        self.set_font("Vazir", "", 8.5)
        self.set_text_color(*COLORS["code_text"])

        for line in lines:
            self.set_x(28)
            if is_persian(line):
                self.cell(156, line_h, smart_text(line),
                          new_x="LMARGIN", new_y="NEXT", align='R')
            else:
                self.cell(156, line_h, line,
                          new_x="LMARGIN", new_y="NEXT", align='L')

        self.set_y(start_y + block_h + 4)
        self.ln(2)

    # ── Table ────────────────────────────────────────────
    def add_table(self, headers: list, rows: list):
        self.ln(3)
        if self.get_y() > 250:
            self.add_page()

        col_w = self._col_widths(headers)
        x0 = 20

        # Header
        th = COLORS["table_header"]
        self.set_fill_color(*th)
        self.set_text_color(255, 255, 255)
        self.set_font("Vazir", "B", 9.5)
        self.set_draw_color(*th)

        self.set_x(x0)
        for i, h in enumerate(headers):
            self.cell(col_w[i], 9, smart_text(h),
                      border=1, fill=True, align='C')
        self.ln()

        # Rows
        self.set_draw_color(*COLORS["border"])
        for ri, row in enumerate(rows):
            bg = COLORS["table_even"] if ri % 2 == 0 else COLORS["table_odd"]
            self.set_fill_color(*bg)
            self.set_text_color(*COLORS["text"])
            self.set_x(x0)

            for i, cell in enumerate(row):
                cell_clean = self._strip_md(cell.strip())
                if cell_clean.startswith('/'):
                    self.set_font("Vazir", "", 8.5)
                    self.set_text_color(*COLORS["accent_dark"])
                else:
                    self.set_font("Vazir", "", 9)
                    self.set_text_color(*COLORS["text"])

                self.cell(col_w[i], 8, smart_text(cell_clean),
                          border=1, fill=True, align='R')
            self.ln()

        self.ln(4)

    def _col_widths(self, headers):
        usable = 170
        n = len(headers)
        if n == 2:
            return [45, usable - 45]
        elif n == 3:
            return [40, usable - 80, 40]
        return [usable / n] * n

    # ── Blockquote ───────────────────────────────────────
    def add_blockquote(self, title: str, text: str):
        self.ln(3)
        start_y = self.get_y()

        # Background
        bg = COLORS["blockquote_bg"]
        br = COLORS["blockquote_br"]
        self.set_fill_color(*bg)
        self.set_draw_color(*br)

        # Left border (drawn after text)

        # Title
        self.set_x(25)
        self.set_font("Vazir", "B", 10)
        self.set_text_color(*COLORS["accent_dark"])
        self.cell(160, 7, smart_text(title),
                  new_x="LMARGIN", new_y="NEXT", align='R')

        # Body
        body = self._strip_md(text)
        self.set_x(25)
        self.set_font("Vazir", "", 9.5)
        self.set_text_color(*COLORS["blockquote_tx"])
        self.multi_cell(160, 6, smart_text(body), align='R')

        end_y = self.get_y()
        # Draw the border bar
        self.set_line_width(1.8)
        self.line(189, start_y, 189, end_y + 2)
        self.set_line_width(0.2)

        self.ln(3)

    # ── Bullet ───────────────────────────────────────────
    def add_bullet(self, text: str):
        clean = self._strip_md(text)
        self.set_x(25)
        self.set_font("Vazir", "", 10)
        self.set_text_color(*COLORS["bullet"])
        self.cell(6, 7.5, smart_text("\u2014"), align='C')
        self.set_text_color(*COLORS["text"])
        self.multi_cell(154, 7.5, smart_text(clean), align='R')
        self.ln(1)

    # ── Numbered item ────────────────────────────────────
    def add_numbered_item(self, number: str, text: str):
        clean = self._strip_md(text)
        self.set_x(25)
        self.set_font("Vazir", "B", 10)
        self.set_text_color(*COLORS["primary"])
        self.cell(8, 7.5, smart_text(number), align='C')
        self.set_text_color(*COLORS["text"])
        self.set_font("Vazir", "", 10)
        self.multi_cell(152, 7.5, smart_text(clean), align='R')
        self.ln(1)

    # ── Separator ────────────────────────────────────────
    def add_separator(self):
        self.ln(4)
        c = COLORS["separator"]
        self.set_draw_color(*c)
        self.set_line_width(0.4)
        self.line(30, self.get_y(), 180, self.get_y())
        self.set_line_width(0.2)
        self.ln(6)

    # ── Italic footer ────────────────────────────────────
    def add_italic_footer(self, text: str):
        self.set_font("Vazir", "", 9)
        self.set_text_color(*COLORS["text_light"])
        self.multi_cell(0, 6, smart_text(text), align='C')
        self.ln(2)

    # ── Helpers ──────────────────────────────────────────
    def _strip_md(self, text: str) -> str:
        text = re.sub(r'\*\*(.+?)\*\*', r'\1', text)
        text = re.sub(r'\*(.+?)\*', r'\1', text)
        text = re.sub(r'`(.+?)`', r'\1', text)
        return text


# ── Parser & Generator ─────────────────────────────────
def parse_and_generate():
    with open(MD_PATH, 'r', encoding='utf-8') as f:
        lines = f.readlines()

    pdf = PersianPDF()
    pdf.set_margins(20, 20, 20)
    pdf.add_page()

    i = 0
    while i < len(lines):
        line = lines[i].rstrip('\n')

        if line.strip() == '':
            i += 1
            continue

        # Horizontal rule
        if line.strip() == '---':
            pdf.add_separator()
            i += 1
            continue

        # h1
        if line.startswith('# ') and not line.startswith('## '):
            pdf.add_title(line[2:].strip())
            i += 1
            continue

        # h2
        if line.startswith('## '):
            pdf.add_section_title(line[3:].strip())
            i += 1
            continue

        # h3
        if line.startswith('### '):
            pdf.add_subsection_title(line[4:].strip())
            i += 1
            continue

        # Code block
        if line.strip().startswith('```'):
            code_lines = []
            i += 1
            while i < len(lines) and not lines[i].strip().startswith('```'):
                code_lines.append(lines[i].rstrip('\n'))
                i += 1
            pdf.add_code_block(code_lines)
            i += 1
            continue

        # Table
        if '|' in line and line.strip().startswith('|'):
            table_lines = []
            while i < len(lines) and '|' in lines[i]:
                table_lines.append(lines[i].strip())
                i += 1
            headers = [c.strip() for c in table_lines[0].split('|')[1:-1]]
            rows = []
            for tl in table_lines[2:]:
                row = [c.strip() for c in tl.split('|')[1:-1]]
                if len(row) == len(headers):
                    rows.append(row)
            pdf.add_table(headers, rows)
            continue

        # Blockquote
        if line.startswith('> '):
            bq_text = line[2:].strip()
            while i + 1 < len(lines) and lines[i + 1].startswith('> '):
                i += 1
                bq_text += ' ' + lines[i][2:].strip()
            bold_match = re.match(r'\*\*(.+?)\*\*:?\s*(.*)', bq_text)
            if bold_match:
                title = bold_match.group(1)
                body = bold_match.group(2)
                pdf.add_blockquote(title, body)
            else:
                pdf.add_blockquote("", bq_text)
            i += 1
            continue

        # Numbered list
        num_match = re.match(r'^(\d+)\.\s+(.+)', line)
        if num_match:
            pdf.add_numbered_item(num_match.group(1), num_match.group(2))
            i += 1
            continue

        # Bullet list
        if line.startswith('- '):
            pdf.add_bullet(line[2:])
            i += 1
            continue

        # Italic footer
        if line.startswith('*') and line.endswith('*') and not line.startswith('**'):
            pdf.add_italic_footer(line.strip('*').strip())
            i += 1
            continue

        # Regular paragraph
        pdf.add_paragraph(line)
        i += 1

    pdf.output(OUT_PATH)
    import sys
    sys.stdout.buffer.write(b"PDF generated successfully\n")


if __name__ == '__main__':
    parse_and_generate()
