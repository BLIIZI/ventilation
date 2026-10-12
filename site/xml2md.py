import re, xml.etree.ElementTree as ET, sys
x = open(sys.argv[1]).read()
root = ET.fromstring(x)
def inline(el):
    out = ''
    if el.tag == 'text': return (el.text or '') + ''.join(inline(c) for c in el)
    if el.tag == 'bold': return '**' + (el.text or '') + ''.join(inline(c) for c in el) + '**'
    if el.tag == 'date': return el.get('value')
    if el.tag == 'mention': return el.get('name')
    for c in el: out += inline(c)
    return out
lines = []
def block(el, depth=0, ordered=None, idx=[0]):
    t = el.tag
    if t == 'paragraph':
        h = el.get('heading'); s = ''.join(inline(c) for c in el)
        if el.get('kind') == 'code' or el.get('language'): lines.append('```\n' + s + '\n```'); lines.append(''); return
        lines.append(('#' * int(h) + ' ' if h else '') + s); lines.append('')
    elif t == 'codeBlock':
        code = ''.join(inline(c) for c in el)
        lines.append('$$\n' + code.strip() + '\n$$' if el.get('language') == 'latex' else '```\n' + code + '\n```'); lines.append('')
    elif t == 'list':
        kind = el.get('kind')
        n = 0
        for c in el:
            if c.tag == 'list': block(c, depth + 1); continue
            n += 1
            s = ' '.join(''.join(inline(k) for k in p) for p in c if p.tag == 'paragraph')
            subs = [p for p in c if p.tag == 'list']
            pre = f'{n}. ' if kind in ('ordered', 'number', 'numbered') else '- '
            lines.append('  ' * depth + pre + s)
            for sl in subs: block(sl, depth + 1)
        lines.append('')
    elif t == 'table':
        rows = [[' '.join(''.join(inline(k) for k in p) for p in cell) for cell in r] for r in el]
        if not rows: return
        lines.append('| ' + ' | '.join(rows[0]) + ' |'); lines.append('|' + '---|' * len(rows[0]))
        for r in rows[1:]: lines.append('| ' + ' | '.join(c.replace('|', '\\|') for c in r) + ' |')
        lines.append('')
    else:
        for c in el: block(c, depth)
for c in root: block(c)
open(sys.argv[2], 'w').write(re.sub(r'\n{3,}', '\n\n', '\n'.join(lines)))
