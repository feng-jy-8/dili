"""Generate round-three vector concepts; add --render for PNG exports.

SVG/HTML generation uses the standard library. Rendering requires the same
system Rsvg, cairo, Pillow and fonts as round-2/generate.py.
"""
import argparse
import importlib.util
import io
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location('round_two', ROOT.parent / 'round-2/generate.py')
previous = importlib.util.module_from_spec(spec)
spec.loader.exec_module(previous)
path, circle, svg, wordmark = previous.path, previous.circle, previous.svg, previous.wordmark

ITEMS = [
    dict(id='25', name='字母建筑', en='Letter Architecture', category='字母融合 · 结构',
         description='大 D 构成外部框架，内部保留清楚的 i、L、i，统一直线和圆角，像三个并列的工作区。',
         slogan='把名字，搭成一个空间。', colors=['#29495d', '#f4f0df', '#eca978'], kind='architecture'),
    dict(id='26', name='刻进 D 里', en='Carved Monogram', category='字母融合 · 负空间',
         description='完整的 D 色块里挖出 iLi，形成像印章一样的标记；统一字母基线，不再借用五官。',
         slogan='一个轮廓，装下整个名字。', colors=['#845047', '#fff1dc', '#c6aa89'], kind='carved'),
    dict(id='27', name='拼写 D', en='Built from Letters', category='字母融合 · 模块',
         description='左边的 i、中间的 L 和右侧半圆共同组成 D。字母参与构造外形，避免在 D 中再塞一套小字。',
         slogan='各自成形，合而成名。', colors=['#314956', '#d88a5e', '#a3c7b7'], kind='assembled'),
    dict(id='28', name='回廊', en='Inner Passage', category='字母融合 · 路径',
         description='一条 L 形路径穿入几何 D，旁边的两个短竖块暗示 i。像工作台的分栏，也像可走进去的空间。',
         slogan='进入工作，有路可循。', colors=['#e8b952', '#323c4c', '#fff2d1'], kind='corridor'),
    dict(id='29', name='折带', en='Folded Continuity', category='轮廓探索 · 折叠',
         description='两段宽折带在转角处拼出有厚度的 D。保留明确折面，把上下文延续转化为结构。',
         slogan='转个方向，接着向前。', colors=['#5d4d91', '#b4a0d9', '#efb77f'], kind='ribbon'),
    dict(id='30', name='相扣', en='Linked Work', category='轮廓探索 · 连结',
         description='一个竖向 L 与一条圆弧相扣，构成精简 D。直线和曲线分别保留自己的颜色，表达独立与连接。',
         slogan='独立工作，彼此相连。', colors=['#2d5d86', '#e68c70', '#e8e8d9'], kind='linked'),
    dict(id='31', name='像素门', en='Pixel Gateway', category='轮廓探索 · 网格',
         description='在粗网格上构造 D，内部的留白是一扇门；小色块像一次刚刚抵达的输入，偏开发工具气质。',
         slogan='给每一次输入，一个入口。', colors=['#255a4f', '#c0d9a1', '#eed9a2'], kind='pixel'),
    dict(id='32', name='双轨 D', en='Parallel Context', category='轮廓探索 · 双轨',
         description='两条等宽轨道沿 D 形并行，在左侧错开收口。保留极少笔画，表达会话与上下文同步向前。',
         slogan='并行推进，始终相随。', colors=['#305d68', '#efaa79', '#c1dfd6'], kind='tracks'),
    dict(id='33', name='交汇', en='Meeting Point', category='抽象符号 · 协作',
         description='两个向内靠近的半圆，中央由一枚方块承接。图形指向共同任务，不依赖字母或表情。',
         slogan='把不同能力，汇到一起。', colors=['#9e5365', '#e7a171', '#5d476e'], kind='meeting'),
    dict(id='34', name='书签接力', en='Context Bookmark', category='抽象符号 · 交接',
         description='两枚方向相反的书签错位交叠；一枚留下位置，一枚继续往前，呼应会话 Fork 和任务交接。',
         slogan='记住这里，继续下一步。', colors=['#4b527e', '#a7bba4', '#efc690'], kind='bookmarks'),
    dict(id='35', name='四向工作', en='Shared Centre', category='抽象符号 · 组织',
         description='四枚向中心收拢的角块，留下一个清楚的菱形空隙。强调多个会话围绕同一个任务组织。',
         slogan='各有方向，共同推进。', colors=['#2b6661', '#db925d', '#a7c0b2'], kind='centre'),
    dict(id='36', name='嘀哩节拍', en='Dili Rhythm', category='抽象符号 · 节奏',
         description='三枚高低不同的圆角竖块组成一个斜向节拍，呼应名字的读音；颜色和比例承担识别，不加表情。',
         slogan='把想法，推进一个节拍。', colors=['#b75c46', '#e8ac70', '#6a5054'], kind='rhythm'),
]


def rect(x, y, w, h, color, r=0):
    return f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{r}" fill="{color}"/>'


def mark(item, mono=False, dark=False):
    a, b, c = item['colors']
    k = item['kind']
    if dark:
        a = dict(architecture='#b6d6e4', tracks='#a6d6d0', linked='#8cb7de',
                 carved='#b57a6d', assembled='#adc9d6', pixel='#82b7a3',
                 ribbon='#a58bcf', meeting='#d78ca2', bookmarks='#aaa7d3',
                 centre='#92bcb1', rhythm='#eaa184').get(k, a)
        if k == 'rhythm':
            c = '#c69aaf'
    if mono:
        a, b, c = '#252c29', '#ffffff', '#252c29'
    outer = 'M16 13H47C74 13 88 27 88 50S74 87 47 87H16Z'
    if k == 'architecture':
        return path(outer, a, 6) + circle(31, 33, 3.1, a) + rect(28, 43, 6, 25, a, 2) + path('M45 31V68H58', a, 6) + circle(68, 33, 3.1, a) + rect(65, 43, 6, 25, a, 2)
    if k == 'carved':
        # The letter cutouts are real transparency, not a painted background.
        holes = circle(32, 34, 3.5, '#000') + rect(28.5, 44, 7, 23, '#000', 1.5) + path('M47 31V67H60', '#000', 7) + circle(70, 34, 3.5, '#000') + rect(66.5, 44, 7, 23, '#000', 1.5)
        return f'<defs><mask id="letters" maskUnits="userSpaceOnUse" x="0" y="0" width="100" height="100">{rect(0,0,100,100,"#fff")}{holes}</mask></defs><g mask="url(#letters)">{path(outer,a)}</g>'
    if k == 'assembled':
        return rect(14, 31, 12, 54, a, 3) + circle(20, 19, 6, a) + path('M36 15H48V73H61V85H36Z', b if not mono else a) + path('M58 15C77 17 87 30 87 50S77 82 67 84V70C73 66 75 59 75 50S73 34 58 29Z', c if not mono else a)
    if k == 'corridor':
        return path(outer, a) + path('M34 31V69H66', b, 7) + rect(47, 32, 7, 7, b, 1) + rect(47, 46, 7, 13, b, 1) + rect(65, 32, 7, 7, b, 1) + rect(65, 46, 7, 13, b, 1)
    if k == 'ribbon':
        if mono:
            return path('M16 15H54L85 43V61L57 84H16ZM32 31V68H51L69 52L47 31Z', a).replace('/>', ' fill-rule="evenodd"/>')
        return path('M16 15H54L85 43V61L53 31H32V84H16Z', a) + path('M39 84H57L85 61V43L51 68H39Z', b if not mono else a) + path('M16 84H39V68L32 62V84Z', c if not mono else a)
    if k == 'linked':
        return path('M26 19V75H55', a, 13) + path('M45 25H54C73 25 84 35 84 50S73 75 62 75', b if not mono else a, 13)
    if k == 'pixel':
        return path('M14 14H62V26H76V38H87V62H76V75H62V87H14V14ZM29 29V72H56V61H67V40H56V29Z', a).replace('/>', ' fill-rule="evenodd"/>') + rect(37, 37, 11, 11, b if not mono else a, 1)
    if k == 'tracks':
        return path('M17 68V16H47C73 16 86 29 86 50S73 84 47 84H17', a, 6) + path('M31 58V30H47C65 30 72 37 72 50S65 70 47 70H31', b if not mono else a, 6)
    if k == 'meeting':
        return path('M42 15C22 15 10 30 10 50S22 85 42 85V15Z', a) + path('M58 15C78 15 90 30 90 50S78 85 58 85V15Z', b if not mono else a) + rect(42, 42, 16, 16, c if not mono else a, 3)
    if k == 'bookmarks':
        return path('M17 14H54V77L35.5 65 17 77Z', a) + path('M46 23L64.5 35 83 23V86H46Z', b if not mono else a) + path('M46 23L54 28V77L46 72Z', c if not mono else a)
    if k == 'centre':
        content = path('M14 14H44V29L29 44H14Z', a)
        content += path('M56 14H86V44H71L56 29Z', b if not mono else a)
        content += path('M86 56V86H56V71L71 56Z', a)
        content += path('M44 86H14V56H29L44 71Z', c if not mono else a)
        return '<g transform="rotate(-8 50 50)">' + content + '</g>'
    if k == 'rhythm':
        return '<g transform="rotate(16 50 50)">' + rect(15, 42, 18, 40, a, 9) + rect(41, 16, 18, 66, b if not mono else a, 9) + rect(67, 28, 18, 54, c if not mono else a, 9) + '</g>'
    raise ValueError(k)


def generate():
    for folder in ['icons', 'icons-dark', 'mono', 'dark', 'png']:
        (ROOT / folder).mkdir(exist_ok=True)
    for item in ITEMS:
        ident = item['id']
        for folder, monochrome, dark in [('icons', False, False), ('icons-dark', False, True), ('mono', True, False)]:
            (ROOT / folder / f'{ident}.svg').write_text(svg(item, mark(item, monochrome, dark)))
        for dark in [False, True]:
            ink, muted = ('#f2f3e9', '#a7b6ac') if dark else ('#26332c', '#68766c')
            content = f'<g transform="translate(3 6)">{mark(item, dark=dark)}</g>' + wordmark(ink) + f'<text x="122" y="93" font-family="sans-serif" font-size="11" fill="{muted}">嘀哩工作台</text>'
            (ROOT / ('dark' if dark else '') / f'{ident}.svg').write_text(svg(item, content, '0 0 255 112'))
    (ROOT / 'concepts.json').write_text(json.dumps(ITEMS, ensure_ascii=False, indent=2) + '\n')
    gallery()


def gallery():
    source = (ROOT.parent / 'gallery.html').read_text()
    css = source.split('<style>')[1].split('</style>')[0]
    script = source.split('<script>')[1].split('</script>')[0]
    script = script.replace('dili.logo-concepts.2026-10', 'dili.logo-concepts.round-3.2026-10')
    script = script.replace("'Dili Logo 候选：'", "'Dili 第三轮 Logo 候选：'")
    script = script.replace("querySelectorAll('.lockup')", "querySelectorAll('.lockup,.themed-icon')")
    star = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1 6.2-5.5-2.9-5.5 2.9 1-6.2L3 9.6l6.2-.9Z"/></svg>'
    cards = []
    for item in ITEMS:
        ident, name = item['id'], item['name']
        sources = f'src="icons/{ident}.svg" data-light="icons/{ident}.svg" data-dark="icons-dark/{ident}.svg"'
        sizes = ''.join(f'<img class="themed-icon" {sources} width="{s}" height="{s}" alt="{s} 像素">' for s in [16, 24, 32])
        swatches = ''.join(f'<span style="--swatch:{c}" title="{c}"></span>' for c in item['colors'])
        cards.append(f'''<article class="card" id="concept-{ident}" data-id="{ident}">
<div class="canvas"><span class="number">{ident}</span><button class="favorite" aria-label="收藏 {ident} {name}" aria-pressed="false" title="收藏这个方案">{star}</button>
<img class="hero-icon themed-icon" {sources} width="100" height="100" alt="{ident} {name}"><p class="tagline">{item['slogan']}</p>
<div class="scale"><span>实际尺寸</span>{sizes}<img class="mono" src="mono/{ident}.svg" width="28" height="28" alt="单色版本"></div></div>
<div class="meta"><div class="eyebrow">{item['category']}<span class="swatches">{swatches}</span></div><h2>{name}<span>{item['en']}</span></h2><p>{item['description']}</p>
<details><summary>横版组合与下载</summary><img class="lockup" src="{ident}.svg" data-light="{ident}.svg" data-dark="dark/{ident}.svg" alt="{name} 横版组合"><div class="downloads"><a href="icons/{ident}.svg" download="dili-{ident}-icon.svg">图标 SVG ↗</a><a href="icons-dark/{ident}.svg" download="dili-{ident}-dark-icon.svg">深色底 SVG ↗</a><a href="png/{ident}.png" download="dili-{ident}.png">PNG ↗</a><a href="{ident}.svg" download="dili-{ident}-lockup.svg">横版 SVG ↗</a><a href="mono/{ident}.svg" download="dili-{ident}-mono.svg">单色 SVG ↗</a></div></details></div></article>''')
    page = f'''<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="light dark"><title>Dili · 第三轮 Logo 设计</title><style>{css}
.round-links{{display:flex;flex-wrap:wrap;gap:16px;font-size:12px;margin-top:20px}}.directions{{display:flex;flex-wrap:wrap;gap:10px;margin-bottom:20px}}.directions a{{padding:8px 14px;border:1px solid var(--line);border-radius:6px;text-decoration:none;color:var(--muted);font-size:12px}}
</style></head><body><main><header class="masthead"><span class="wordmark">dili.</span><span class="edition">ROUND THREE / LETTERS &amp; FORMS</span></header>
<section class="intro"><div><p class="kicker">12 NEW DIRECTIONS · 25—36</p><h1>让字母，长成一个标志。</h1><p class="lead">字母可以是结构，可以是留白，也可以只是一个形状的起点。这轮从 D 与 iLi 的融合开始，继续探索折带、轨道、书签和几何节拍。</p><div class="round-links"><a href="../gallery.html">第一轮 01—12 ↗</a><a href="../round-2/gallery.html">第二轮 13—24 ↗</a><a href="overview.png">浅色总览 ↗</a><a href="overview-dark.png">深色总览 ↗</a><a href="shapes.png">单色轮廓对比 ↗</a></div></div><aside class="recommend"><strong>建议先比较</strong><a href="#concept-26">26 负空间</a> · <a href="#concept-27">27 字母构形</a> · <a href="#concept-29">29 折叠</a> · <a href="#concept-35">35 几何</a><br>已选用 35 四向工作，正式配色随应用主题变化。</aside></section>
<nav class="directions" aria-label="设计方向"><a href="#concept-25">25—28 · D 与 iLi 的融合</a><a href="#concept-29">29—32 · D 的结构变化</a><a href="#concept-33">33—36 · 独立抽象符号</a></nav>
<nav class="toolbar" aria-label="对比工具"><div class="toolbar-left"><button class="pill" id="all" aria-pressed="true">全部 12 个</button><button class="pill" id="shortlist" aria-pressed="false">已收藏 <span id="count">0</span></button></div><button class="pill theme" id="theme" aria-pressed="false">◐ 深色背景</button></nav>
<section class="grid" aria-label="第三轮 Logo 候选">{''.join(cards)}</section><p class="empty" hidden>还没有收藏。点卡片右上角的星星，留下喜欢的方向。</p>
<aside class="selection"><div><strong id="chosen">选出 2–3 个，再细化。</strong><p>收藏只保存在当前浏览器，可以复制编号发给我。</p><div class="status" role="status" id="status"></div></div><button class="copy" id="copy">复制已选方案</button></aside>
<footer><span>SVG · 512px 透明 PNG · 单色 · 横版组合 · 深浅背景</span><span>35 四向工作已采用 · 此页保留原始草案</span></footer></main><script>{script}</script></body></html>\n'''
    (ROOT / 'gallery.html').write_text(page)


def render_all():
    import gi
    import cairo
    from PIL import Image, ImageDraw, ImageFont, ImageOps
    gi.require_version('Rsvg', '2.0')
    from gi.repository import Rsvg

    def render(file, size):
        handle = Rsvg.Handle.new_from_file(str(file))
        surface = cairo.ImageSurface(cairo.FORMAT_ARGB32, *size)
        viewport = Rsvg.Rectangle()
        viewport.x = viewport.y = 0
        viewport.width, viewport.height = size
        handle.render_document(cairo.Context(surface), viewport)
        output = io.BytesIO()
        surface.write_to_png(output)
        output.seek(0)
        return Image.open(output).convert('RGBA')

    def font(size):
        return ImageFont.truetype('/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc', size)

    def latin(size):
        return ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', size)

    for item in ITEMS:
        render(ROOT / 'icons' / f"{item['id']}.svg", (512, 512)).save(ROOT / 'png' / f"{item['id']}.png")
    for dark in [False, True]:
        bg, panel, ink, muted, line = ('#151d1b', '#1f2b27', '#f1f2e9', '#a8b7ae', '#37483e') if dark else ('#f3f1eb', '#fffefa', '#26332c', '#6a786d', '#dcded3')
        image = Image.new('RGB', (1800, 1700), bg)
        draw = ImageDraw.Draw(image)
        draw.text((64, 30), 'dili.', font=latin(35), fill=ink)
        draw.text((64, 97), '让字母，长成一个标志。', font=font(48), fill=ink)
        draw.text((66, 169), '第三轮 25—36  /  字母融合 · 负空间 · 折叠结构 · 抽象符号', font=font(21), fill=muted)
        draw.text((1410, 55), 'ROUND THREE / 2026.10', font=latin(13), fill=muted)
        for i, item in enumerate(ITEMS):
            x, y = 64 + (i % 4) * 424, 237 + (i // 4) * 460
            draw.rounded_rectangle((x, y, x+400, y+434), radius=16, fill=panel, outline=line)
            draw.text((x+20, y+16), item['id'], font=latin(17), fill=muted)
            folder = 'icons-dark' if dark else 'icons'
            icon = render(ROOT / folder / f"{item['id']}.svg", (148, 148))
            image.paste(icon, (x+126, y+33), icon)
            width = draw.textbbox((0, 0), item['slogan'], font=font(17))[2]
            draw.text((x+(400-width)//2, y+192), item['slogan'], font=font(17), fill=muted)
            draw.text((x+20, y+237), '16 / 24 / 32', font=latin(12), fill=muted)
            for size, sx in [(16, 156), (24, 195), (32, 243)]:
                icon = render(ROOT / folder / f"{item['id']}.svg", (size, size))
                image.paste(icon, (x+sx, y+243-size//2), icon)
            mono = render(ROOT / 'mono' / f"{item['id']}.svg", (28, 28))
            if dark:
                inverse = ImageOps.invert(mono.convert('RGB'))
                inverse.putalpha(mono.getchannel('A'))
                mono = inverse
            image.paste(mono, (x+331, y+229), mono)
            draw.line((x, y+276, x+400, y+276), fill=line)
            draw.text((x+20, y+290), item['name'], font=font(26), fill=ink)
            draw.text((x+20, y+336), item['en'].upper(), font=latin(12), fill=muted)
            draw.text((x+20, y+379), item['category'], font=font(15), fill=muted)
            for n, color in enumerate(item['colors']):
                draw.ellipse((x+323+n*17, y+391, x+333+n*17, y+401), fill=color, outline=line)
        draw.text((66, 1646), '先选形状，再定颜色  ·  SVG / PNG / 单色 / 横版组合  ·  用编号选择', font=font(17), fill=muted)
        image.save(ROOT / ('overview-dark.png' if dark else 'overview.png'), optimize=True)
    shapes = Image.new('RGB', (1800, 1180), '#fffefa')
    draw = ImageDraw.Draw(shapes)
    draw.text((64, 35), '先看轮廓。', font=font(44), fill='#26332c')
    draw.text((66, 110), '同一种颜色，比较 12 个形状。配色可以在选定后重新组合。', font=font(20), fill='#6a786d')
    for i, item in enumerate(ITEMS):
        x, y = 64 + (i % 4) * 424, 200 + (i // 4) * 310
        image = render(ROOT / 'mono' / f"{item['id']}.svg", (180, 180))
        shapes.paste(image, (x+110, y+10), image)
        label = item['id'] + '  ' + item['name']
        width = draw.textbbox((0, 0), label, font=font(23))[2]
        draw.text((x+(400-width)//2, y+215), label, font=font(23), fill='#26332c')
    shapes.save(ROOT / 'shapes.png', optimize=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--render', action='store_true')
    args = parser.parse_args()
    generate()
    if args.render:
        render_all()
    print(f'Generated round-three concepts in {ROOT}')
