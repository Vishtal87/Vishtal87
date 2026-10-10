# Собирает страницы юридических документов из docs/*.md в site/*.html (для GitHub Pages).
# Поддерживает только то, что есть в наших документах: заголовки, абзацы, списки, цитаты, разделители, **жирный**.
import html
import os
import re

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, '..')
PAGES = {
    'privacy': ('Политика конфиденциальности / Privacy Policy', os.path.join(ROOT, 'docs', 'privacy-policy.md')),
    'terms': ('Условия использования / Terms of Use', os.path.join(ROOT, 'docs', 'terms.md')),
}

STYLE = """
:root { color-scheme: light dark; --bg:#FFF6D6; --card:#fff; --ink:#000; --accent:#FF3D8B; }
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { --bg:#121212; --card:#1E1E1E; --ink:#fff; --accent:#FFE600; } }
body { margin:0; background:var(--bg); color:var(--ink); font:16px/1.55 -apple-system,system-ui,sans-serif; }
main { max-width:720px; margin:0 auto; padding:24px 16px 64px; }
h1 { font-size:24px; text-transform:uppercase; border-bottom:4px solid var(--ink); padding-bottom:8px; }
h2 { font-size:18px; margin-top:28px; text-transform:uppercase; }
blockquote { margin:12px 0; padding:10px 14px; background:var(--card); border:3px solid var(--ink); }
hr { border:0; border-top:3px solid var(--ink); margin:28px 0; }
ul { padding-left:20px; }
nav a { font-weight:800; color:var(--ink); margin-right:16px; }
"""


def inline(text):
    escaped = html.escape(text, quote=False)
    return re.sub(r'\*\*(.+?)\*\*', r'<b>\1</b>', escaped)


def convert(md):
    out, in_list, para = [], False, []

    def flush_para():
        if para:
            out.append('<p>' + inline(' '.join(para)) + '</p>')
            para.clear()

    def close_list():
        nonlocal in_list
        if in_list:
            out.append('</ul>')
            in_list = False

    for raw in md.splitlines():
        line = raw.rstrip()
        if not line.strip():
            flush_para()
            close_list()
            continue
        if line.startswith('# '):
            flush_para(); close_list(); out.append('<h1>' + inline(line[2:]) + '</h1>')
        elif line.startswith('## '):
            flush_para(); close_list(); out.append('<h2>' + inline(line[3:]) + '</h2>')
        elif line.startswith('> '):
            flush_para(); close_list(); out.append('<blockquote>' + inline(line[2:]) + '</blockquote>')
        elif line.strip() == '---':
            flush_para(); close_list(); out.append('<hr>')
        elif line.startswith('- '):
            flush_para()
            if not in_list:
                out.append('<ul>')
                in_list = True
            out.append('<li>' + inline(line[2:]) + '</li>')
        else:
            close_list()
            para.append(line.strip())
    flush_para()
    close_list()
    return '\n'.join(out)


def page(title, body):
    nav = '<nav><a href="privacy.html">Privacy</a><a href="terms.html">Terms</a></nav>'
    return f'<!doctype html>\n<html lang="ru"><head><meta charset="utf-8">\n<meta name="viewport" content="width=device-width,initial-scale=1">\n<title>{html.escape(title)}</title>\n<style>{STYLE}</style></head>\n<body><main>{nav}\n{body}\n</main></body></html>\n'


def main():
    out_dir = os.path.join(ROOT, 'site')
    os.makedirs(out_dir, exist_ok=True)
    for key, (title, src) in PAGES.items():
        with open(src, encoding='utf-8') as f:
            body = convert(f.read())
        with open(os.path.join(out_dir, f'{key}.html'), 'w', encoding='utf-8') as f:
            f.write(page(title, body))
    with open(os.path.join(out_dir, 'index.html'), 'w', encoding='utf-8') as f:
        f.write(page('Дневник здоровья', '<h1>Дневник здоровья</h1><p><a href="privacy.html">Политика конфиденциальности</a></p><p><a href="terms.html">Условия использования</a></p>'))


if __name__ == '__main__':
    main()
