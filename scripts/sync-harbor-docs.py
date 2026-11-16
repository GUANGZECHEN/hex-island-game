"""Regenerate paired scope/decision Word documents from their approved Markdown sources.
Requires python-docx==1.2.0; developer/CI utility only, never part of the game bundle.
"""
from pathlib import Path
from docx import Document
from docx.shared import Inches, Pt

ROOT = Path(__file__).resolve().parents[1]
for stem in ['01_product_scope', '04_decision_log']:
    doc = Document()
    section = doc.sections[0]
    section.top_margin = section.bottom_margin = Inches(.7)
    section.left_margin = section.right_margin = Inches(.75)
    style = doc.styles['Normal']
    style.font.name = 'Calibri'
    style.font.size = Pt(10)
    style.paragraph_format.space_after = Pt(6)
    if stem == '01_product_scope':
        style.font.size = Pt(9.5)
        style.paragraph_format.space_after = Pt(4)
        for heading in ['Heading 1', 'Heading 2', 'Heading 3']:
            doc.styles[heading].paragraph_format.space_before = Pt(10)
            doc.styles[heading].paragraph_format.space_after = Pt(5)
    lines = (ROOT / 'design_principles' / f'{stem}.md').read_text().splitlines()
    i = 0
    while i < len(lines):
        line = lines[i].strip().replace('**', '').replace('`', '')
        i += 1
        if not line:
            continue
        if line.startswith('|'):
            rows = [line]
            while i < len(lines) and lines[i].strip().startswith('|'):
                rows.append(lines[i].strip()); i += 1
            data = [[c.strip() for c in row.strip('|').split('|')] for row in rows
                    if not set(row.replace('|', '').replace(' ', '').replace(':', '')) <= set('-')]
            table = doc.add_table(rows=0, cols=max(map(len, data)))
            table.style = 'Light Shading Accent 1'
            for row in data:
                cells = table.add_row().cells
                for j, value in enumerate(row):
                    cells[j].text = value
        elif line.startswith('#'):
            level = len(line) - len(line.lstrip('#'))
            doc.add_heading(line[level:].strip(), min(level-1, 3))
        elif line.startswith('- '):
            doc.add_paragraph(line[2:], style='List Bullet')
        else:
            doc.add_paragraph(line)
    doc.save(ROOT / 'design_principles' / f'{stem}.docx')
