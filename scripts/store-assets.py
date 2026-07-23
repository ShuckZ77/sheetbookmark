"""Store listing assets, at the EXACT sizes the stores demand:
  - screenshots 1280x800 (Chrome: mandatory >=1; Edge: optional)  -> shot-1..4.html
  - small promo tile 440x280 (Chrome: MANDATORY)                  -> tile-small.html
  - marquee tile 1400x560 (Chrome: optional)                      -> tile-marquee.html
Render:  python3 scripts/store-assets.py && see private/store-assets/render.sh
"""
import os
T = os.path.join(os.path.dirname(__file__), '..', 'private', 'store-assets')
os.makedirs(T, exist_ok=True)

CSS = """
*{box-sizing:border-box;margin:0;font-family:system-ui,-apple-system,'Segoe UI',sans-serif}
body{width:1280px;height:800px;overflow:hidden;position:relative;color:#1a2d4f;
  background:linear-gradient(rgba(26,45,79,.05) 1px,transparent 1px),linear-gradient(90deg,rgba(26,45,79,.05) 1px,transparent 1px),#fdfcf9;
  background-size:32px 32px;padding:56px 40px 88px;display:flex;gap:28px;align-items:stretch}
.win{background:#fff;border:1px solid rgba(26,45,79,.16);border-radius:12px;box-shadow:0 24px 60px rgba(26,45,79,.14);overflow:hidden;position:relative}
.browser{flex:1.15}
.sheetwin{flex:1}
/* ---- browser chrome ---- */
.tabbar{display:flex;align-items:center;gap:10px;background:#dee3ea;padding:8px 12px 0}
.ff .tabbar{background:#e8e6f0}
.lights{display:flex;gap:6px;margin-bottom:8px}
.lights i{width:11px;height:11px;border-radius:50%}
.lights i:nth-child(1){background:#ff5f57}.lights i:nth-child(2){background:#febc2e}.lights i:nth-child(3){background:#28c840}
.tab{background:#fff;border-radius:9px 9px 0 0;padding:7px 16px;font-size:12px;font-weight:600;display:flex;gap:8px;align-items:center}
.ff .tab{border-radius:8px;margin-bottom:6px}
.tab .fav{width:13px;height:13px;border-radius:3px;background:#1a73e8}
.ff .tab .fav{background:#ff7139}
.blabel{margin-left:auto;font-size:11px;font-weight:700;color:#51617d;letter-spacing:.04em;padding-bottom:8px}
.urlrow{display:flex;align-items:center;gap:10px;background:#fff;padding:8px 12px;border-bottom:1px solid rgba(26,45,79,.1)}
.omni{flex:1;display:flex;align-items:center;gap:8px;background:#f0f2f6;border-radius:99px;padding:7px 14px;font-size:12.5px;color:#51617d}
.ff .omni{border-radius:8px}
.lock{width:11px;height:11px;border:1.6px solid #8492a8;border-radius:3px;position:relative}
.lock:before{content:'';position:absolute;top:-5px;left:1px;width:5px;height:5px;border:1.6px solid #8492a8;border-bottom:none;border-radius:4px 4px 0 0}
.star{width:20px;height:20px;margin-left:auto}
.star svg{width:100%;height:100%}
.exticon{width:22px;height:22px;position:relative}
.exticon svg{width:100%;height:100%}
.avatar{width:22px;height:22px;border-radius:50%;background:linear-gradient(135deg,#1d4ed8,#047857)}
/* ---- page ---- */
.page{padding:26px 30px;background:#fff;height:100%}
.page h1{font-size:21px;letter-spacing:-.01em;margin-bottom:6px}
.page .byline{font-size:11.5px;color:#8492a8;margin-bottom:18px}
.bar{height:9px;border-radius:5px;background:#e8ecf2;margin-bottom:9px}
.bar.w1{width:96%}.bar.w2{width:88%}.bar.w3{width:92%}.bar.w4{width:60%}
.hl{display:inline;background:rgba(4,120,87,.18);border-radius:3px;padding:1px 2px;font-size:13px;line-height:1.7;color:#1a2d4f}
.para{font-size:13px;line-height:1.7;color:#51617d;margin-bottom:14px}
/* ---- bubble ---- */
.bubble{position:absolute;top:74px;right:66px;background:#fff;border:1px solid rgba(26,45,79,.14);border-radius:10px;box-shadow:0 10px 26px rgba(26,45,79,.18);padding:10px 14px;font-size:12.5px;font-weight:600;z-index:6}
.bubble b{color:#047857}
/* ---- popup overlay ---- */
.popup{position:absolute;top:46px;right:14px;width:308px;background:#fdfcf9;border:1px solid rgba(26,45,79,.18);border-radius:13px;box-shadow:0 22px 54px rgba(26,45,79,.26);z-index:8;overflow:hidden;font-size:12px}
.p-bar{display:flex;align-items:center;gap:8px;padding:9px 12px;border-bottom:1px solid rgba(26,45,79,.1);background:#fff}
.p-bar .mark{width:18px;height:18px}
.p-title{font-weight:700;font-size:12px}
.p-sub{color:#8492a8;font-size:10px}
.p-body{padding:10px}
.p-save{width:100%;background:linear-gradient(180deg,#059669,#047857);color:#fff;border:none;border-radius:8px;padding:8px;font-weight:650;font-size:12px;text-align:center}
.p-save.saved{background:#fff;color:#047857;border:1px solid #047857}
.p-note{margin-top:7px;background:#f4f6fa;border:1px solid rgba(26,45,79,.12);border-radius:8px;padding:6px 9px;font-size:10.5px;color:#1a2d4f;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.p-note.empty{color:#8492a8}
.prow{display:flex;align-items:center;gap:8px;padding:6px 4px;border-radius:8px}
.prow.fresh{background:rgba(4,120,87,.1)}
.prow .m{width:22px;height:22px;border-radius:6px;color:#fff;font-size:10px;font-weight:700;display:grid;place-items:center}
.prow .tt{font-weight:600;font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.prow .mm{font-size:9.5px;color:#8492a8;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.prow .pen{margin-left:auto;flex:none;width:20px;height:20px;border-radius:6px;background:#eaf0fd;color:#1d4ed8;font-size:10px;display:grid;place-items:center}
.prow .pen.h{background:rgba(4,120,87,.12);color:#047857}
.p-list{margin-top:8px}
/* ---- sheet window ---- */
.s-title{display:flex;align-items:center;gap:9px;padding:10px 14px;border-bottom:1px solid rgba(26,45,79,.1);font-size:12.5px;font-weight:650}
.s-title .mark{width:16px;height:16px}
.s-title span.dim{color:#8492a8;font-weight:450;font-size:11px}
.s-toolbar{display:flex;gap:6px;padding:6px 14px;border-bottom:1px solid rgba(26,45,79,.08)}
.s-toolbar i{width:16px;height:16px;border-radius:4px;background:#eef1f6}
.collette{display:flex;border-bottom:1px solid rgba(26,45,79,.14);background:#f7f9fc;font-size:10px;color:#8492a8}
.collette div{padding:4px 0;text-align:center;border-right:1px solid rgba(26,45,79,.08);font-weight:600}
.c0{width:34px}.c1{width:221px}.c2{width:211px}.c3{flex:1}
table.sheet{border-collapse:collapse;width:100%;font-size:11.5px}
table.sheet td,table.sheet th{border-right:1px solid rgba(26,45,79,.08);border-bottom:1px solid rgba(26,45,79,.08);padding:7px 10px;text-align:left;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
table.sheet th{background:#eaf0fd;color:#1d4ed8;font-size:10.5px}
td.rn,th.rn{width:34px;text-align:center;color:#8492a8;background:#f7f9fc;font-size:10px}
td.tt{font-weight:600;max-width:200px}
td.nn{color:#51617d;font-style:italic;max-width:190px}
tr.landed td{background:rgba(4,120,87,.14)}
tr.landed td.rn{background:rgba(4,120,87,.2)}
.s-tabs{position:absolute;bottom:0;left:0;right:0;display:flex;gap:2px;background:#f0f3f8;border-top:1px solid rgba(26,45,79,.1);padding:5px 10px 6px;font-size:10.5px}
.s-tabs span{padding:4px 12px;border-radius:6px;color:#8492a8}
.s-tabs .on{background:#fff;color:#047857;font-weight:700;border:1px solid rgba(26,45,79,.12)}
/* ---- caption + cursor ---- */
.caption{position:absolute;left:50%;bottom:26px;transform:translateX(-50%);background:#1a2d4f;color:#fff;font-size:14.5px;font-weight:600;padding:9px 22px;border-radius:99px;box-shadow:0 10px 30px rgba(26,45,79,.3);letter-spacing:.01em}
.caption b{color:#6ee7b7}
.cursor{position:absolute;z-index:20;width:20px;filter:drop-shadow(0 2px 3px rgba(0,0,0,.3))}
.ripple{position:absolute;z-index:19;width:34px;height:34px;border-radius:50%;border:3px solid rgba(29,78,216,.55)}
"""

MARK = '<svg class="mark" viewBox="0 0 48 48"><path fill="#047857" d="M13 4h22a2.5 2.5 0 0 1 2.5 2.5V44l-13.5-9L10.5 44V6.5A2.5 2.5 0 0 1 13 4z"/><g fill="#fdfcf9"><rect x="16.5" y="10" width="6.5" height="6.5" rx="1.2"/><rect x="25.5" y="10" width="6.5" height="6.5" rx="1.2"/><rect x="16.5" y="19" width="6.5" height="6.5" rx="1.2"/><rect x="25.5" y="19" width="6.5" height="6.5" rx="1.2"/></g></svg>'
STAR_OUT = '<svg viewBox="0 0 24 24" fill="none" stroke="#51617d" stroke-width="1.8" stroke-linejoin="round"><path d="M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.8-5.2-2.8-5.2 2.8 1-5.8-4.3-4.1 5.9-.8z"/></svg>'
STAR_FILL = '<svg viewBox="0 0 24 24" fill="#1a73e8" stroke="#1a73e8" stroke-width="1.8" stroke-linejoin="round"><path d="M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.8-5.2-2.8-5.2 2.8 1-5.8-4.3-4.1 5.9-.8z"/></svg>'
CURSOR = '<svg viewBox="0 0 24 24"><path fill="#fff" stroke="#1a2d4f" stroke-width="1.4" d="M5 3l14 11-6.5.8L15 21l-3-1.2-2.4-6L5 17z"/></svg>'

def popup(fresh=False, saved=False, note_text=None, firefox=False):
    note = f'<div class="p-note">{note_text}</div>' if note_text else '<div class="p-note empty">Add a note…</div>'
    rows = ''
    if fresh or firefox:
        cls = 'prow fresh' if fresh else 'prow'
        rows += f'<div class="{cls}"><span class="m" style="background:#0e7490">M</span><span><div class="tt">Model Context Protocol docs</div><div class="mm">modelcontextprotocol.io · Chrome — MacBook · now</div></span><span class="pen h">✎</span></div>'
    rows += '<div class="prow"><span class="m" style="background:#7c3aed">T</span><span><div class="tt">The Verge — AI newsletter</div><div class="mm">theverge.com · Firefox — Home · 1d</div></span><span class="pen">✎</span></div>'
    rows += '<div class="prow"><span class="m" style="background:#0f766e">P</span><span><div class="tt">Perfect dal tadka</div><div class="mm">ranveerbrar.com · Chrome — MacBook · 3d</div></span><span class="pen h">✎</span></div>'
    savecls, savetxt = ('p-save saved', '✓ Already saved') if saved else ('p-save', 'Save this tab')
    sub = 'Firefox — Home · macOS' if firefox else 'Chrome — MacBook · macOS'
    return f'''<div class="popup">{'' if True else ''}
      <div class="p-bar">{MARK}<span><div class="p-title">SheetBookmark</div><div class="p-sub">{sub}</div></span></div>
      <div class="p-body"><div class="{savecls}">{savetxt}</div>{note}<div class="p-list">{rows}</div></div></div>'''

def sheet(landed=False, settled=False):
    newrow = ''
    if landed or settled:
        cls = 'landed' if landed else ''
        newrow = f'<tr class="{cls}"><td class="rn">2</td><td class="tt">Model Context Protocol docs</td><td class="nn">“resources expose data to LLMs…”</td><td>now</td></tr>'
    return f'''<div class="win sheetwin">
      <div class="s-title">{MARK} My SheetBookmark Collection <span class="dim">— Google Sheets</span></div>
      <div class="s-toolbar"><i></i><i></i><i></i><i></i><i></i><i></i></div>
      <div class="collette"><div class="c0"></div><div class="c1">A</div><div class="c2">B</div><div class="c3">C</div></div>
      <table class="sheet">
        <tr><td class="rn">1</td><th style="max-width:200px">title</th><th style="max-width:190px">note</th><th>saved</th></tr>
        {newrow}
        <tr><td class="rn">{3 if (landed or settled) else 2}</td><td class="tt">The Verge — AI newsletter</td><td class="nn"></td><td>2 h ago</td></tr>
        <tr><td class="rn">{4 if (landed or settled) else 3}</td><td class="tt">Perfect dal tadka</td><td class="nn">double the ghee</td><td>yesterday</td></tr>
        <tr><td class="rn">{5 if (landed or settled) else 4}</td><td class="tt">Bugzilla #1635344</td><td class="nn">the Firefox OAuth saga</td><td>Jul 20</td></tr>
      </table>
      <div class="s-tabs"><span class="on">Chrome — MacBook</span><span>Firefox — Home</span><span>Edge — Office</span></div>
    </div>'''

def browser(firefox=False, starred=False, bubble=False, show_popup=None, cursor=None, ripple=None):
    star = STAR_FILL if starred else STAR_OUT
    label = 'FIREFOX' if firefox else 'CHROME'
    cur = f'<div class="cursor" style="left:{cursor[0]}px;top:{cursor[1]}px">{CURSOR}</div>' if cursor else ''
    rip = f'<div class="ripple" style="left:{ripple[0]}px;top:{ripple[1]}px"></div>' if ripple else ''
    bub = '<div class="bubble">Bookmark added <b>✓ syncing…</b></div>' if bubble else ''
    return f'''<div class="win browser {'ff' if firefox else ''}">
      <div class="tabbar"><div class="lights"><i></i><i></i><i></i></div>
        <div class="tab"><span class="fav"></span> Model Context Protocol — Docs</div>
        <div class="blabel">{label}</div></div>
      <div class="urlrow"><div class="omni"><span class="lock"></span> modelcontextprotocol.io/docs <span class="star">{star}</span></div>
        <span class="exticon">{MARK}</span><span class="avatar"></span></div>
      <div class="page">
        <h1>Model Context Protocol — Documentation</h1>
        <div class="byline">modelcontextprotocol.io · 9 min read</div>
        <div class="bar w1"></div><div class="bar w2"></div><div class="bar w4"></div>
        <p class="para" style="margin-top:16px"><span class="hl">“Resources expose data to LLMs — files, database records, live system data…”</span></p>
        <div class="bar w3"></div><div class="bar w1"></div><div class="bar w2"></div><div class="bar w4"></div>
        <div class="bar w2" style="margin-top:14px"></div><div class="bar w3"></div><div class="bar w1"></div>
      </div>
      {bub}{show_popup or ''}{cur}{rip}
    </div>'''

def frame(name, caption, **kw):
    sheet_kw = {k: kw.pop(k) for k in ('landed','settled') if k in kw}
    html = f'<!doctype html><html><head><meta charset="utf-8"><style>{CSS}</style></head><body>'
    html += browser(**kw) + sheet(**sheet_kw)
    html += f'<div class="caption">{caption}</div></body></html>'
    open(f'{T}/{name}.html','w').write(html)

NOTE = '“Resources expose data to LLMs — files, database recor…'
star_xy = (521, 92); rip_xy = (513, 82)

frame('shot-1', 'Bookmark like you always do — <b>Ctrl+D</b> or the star', cursor=(505,108))
frame('_skip-click', 'Bookmark like you always do — <b>Ctrl+D</b> or the star', starred=True, bubble=True, cursor=star_xy, ripple=rip_xy)
frame('shot-2', '…lands in <b>your own Google Sheet</b>, in seconds', starred=True, bubble=True, landed=True)
frame('shot-3', 'With your highlighted text as <b>the note</b>', starred=True, settled=True, show_popup=popup(fresh=True, saved=True, note_text=NOTE), cursor=(578,84))
frame('_skip-settle', 'Search &amp; edit notes from <b>any browser</b>', starred=True, settled=True, show_popup=popup(fresh=False, saved=True, note_text=None, firefox=False))
frame('shot-4', '<b>One sheet. Every browser.</b>', firefox=True, settled=True, show_popup=popup(firefox=True, saved=False))
frame('_skip-hold', '<b>One sheet. Every browser.</b> — SheetBookmark', firefox=True, settled=True, show_popup=popup(firefox=True, saved=False))
print('frames written')


TILE_CSS = """
*{box-sizing:border-box;margin:0;font-family:system-ui,-apple-system,'Segoe UI',sans-serif}
body{overflow:hidden;color:#1a2d4f;display:flex;align-items:center;justify-content:center;gap:26px;
  background:linear-gradient(rgba(26,45,79,.05) 1px,transparent 1px),linear-gradient(90deg,rgba(26,45,79,.05) 1px,transparent 1px),#fdfcf9;
  background-size:26px 26px}
.mark{color:#047857}
h1{font-family:"Iowan Old Style","Palatino Linotype",Palatino,Georgia,serif;letter-spacing:-.01em}
.tag{color:#51617d}
.tag b{color:#047857}
"""

def tile(name, w, h, marksize, h1size, tagsize, tagline):
    html = f"""<!doctype html><html><head><meta charset="utf-8"><style>{TILE_CSS}
    body{{width:{w}px;height:{h}px}}
    .mark{{width:{marksize}px;height:{marksize}px}}
    h1{{font-size:{h1size}px}} .tag{{font-size:{tagsize}px;margin-top:6px}}</style></head><body>
    {MARK.replace('class="mark"','class="mark" style="width:'+str(marksize)+'px;height:'+str(marksize)+'px"')}
    <div><h1>SheetBookmark</h1><div class="tag">Every bookmark, from every browser,<br>in <b>a Google Sheet you own</b></div></div>
    </body></html>"""
    open(f'{T}/{name}.html','w').write(html)

tile('tile-small', 440, 280, 84, 30, 14, '')
tile('tile-marquee', 1400, 560, 170, 64, 27, '')

open(f'{T}/render.sh','w').write("""#!/bin/sh
# Renders every store asset at exact store dimensions. Run from repo root.
C="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
A="private/store-assets"
for s in shot-1 shot-2 shot-3 shot-4; do
  "$C" --headless --disable-gpu --hide-scrollbars --virtual-time-budget=1500 \
       --window-size=1280,800 --screenshot="$A/$s.png" "file://$PWD/$A/$s.html" >/dev/null 2>&1
done
"$C" --headless --disable-gpu --hide-scrollbars --virtual-time-budget=1000 --window-size=440,280  --screenshot="$A/tile-small.png"   "file://$PWD/$A/tile-small.html"   >/dev/null 2>&1
"$C" --headless --disable-gpu --hide-scrollbars --virtual-time-budget=1000 --window-size=1400,560 --screenshot="$A/tile-marquee.png" "file://$PWD/$A/tile-marquee.html" >/dev/null 2>&1
echo "rendered:"; for f in shot-1 shot-2 shot-3 shot-4 tile-small tile-marquee; do sips -g pixelWidth -g pixelHeight "$A/$f.png" | tr '\n' ' '; echo; done
""")
os.chmod(f'{T}/render.sh', 0o755)
print('generator extended')
