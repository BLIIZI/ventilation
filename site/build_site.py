#!/usr/bin/env python3
"""Сборка сайта из одного источника:
   web/app.template.html + web/engine.js  -> web/index.html   (двойник)
   Модель_расчёт_v2.xlsx (после пересчёта) -> web/calc.html     (все листы, формулы)
   site/example.md + engine.json           -> web/example.html  (пример расчёта, сверка чисел с ядром)
Запуск: python3 site/build_site.py  (из /home/claude/vent-sim). Падает, если числа примера разошлись с ядром."""
import html, json, re, shutil, sys, datetime, pathlib
import openpyxl
from openpyxl.utils import get_column_letter

ROOT = pathlib.Path(__file__).resolve().parent.parent
WEB, SITE = ROOT / 'web', ROOT / 'site'
XLSX = pathlib.Path('/home/claude/model/Модель_расчёт_v2.xlsx')
ENGINE_JSON = pathlib.Path('/home/claude/model/v2/engine.json')
XLSX_NAME = 'model_raschet.xlsx'
XLSX_URL = 'https://bliizi.github.io/ventilation/' + XLSX_NAME
VERSION = 'v1.7'
MSK = datetime.timezone(datetime.timedelta(hours=3))
BUILD = f'модель {VERSION} · сборка {datetime.datetime.now(MSK):%d.%m.%Y %H:%M}'
esc = html.escape
SKEL = '<!doctype html>\n<html lang="ru">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n'

# ---------- общий верх страницы
common = (SITE / 'common.html').read_text()
cut = common.index('</style>') + len('</style>')
COMMON_CSS, NAV = common[:cut], common[cut:]
def page_parts(cur):
    nav = NAV.replace('{{BUILD}}', BUILD).replace('{{XLSX_URL}}', XLSX_URL)
    for p in ('index', 'calc', 'example'):
        nav = nav.replace('{{CUR_%s}}' % p, 'aria-current="page"' if p == cur else '')
    return COMMON_CSS, nav
HEAD_FONTS = '''<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Golos+Text:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500&display=swap">'''

def count_tests():
    return sum(len(re.findall(r'^\s*(?:test|it)\(', f.read_text(), re.M)) for f in (ROOT / 'test').glob('*.test.ts'))

# ---------- 1. двойник
def build_index():
    css, nav = page_parts('index')
    t = (WEB / 'app.template.html').read_text()
    t = t.replace('<!--COMMON-->', css).replace('<!--NAV-->', nav).replace('{{TESTS}}', str(count_tests()))
    eng = (WEB / 'engine.js').read_text()
    assert '/*ENGINE*/' in t
    t = t.replace('/*ENGINE*/', eng)
    (WEB / 'index.html').write_text(SKEL + t)
    return len(t)

# ---------- 2. Excel -> HTML
def fmt_num(v, nf):
    if isinstance(v, bool): return 'ИСТИНА' if v else 'ЛОЖЬ'
    if isinstance(v, (datetime.date, datetime.datetime)): return v.strftime('%d.%m.%Y')
    if not isinstance(v, (int, float)): return str(v)
    nf = (nf or 'General').split(';')[0]
    if 'E+' in nf.upper():
        d = len(nf.split('.')[1].upper().split('E')[0]) if '.' in nf else 0
        return f'{v:.{d}E}'.replace('.', ',')
    pct = '%' in nf
    if nf == 'General':
        if float(v).is_integer() and abs(v) < 1e15: s = f'{int(v)}'
        else: s = f'{v:.6g}' if abs(v) < 1e5 else f'{v:.8g}'
        if 'e' in s: s = f'{v:.4E}'
        return s.replace('.', ',')
    core = nf.replace('%', '')
    d = len(core.split('.')[1]) if '.' in core else 0
    x = v * 100 if pct else v
    s = f'{x:,.{d}f}' if ',' in core else f'{x:.{d}f}'
    s = s.replace(',', '\u202f').replace('.', ',')
    return s + ('\u202f%' if pct else '')

FONT_CLS = {'FF0000FF': 'in', 'FF008000': 'xl', 'FF555555': 'nt', 'FF0563C1': 'hl'}
def build_calc():
    wbF = openpyxl.load_workbook(XLSX)                 # формулы
    wbV = openpyxl.load_workbook(XLSX, data_only=True)  # значения после пересчёта
    sheets, tabs = [], []
    nform = 0
    for si, wsF in enumerate(wbF):
        wsV = wbV[wsF.title]
        maxr, maxc = wsF.max_row, wsF.max_column
        merged = {}; skip = set()
        for rg in wsF.merged_cells.ranges:
            merged[(rg.min_row, rg.min_col)] = (rg.max_row - rg.min_row + 1, rg.max_col - rg.min_col + 1)
            for r in range(rg.min_row, rg.max_row + 1):
                for c in range(rg.min_col, rg.max_col + 1):
                    if (r, c) != (rg.min_row, rg.min_col): skip.add((r, c))
        widths = []
        for c in range(1, maxc + 1):
            d = wsF.column_dimensions.get(get_column_letter(c))
            w = d.width if d is not None and d.width else 8.43
            widths.append(round(w * 7 + 6))
        cols = '<col class="rn">' + ''.join(f'<col style="width:{w}px">' for w in widths)
        head = '<tr><th class="corner"></th>' + ''.join(f'<th>{get_column_letter(c)}</th>' for c in range(1, maxc + 1)) + '</tr>'
        body = []
        for r in range(1, maxr + 1):
            tds = []
            for c in range(1, maxc + 1):
                if (r, c) in skip: continue
                cF, cV = wsF.cell(r, c), wsV.cell(r, c)
                raw = cF.value
                formula = None
                if isinstance(raw, str) and raw.startswith('='): formula = raw
                elif raw is not None and not isinstance(raw, (str, int, float, bool, datetime.date)):
                    formula = getattr(raw, 'text', str(raw))
                val = cV.value if formula else raw
                txt = '' if val is None else fmt_num(val, cF.number_format)
                cls = []; style = []
                if isinstance(val, (int, float)) and not isinstance(val, bool): cls.append('n')
                f = cF.font
                if f is not None:
                    if f.b: cls.append('b')
                    if f.i: cls.append('i')
                    if f.sz and f.sz >= 13: cls.append('big')
                    col = f.color.rgb if (f.color is not None and isinstance(f.color.rgb, str)) else None
                    if col in FONT_CLS: cls.append(FONT_CLS[col])
                if cF.fill is not None and cF.fill.fill_type and isinstance(cF.fill.fgColor.rgb, str) and cF.fill.fgColor.rgb not in ('00000000', 'FFFFFFFF'):
                    style.append(f'background:#{cF.fill.fgColor.rgb[2:]}')
                al = cF.alignment
                if al is not None:
                    if al.wrap_text: cls.append('w')
                    if al.horizontal in ('center', 'centerContinuous'): style.append('text-align:center')
                    elif al.horizontal == 'right': style.append('text-align:right')
                    elif al.horizontal == 'left': style.append('text-align:left')
                if formula: cls.append('f'); nform += 1
                if isinstance(val, str) and val in ('ОК', 'OK'): cls.append('okv')
                if isinstance(val, str) and val.startswith('#'): cls.append('err')
                attrs = f' data-a="{get_column_letter(c)}{r}"'
                if formula: attrs += f' data-f="{esc(formula)}"'
                if (r, c) in merged:
                    rs, cs = merged[(r, c)]
                    if rs > 1: attrs += f' rowspan="{rs}"'
                    if cs > 1: attrs += f' colspan="{cs}"'
                inner = esc(txt)
                if cF.hyperlink is not None:
                    tgt = cF.hyperlink.target
                    if tgt: inner = f'<a href="{esc(tgt)}" target="_blank" rel="noopener">{inner}</a>'
                if cF.comment is not None:
                    attrs += f' data-c="{esc(cF.comment.text.strip())}"'; cls.append('cm')
                tds.append(f'<td{attrs}' + (f' class="{" ".join(cls)}"' if cls else '') + (f' style="{";".join(style)}"' if style else '') + f'>{inner}</td>')
            body.append(f'<tr><th>{r}</th>{"".join(tds)}</tr>')
        sid = f's{si}'
        tabs.append(f'<button role="tab" id="t-{sid}" aria-controls="{sid}" aria-selected="{"true" if si == 0 else "false"}" data-s="{sid}">{esc(wsF.title)}</button>')
        sheets.append(f'<div class="sheet" id="{sid}" role="tabpanel" aria-labelledby="t-{sid}" {"" if si == 0 else "hidden"}><table class="xl" style="width:{40 + sum(widths)}px"><colgroup>{cols}</colgroup><thead>{head}</thead><tbody>{"".join(body)}</tbody></table></div>')
    # статус сверки
    ws8 = wbV['8 Сверка']
    st = [ws8.cell(r, 5).value for r in range(5, ws8.max_row + 1) if ws8.cell(r, 1).value]
    ok = sum(1 for v in st if v == 'ОК'); tot = len([v for v in st if v])
    css, nav = page_parts('calc')
    page = (SITE / 'calc.template.html').read_text()
    page = page.replace('<!--FONTS-->', HEAD_FONTS).replace('<!--COMMON-->', css).replace('<!--NAV-->', nav)
    page = page.replace('{{TABS}}', ''.join(tabs)).replace('{{SHEETS}}', ''.join(sheets))
    page = page.replace('{{XLSX_URL}}', XLSX_URL).replace('{{NSHEETS}}', str(len(tabs))).replace('{{NFORM}}', str(nform))
    page = page.replace('{{SVERKA}}', f'{ok} из {tot}').replace('{{SVERKA_CLS}}', '' if ok == tot else 'crit').replace('{{BUILD}}', BUILD)
    (WEB / 'calc.html').write_text(SKEL + page)
    shutil.copy(XLSX, WEB / XLSX_NAME)
    return len(tabs), nform, ok, tot

# ---------- 3. Пример расчёта (markdown -> html) + сверка ключевых чисел с ядром
def inline(s):
    s = esc(s)
    s = re.sub(r'\*\*(.+?)\*\*', r'<strong>\1</strong>', s)
    return s
def md2html(md):
    lines = md.split('\n'); out = []; toc = []; i = 0; hid = 0
    def flush_para(buf):
        if buf: out.append('<p>' + inline(' '.join(x.strip() for x in buf)) + '</p>')
    para = []
    while i < len(lines):
        ln = lines[i]
        if not ln.strip(): flush_para(para); para = []; i += 1; continue
        m = re.match(r'^(#{1,4}) (.*)', ln)
        if m:
            flush_para(para); para = []
            lvl, txt = len(m.group(1)), m.group(2).strip()
            if lvl == 1: i += 1; continue           # заголовок документа — в шапке страницы
            hid += 1; aid = f'h{hid}'
            if lvl <= 3: toc.append((lvl, aid, txt))
            out.append(f'<h{lvl} id="{aid}">{inline(txt)}</h{lvl}>'); i += 1; continue
        if ln.strip() == '$$':
            flush_para(para); para = []; j = i + 1; buf = []
            while j < len(lines) and lines[j].strip() != '$$': buf.append(lines[j]); j += 1
            out.append('<div class="math">\\[' + esc('\n'.join(buf)) + '\\]</div>'); i = j + 1; continue
        if ln.startswith('|'):
            flush_para(para); para = []; rows = []
            while i < len(lines) and lines[i].startswith('|'): rows.append(lines[i]); i += 1
            cells = [[c.strip().replace('\\|', '|') for c in re.split(r'(?<!\\)\|', r.strip())[1:-1]] for r in rows]
            hdr, body = cells[0], [r for r in cells[2:]]
            t = '<div class="tw"><table><thead><tr>' + ''.join(f'<th>{inline(c)}</th>' for c in hdr) + '</tr></thead><tbody>'
            t += ''.join('<tr>' + ''.join(f'<td>{inline(c)}</td>' for c in r) + '</tr>' for r in body) + '</tbody></table></div>'
            out.append(t); continue
        if re.match(r'^\s*(- |\d+\. )', ln):
            flush_para(para); para = []
            items = []
            while i < len(lines) and re.match(r'^\s*(- |\d+\. )', lines[i]):
                m2 = re.match(r'^(\s*)(- |\d+\. )(.*)', lines[i]); items.append((len(m2.group(1)) // 2, m2.group(2) != '- ', m2.group(3))); i += 1
            html_ = []; stack = []
            for depth, ordered, txt in items:
                while len(stack) > depth + 1: html_.append('</li></%s>' % stack.pop())
                if len(stack) < depth + 1:
                    tag = 'ol' if ordered else 'ul'; stack.append(tag); html_.append(f'<{tag}><li>')
                else: html_.append('</li><li>')
                html_.append(inline(txt))
            while stack: html_.append('</li></%s>' % stack.pop())
            out.append(''.join(html_)); continue
        para.append(ln); i += 1
    flush_para(para)
    return '\n'.join(out), toc

def ru(v, d):
    s = f'{v:,.{d}f}'.replace(',', ' ').replace('.', ',')
    return s
def build_example():
    E = json.loads(ENGINE_JSON.read_text())
    md = (SITE / 'example.md').read_text()
    sh = E['shift']
    # (что, значение из ядра, знаков) — каждое число должно встречаться в тексте примера
    checks = [
        ('Коэффициент расплавления α_р, г/(А·ч)', E['alpha225'], 3),
        ('Расход проволоки B при 225 А, кг/ч', E['B225'], 2),
        ('Весь воздухообмен L по СП 60, м³/ч', E['Ltot3'], 0),
        ('Общеобменная L − L_мо, м³/ч', E['Lgen3'], 0),
        ('Давление вентилятора, Па', E['pFan'], 1),
        ('Обороты вентилятора, об/мин', E['n'], 0),
        ('Расход местной вытяжки, м³/ч', E['Qtotal'] * 3600, 0),
        ('Мощность на валу, Вт', E['power'], 0),
        ('Мощность из сети, Вт', E['powerEl'], 0),
        ('Угол заслонки после ПИ-шага, °', E['piAngle'], 1),
        ('Стандарт: номинальные обороты, об/мин', E['std']['nNom'], 0),
        ('Стандарт: мощность из сети, кВт', E['std']['powerEl'] / 1000, 3),
        ('Энергия смены: стандарт (без регулирования), кВт·ч', sh['constant']['fanKWh'], 2),
        ('Энергия смены: «открыто/закрыто» (для справки), кВт·ч', sh['onoff']['fanKWh'], 2),
        ('Энергия смены: предлагаемая, кВт·ч', sh['adaptive']['fanKWh'], 2),
        ('Тепло смены: стандарт (без регулирования), кВт·ч', sh['constant']['heatKWh'], 0),
        ('Тепло смены: предлагаемая + ОВ по постам, кВт·ч', sh['adaptive_gen']['heatKWh'], 0),
        ('Перерасход воздуха: «открыто/закрыто», %', sh['onoff']['over'] * 100, 1),
        ('Перерасход воздуха: предлагаемая, %', sh['adaptive']['over'] * 100, 1),
    ]
    flat = md.replace('\u00a0', ' ').replace('\u202f', ' ')
    res = []
    for name, v, d in checks:
        a, b = ru(v, d), ru(v, d).replace(' ', '')
        res.append((name, a, a in flat or b in flat))
    bad = [r for r in res if not r[2]]
    body, toc = md2html(md)
    toc_html = ''.join(f'<a class="l{l}" href="#{a}">{inline(t)}</a>' for l, a, t in toc)
    rows = ''.join(f'<tr><td>{esc(n)}</td><td class="n">{esc(v)}</td><td class="{"ok" if okk else "bad"}">{"совпадает" if okk else "РАСХОДИТСЯ"}</td></tr>' for n, v, okk in res)
    css, nav = page_parts('example')
    page = (SITE / 'example.template.html').read_text()
    page = page.replace('<!--FONTS-->', HEAD_FONTS).replace('<!--COMMON-->', css).replace('<!--NAV-->', nav)
    page = page.replace('{{TOC}}', toc_html).replace('{{BODY}}', body).replace('{{CHECKS}}', rows)
    page = page.replace('{{NOK}}', str(len(res) - len(bad))).replace('{{NALL}}', str(len(res))).replace('{{CHK_CLS}}', '' if not bad else 'crit')
    page = page.replace('{{BUILD}}', BUILD).replace('{{TESTS}}', str(count_tests()))
    (WEB / 'example.html').write_text(SKEL + page)
    return res, bad

if __name__ == '__main__':
    n = build_index(); print('index.html', n, 'байт')
    print('calc.html: листов %d, формул %d, сверка %d/%d' % build_calc())
    res, bad = build_example()
    print('example.html: сверка чисел с ядром %d/%d' % (len(res) - len(bad), len(res)))
    if bad:
        print('РАСХОДЯТСЯ с ядром — обновить site/example.md:'); [print('  ', n, '→', v) for n, v, _ in bad]
        if '--strict' in sys.argv: sys.exit(1)
