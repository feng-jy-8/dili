"""Rebuild the SVG candidates and gallery; --render also exports PNG previews.

SVG/HTML generation uses Python's standard library. PNG exports additionally
use system PyGObject/Rsvg, pycairo and Pillow; no application dependencies change.
"""
from pathlib import Path
import argparse
import html
import json

ROOT = Path(__file__).resolve().parent
ITEMS = [
    dict(id='13', name='D 里有你', en='A Smile Inside', category='D × iLi · 完整字母',
         description='大 D 是外形；两枚 i 是眼睛，居中的 L 转弯向上成为鼻子和笑线。最直接回应 D + iLi 的构想。',
         slogan='D 里，是一个微笑。', colors=['#51418c', '#fff5df', '#ffb59d'], kind='literal'),
    dict(id='14', name='留白的笑', en='Room to Smile', category='D × iLi · 线框',
         description='用大 D 的线框包住 iLi；保留字母笔画和内部留白，适合更轻、更克制的工具界面。',
         slogan='给下一步，留点空间。', colors=['#145d61', '#fff5df', '#efaa76'], kind='outline'),
    dict(id='15', name='奶油嘀', en='Soft D', category='D × iLi · 图标',
         description='珊瑚色方块里嵌入奶油色大 D，缩短 i 的竖笔，让字母自然过渡成一张小脸。',
         slogan='打开，就有好心情。', colors=['#dd6852', '#fff1cf', '#55372f'], kind='cream'),
    dict(id='16', name='歪头嘀', en='Little Wink', category='D × iLi · 表情',
         description='轻轻歪头的大 D，右侧 i 变成眨眼；L 保留向上弯的笑线，更强调伙伴的性格。',
         slogan='懂你，也陪你开工。', colors=['#ad4b64', '#fff1dc', '#ffc4a3'], kind='wink'),
    dict(id='17', name='两个 i', en='Two Little Agents', category='D × iLi · 双伙伴',
         description='两枚不同颜色的 i 共处一个 D；眼睛各自独立，中间的 L 把它们连成一张笑脸。',
         slogan='各有所长，一起向前。', colors=['#164f68', '#c5f1df', '#ffbe8e'], kind='twins'),
    dict(id='18', name='一笔笑 D', en='An Open Smile', category='D × 笑脸 · 连续线',
         description='D 的左侧轮廓转入内部成为笑线，配上两枚眼睛；字母关系更含蓄，适合简洁的品牌。',
         slogan='一笔相连，一直在线。', colors=['#20665b', '#eff5d8', '#e8ac6d'], kind='line'),
    dict(id='19', name='口袋伙伴', en='Pocket Companion', category='D × iLi · 口袋',
         description='深蓝大 D 像一只小口袋；双 i、弯折 L 和两侧的小脸颊，让工作台有一点温度。',
         slogan='把工作，装进口袋。', colors=['#29395d', '#f5e8ca', '#ee9c83'], kind='pocket'),
    dict(id='20', name='折角 D', en='Folded D', category='D × iLi · 几何',
         description='把 D 的右侧做成切角轮廓，内部使用方点 i 和直角 L；更利落，也保留轻微笑意。',
         slogan='有棱角，也有笑意。', colors=['#e7b84d', '#303a31', '#fff6dc'], kind='fold'),
    dict(id='21', name='括号伙伴', en='Friendly Syntax', category='其他方向 · 开发工具',
         description='一对方括号围住两枚眼睛和笑线；把代码里的结构感变成一个轻松的工作伙伴。',
         slogan='把想法，接进工作。', colors=['#385b9b', '#f6f0df', '#e6aa73'], kind='brackets'),
    dict(id='22', name='双页笑脸', en='Happy Handoff', category='其他方向 · 上下文',
         description='两张错开的纸页，一张留下、一张继续；前面的笑脸呼应笔记、交接和上下文延续。',
         slogan='这一页，接着往下做。', colors=['#276658', '#d2efc9', '#f4b48c'], kind='pages'),
    dict(id='23', name='笑着开工', en='Ready to Go', category='其他方向 · 纯表情',
         description='不依赖字母或气泡，用两枚短竖眼和一条粗笑弧形成直接的表情；圆形轮廓便于小尺寸识别。',
         slogan='有回应，就有动力。', colors=['#f2b16e', '#4d3b52', '#fff4dc'], kind='smile'),
    dict(id='24', name='四瓣回应', en='A Little Bloom', category='其他方向 · 伙伴标记',
         description='四个圆瓣围住一张小脸，像一个会回应的工作印章；用柔软形状表达多个会话共同参与。',
         slogan='让每个想法，有回响。', colors=['#7057a0', '#fff2d7', '#eeb18f'], kind='bloom'),
]


def path(d, color, width=None):
    if width is None:
        return f'<path d="{d}" fill="{color}"/>'
    return f'<path d="{d}" fill="none" stroke="{color}" stroke-width="{width}" stroke-linecap="round" stroke-linejoin="round"/>'


def circle(x, y, r, color):
    return f'<circle cx="{x}" cy="{y}" r="{r}" fill="{color}"/>'


D = 'M19 16H47C72 16 86 29 86 50S72 84 47 84H19Z'
L = 'M49 39V59Q49 68 58 68Q64 68 67 62'


def little_i(x, color, y=36, short=False):
    return circle(x, y, 3.6, color) + path(f'M{x} {y+10}v{4 if short else 8}', color, 5.4)


def mark(item, mono=False, dark=False):
    body, face, accent = item['colors']
    kind = item['kind']
    if dark and kind in ('outline', 'line', 'brackets'):
        body = {'outline': '#a7e2d4', 'line': '#a7e2cc', 'brackets': '#a8c0f5'}[kind]
    if mono:
        body, face, accent = '#20251f', '#ffffff', '#ffffff'
    if kind == 'literal':
        return path(D, body) + little_i(35, face) + little_i(69, face) + path(L, face, 5.4)
    if kind == 'outline':
        return path(D, body, 7) + little_i(34, body, 35, True) + little_i(68, body, 35, True) + path('M48 40V59Q48 67 57 67Q63 67 66 62', body, 4.8)
    if kind == 'cream':
        outer = f'<rect x="7" y="7" width="86" height="86" rx="25" fill="{body}"/>'
        inner = '<g transform="translate(12 12) scale(.76)">' + path(D, face)
        eyes = body if mono else accent
        return outer + inner + little_i(35, eyes, 36, True) + little_i(69, eyes, 36, True) + path(L, eyes, 5.4) + '</g>'
    if kind == 'wink':
        content = path(D, body) + little_i(35, face) + path('M64 39l9-4', face, 5.4) + path(L, face, 5.4)
        return '<g transform="rotate(-7 50 50)">' + content + '</g>'
    if kind == 'twins':
        return path(D, body) + little_i(34, face, 35) + little_i(70, accent, 35) + path('M49 39V57Q49 67 58 67Q64 67 68 61', face, 5.3)
    if kind == 'line':
        return path('M20 71V17H46C71 17 84 30 84 50S71 83 46 83H20V57Q32 74 51 71Q64 69 68 60', body, 7) + circle(37, 40, 3.7, body) + circle(64, 40, 3.7, body)
    if kind == 'pocket':
        return path('M16 16H47C72 16 87 30 87 50S72 85 47 85H16Q13 50 16 16Z', body) + little_i(34, face, 34, True) + little_i(69, face, 34, True) + path('M48 40V58Q48 67 57 67Q64 67 67 61', face, 5.5) + path('M27 60h5M72 60h4', accent, 3)
    if kind == 'fold':
        fg = '#ffffff' if mono else face
        return path('M17 14H58L84 36V65L61 86H17Z', body) + f'<rect x="29" y="32" width="7" height="7" rx="1" fill="{fg}"/><rect x="65" y="32" width="7" height="7" rx="1" fill="{fg}"/>' + path('M32.5 47v7M68.5 47v7M48 38V67H64L69 62', fg, 5.2)
    if kind == 'brackets':
        return path('M26 18H13V82H26M74 18H87V82H74', body, 7) + circle(38, 40, 4, body) + circle(62, 40, 4, body) + path('M33 59Q50 77 67 59', body, 6)
    if kind == 'pages':
        paper = '#ffffff' if mono else face
        return f'<rect x="14" y="11" width="61" height="69" rx="17" transform="rotate(-9 44.5 45.5)" fill="{accent if not mono else body}"/>' + f'<rect x="24" y="23" width="63" height="68" rx="18" fill="{body}"/><rect x="30" y="29" width="51" height="56" rx="12" fill="{paper}"/>' + circle(44, 48, 3.5, body) + circle(67, 48, 3.5, body) + path('M43 64Q55 76 68 63', body, 4.8)
    if kind == 'smile':
        ink = '#ffffff' if mono else face
        return circle(50, 50, 43, body) + path('M35 31v13M65 31v13', ink, 7) + path('M29 59Q50 84 72 59', ink, 7)
    if kind == 'bloom':
        return path('M50 16C63-2 87 13 81 32C103 36 99 64 80 66C85 87 60 99 48 82C32 99 10 83 17 65C-3 58 3 33 23 32C17 12 40 1 50 16Z', body) + circle(36, 43, 3.8, face) + circle(62, 43, 3.8, face) + path('M34 59Q49 74 65 59', face, 5.5)
    raise ValueError(kind)


def svg(item, content, box='0 0 100 100'):
    title = html.escape(f"Dili {item['id']} · {item['name']}")
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{box}" role="img" aria-labelledby="title"><title id="title">{title}</title>{content}</svg>\n'


def wordmark(ink):
    # Outlined custom letters keep the English name independent of installed fonts.
    return f'<g fill="{ink}" fill-rule="evenodd"><path d="M148 27h9v45h-9v-3c-3 3-6 4-10 4-9 0-16-7-16-17s7-17 16-17c4 0 7 1 10 4V27Zm0 29c0-5-3-9-8-9s-9 4-9 9 4 9 9 9 8-4 8-9Z"/><rect x="165" y="40" width="9" height="32" rx="2"/><circle cx="169.5" cy="29" r="5.5"/><path d="M182 24h9v35c0 4 2 5 6 5v8c-11 1-15-4-15-13V24Z"/><rect x="205" y="40" width="9" height="32" rx="2"/><circle cx="209.5" cy="29" r="5.5"/></g>'


def generate_assets():
    for folder in ['icons', 'icons-dark', 'mono', 'dark', 'png']:
        (ROOT / folder).mkdir(exist_ok=True)
    for item in ITEMS:
        ident = item['id']
        (ROOT / 'icons' / f'{ident}.svg').write_text(svg(item, mark(item)))
        (ROOT / 'icons-dark' / f'{ident}.svg').write_text(svg(item, mark(item, dark=True)))
        (ROOT / 'mono' / f'{ident}.svg').write_text(svg(item, mark(item, mono=True)))
        for dark in [False, True]:
            ink = '#f2f3e9' if dark else '#26332c'
            muted = '#a7b6ac' if dark else '#68766c'
            content = f'<g transform="translate(3 6)">{mark(item, dark=dark)}</g>' + wordmark(ink) + f'<text x="122" y="93" font-family="sans-serif" font-size="11" fill="{muted}">嘀哩工作台</text>'
            destination = ROOT / ('dark' if dark else '') / f'{ident}.svg'
            destination.write_text(svg(item, content, '0 0 255 112'))
    (ROOT / 'concepts.json').write_text(json.dumps(ITEMS, ensure_ascii=False, indent=2) + '\n')


def generate_gallery():
    # Reuse the first-round gallery's layout and interaction implementation.
    source = (ROOT.parent / 'gallery.html').read_text()
    css = source.split('<style>')[1].split('</style>')[0]
    script = source.split('<script>')[1].split('</script>')[0]
    script = script.replace('dili.logo-concepts.2026-10', 'dili.logo-concepts.round-2.2026-10')
    script = script.replace("'Dili Logo 候选：'", "'Dili 第二轮 Logo 候选：'")
    script = script.replace("querySelectorAll('.lockup')", "querySelectorAll('.lockup,.themed-icon')")
    cards = []
    star = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1 6.2-5.5-2.9-5.5 2.9 1-6.2L3 9.6l6.2-.9Z"/></svg>'
    for item in ITEMS:
        ident, name = item['id'], item['name']
        swatches = ''.join(f'<span style="--swatch:{color}" title="{color}"></span>' for color in item['colors'])
        sources = f'src="icons/{ident}.svg" data-light="icons/{ident}.svg" data-dark="icons-dark/{ident}.svg"'
        sizes = ''.join(f'<img class="themed-icon" {sources} width="{size}" height="{size}" alt="{size} 像素">' for size in [16, 24, 32])
        cards.append(f'''<article class="card" id="concept-{ident}" data-id="{ident}">
<div class="canvas"><span class="number">{ident}</span><button class="favorite" aria-label="收藏 {ident} {name}" aria-pressed="false" title="收藏这个方案">{star}</button>
<img class="hero-icon themed-icon" {sources} width="100" height="100" alt="{ident} {name}"><p class="tagline">{item['slogan']}</p>
<div class="scale"><span>实际尺寸</span>{sizes}<img class="mono" src="mono/{ident}.svg" width="28" height="28" alt="单色版本"></div></div>
<div class="meta"><div class="eyebrow">{item['category']}<span class="swatches">{swatches}</span></div><h2>{name}<span>{item['en']}</span></h2><p>{item['description']}</p>
<details><summary>横版组合与下载</summary><img class="lockup" src="{ident}.svg" data-light="{ident}.svg" data-dark="dark/{ident}.svg" alt="{name} 横版组合"><div class="downloads"><a href="icons/{ident}.svg" download="dili-{ident}-icon.svg">图标 SVG ↗</a><a href="icons-dark/{ident}.svg" download="dili-{ident}-dark-icon.svg">深色底 SVG ↗</a><a href="png/{ident}.png" download="dili-{ident}.png">PNG ↗</a><a href="{ident}.svg" download="dili-{ident}-lockup.svg">横版 SVG ↗</a><a href="mono/{ident}.svg" download="dili-{ident}-mono.svg">单色 SVG ↗</a></div></details></div></article>''')
    page = f'''<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="light dark"><title>Dili · 第二轮 Logo 设计</title><style>{css}
.concept-note{{display:flex;align-items:center;gap:28px;border:1px solid var(--line);border-radius:14px;background:var(--surface);padding:20px 24px;margin:0 0 20px}}.concept-note img{{width:270px;max-width:100%;height:auto;background:#fffaf0;border-radius:8px;padding:10px}}.concept-note h2{{font-size:17px}}.concept-note p{{font-size:12px;color:var(--muted);margin:0}}.section-links{{display:flex;gap:18px;font-size:12px;margin-top:20px}}@media(max-width:780px){{.concept-note{{flex-direction:column;align-items:flex-start;gap:12px}}}}@media print{{.concept-note{{break-inside:avoid}}}}
</style></head><body><main>
<header class="masthead"><span class="wordmark">dili.</span><span class="edition">ROUND TWO / D + iLi</span></header>
<section class="intro"><div><p class="kicker">12 NEW DIRECTIONS · 13—24</p><h1>大 D 里面，住着一张笑脸。</h1><p class="lead">从清楚的 D + iLi 字母组合，到更自然的小表情：前 8 个沿着你的想法展开，后 4 个探索其他方向。缩小看轮廓，放大看性格。</p><div class="section-links"><a href="../gallery.html">第一轮 01—12 ↗</a><a href="overview.png">浅色总览 ↗</a><a href="overview-dark.png">深色总览 ↗</a></div></div><aside class="recommend"><strong>建议先比较</strong><a href="#concept-13">13 原始构想</a> · <a href="#concept-15">15 应用图标</a> · <a href="#concept-16">16 伙伴性格</a> · <a href="#concept-18">18 简洁线条</a><br>这一轮先选形状，配色可以交叉尝试。</aside></section>
<aside class="concept-note"><img src="anatomy.svg" alt="D 外轮廓加上 i、弯折 L 和 i，组成一张笑脸"><div><h2>字母可读性与表情自然度，是两种取舍。</h2><p>13、14、17 保留 i 的圆点和竖笔，便于读出 iLi；15、16 把字母简化成五官，更像一个伙伴。18 则用一笔连起 D 和笑线。</p></div></aside>
<nav class="toolbar" aria-label="对比工具"><div class="toolbar-left"><button class="pill" id="all" aria-pressed="true">全部 12 个</button><button class="pill" id="shortlist" aria-pressed="false">已收藏 <span id="count">0</span></button></div><button class="pill theme" id="theme" aria-pressed="false">◐ 深色背景</button></nav>
<section class="grid" aria-label="第二轮 Logo 候选">{''.join(cards)}</section><p class="empty" hidden>还没有收藏。点卡片右上角的星星，留下喜欢的方向。</p>
<aside class="selection"><div><strong id="chosen">选出 2–3 个，再细化。</strong><p>收藏只保存在当前浏览器，可以复制编号发给我。</p><div class="status" role="status" id="status"></div></div><button class="copy" id="copy">复制已选方案</button></aside>
<footer><span>SVG 矢量源文件 · 512px 透明 PNG · 深浅背景 · 单色版本</span><span>第二轮设计提案 · 尚未替换应用</span></footer>
</main><script>{script}</script></body></html>
'''
    (ROOT / 'gallery.html').write_text(page)
    anatomy = path('M17 20H36C54 20 62 31 62 50S54 80 36 80H17Z', '#51418c', 6)
    anatomy += '<text x="75" y="58" font-family="sans-serif" font-size="21" fill="#68766c">+</text>'
    anatomy += '<g transform="translate(95 0)">' + little_i(12, '#51418c') + path('M34 31V58Q34 68 43 68Q50 68 53 61', '#51418c', 5) + little_i(67, '#51418c') + '</g>'
    anatomy += '<text x="185" y="58" font-family="sans-serif" font-size="21" fill="#68766c">=</text>'
    anatomy += '<g transform="translate(213 4) scale(.9)">' + mark(ITEMS[0]) + '</g>'
    (ROOT / 'anatomy.svg').write_text(svg(ITEMS[0], anatomy, '0 0 305 100'))


def render_previews():
    import io
    import gi
    import cairo
    from PIL import Image, ImageDraw, ImageFont
    gi.require_version('Rsvg', '2.0')
    from gi.repository import Rsvg

    def render(file, size):
        handle = Rsvg.Handle.new_from_file(str(file))
        surface = cairo.ImageSurface(cairo.FORMAT_ARGB32, *size)
        rect = Rsvg.Rectangle()
        rect.x = rect.y = 0
        rect.width, rect.height = size
        handle.render_document(cairo.Context(surface), rect)
        data = io.BytesIO()
        surface.write_to_png(data)
        data.seek(0)
        return Image.open(data).convert('RGBA')

    def font(size):
        return ImageFont.truetype('/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc', size)

    def latin(size):
        return ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', size)

    for item in ITEMS:
        render(ROOT / 'icons' / f"{item['id']}.svg", (512, 512)).save(ROOT / 'png' / f"{item['id']}.png")
    for dark in [False, True]:
        bg, panel, ink, muted, line = ('#141b18', '#1d2822', '#f1f2e9', '#a6b5aa', '#35483b') if dark else ('#f3f1eb', '#fffefa', '#26332c', '#6a786d', '#dcded3')
        image = Image.new('RGB', (1800, 1700), bg)
        draw = ImageDraw.Draw(image)
        draw.text((64, 30), 'dili.', font=latin(35), fill=ink)
        draw.text((64, 97), '大 D 里面，住着一张笑脸。', font=font(48), fill=ink)
        draw.text((66, 169), '第二轮 13—24  /  前 8 个围绕 D + iLi，后 4 个探索其他方向', font=font(21), fill=muted)
        draw.text((1440, 55), 'ROUND TWO / 2026.10', font=latin(13), fill=muted)
        for i, item in enumerate(ITEMS):
            x, y = 64 + (i % 4) * 424, 237 + (i // 4) * 460
            draw.rounded_rectangle((x, y, x+400, y+434), radius=16, fill=panel, outline=line)
            draw.text((x+20, y+16), item['id'], font=latin(17), fill=muted)
            icon_folder = 'icons-dark' if dark else 'icons'
            icon = render(ROOT / icon_folder / f"{item['id']}.svg", (142, 142))
            image.paste(icon, (x+129, y+36), icon)
            slogan = item['slogan']
            width = draw.textbbox((0, 0), slogan, font=font(17))[2]
            draw.text((x+(400-width)//2, y+192), slogan, font=font(17), fill=muted)
            draw.text((x+20, y+237), '16 / 24 / 32', font=latin(12), fill=muted)
            for size, sx in [(16, 156), (24, 195), (32, 243)]:
                icon = render(ROOT / icon_folder / f"{item['id']}.svg", (size, size))
                image.paste(icon, (x+sx, y+243-size//2), icon)
            mono = render(ROOT / 'mono' / f"{item['id']}.svg", (28, 28))
            if dark:
                from PIL import ImageOps
                rgb = ImageOps.invert(mono.convert('RGB'))
                rgb.putalpha(mono.getchannel('A'))
                mono = rgb
            image.paste(mono, (x+331, y+229), mono)
            draw.line((x, y+276, x+400, y+276), fill=line)
            draw.text((x+20, y+290), item['name'], font=font(26), fill=ink)
            draw.text((x+20, y+336), item['en'].upper(), font=latin(12), fill=muted)
            draw.text((x+20, y+379), item['category'], font=font(15), fill=muted)
            for n, color in enumerate(item['colors']):
                draw.ellipse((x+323+n*17, y+391, x+333+n*17, y+401), fill=color, outline=line)
        draw.text((66, 1646), '先看轮廓，再看表情  ·  SVG / PNG / 单色 / 横版组合  ·  用编号选择', font=font(17), fill=muted)
        image.save(ROOT / ('overview-dark.png' if dark else 'overview.png'), optimize=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--render', action='store_true', help='also render PNG icons and overview sheets')
    args = parser.parse_args()
    generate_assets()
    generate_gallery()
    if args.render:
        render_previews()
    print(f'Generated 12 Dili concepts in {ROOT}')
