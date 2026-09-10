import math, re, sys
sys.path.insert(0, '.')
from svgpath import parse, absolute, transform, to_d, fmt

SRC = __import__('os').path.join(__import__('os').path.dirname(__file__), 'source-wordmark.svg')
src = open(SRC).read()
GEO = absolute(parse(re.search(r'id="GEO" d="([^"]*)"', src).group(1)))
DIS = absolute(parse(re.search(r'id="DISPATCH" d="([^"]*)"', src).group(1)))

# ── Typographic metrics from the existing wordmark (old 178x53 units) ─────
CAP_TOP_GEO   = 6.13     # flat top of E
BASE_DIS      = 45.45    # flat baseline of D / I / P / T / H
OVER_TOP      = 5.835    # G / O overshoot
OVER_BOTTOM   = 45.746   # S / C overshoot
CAP           = 17.71
STEM_OLD      = 3.52     # the I

K = 100.0 / CAP          # new units: cap height = 100
STEM = STEM_OLD * K      # ≈ 19.88

# ── The mark ──────────────────────────────────────────────────────────────
# The circle behaves like a giant round glyph: it overshoots exactly as far as
# the O, G, S and C do, so it is optically the same height as the text block.
D = (OVER_BOTTOM - OVER_TOP) * K
R = D / 2

T = STEM                  # every ring is drawn at the wordmark's stem weight
ZONES = (1.00, 0.66, 0.33)  # the product's red / orange / green thresholds

def circle(cx, cy, r):
    return (f'M{fmt(cx - r)} {fmt(cy)}'
            f'A{fmt(r)} {fmt(r)} 0 1 0 {fmt(cx + r)} {fmt(cy)}'
            f'A{fmt(r)} {fmt(r)} 0 1 0 {fmt(cx - r)} {fmt(cy)}Z')

def person(cx, cy, rd):
    """Head + shoulders knocked out of a disc of radius rd, shoulders clipped
    by a frame circle so a rim of the disc runs under them — the person sits
    in a porthole rather than standing on the disc's edge."""
    # Proportions follow the original PNG's figure — a larger head and a
    # thinner rim than a stock avatar glyph — with the neck gap held at 0.16 of
    # the disc so head and shoulders stay separate at header size (~7px disc).
    rf = rd * 0.850                  # frame; rim of 0.15 rd under the shoulders
    head_r, head_y = rd * 0.330, -rd * 0.250
    neck = rd * 0.160
    sh_r = rd * 0.620
    sh_y = (head_y + head_r) + neck + sh_r
    # frame ∩ shoulders:  x²+y²=rf²  and  x²+(y-sh_y)²=sh_r²
    y = (rf**2 - sh_r**2 + sh_y**2) / (2 * sh_y)
    x = math.sqrt(rf**2 - y**2)
    shoulders = (f'M{fmt(cx - x)} {fmt(cy + y)}'
                 f'A{fmt(sh_r)} {fmt(sh_r)} 0 0 1 {fmt(cx + x)} {fmt(cy + y)}'
                 f'A{fmt(rf)} {fmt(rf)} 0 0 1 {fmt(cx - x)} {fmt(cy + y)}Z')
    return circle(cx, cy + head_y, head_r) + shoulders, dict(
        neck_gap=(sh_y - sh_r) - (head_y + head_r), rim=rd - rf, head_r=head_r)

def mark_path(cx, cy, r, t, with_person=True):
    rings = ''.join(circle(cx, cy, z * r) + circle(cx, cy, z * r - t) for z in ZONES[:2])
    disc_r = ZONES[2] * r
    d = rings + circle(cx, cy, disc_r)
    info = {}
    if with_person:
        p, info = person(cx, cy, disc_r)
        d += p
    return d, info

# ── Lockup geometry ───────────────────────────────────────────────────────
GAP = CAP * K * 0.5                 # mark → type: half a cap height
TEXT_X0 = D + GAP
# Place the wordmark so its round overshoot touches y = 0, like the circle.
sx = sy = K
tx = TEXT_X0 - 60.902 * K          # 60.902 = G's left overshoot, the leftmost ink
ty = -OVER_TOP * K
geo = transform(GEO, sx, sy, tx, ty)
dis = transform(DIS, sx, sy, tx, ty)
W = tx + 175.626 * K               # H's right edge
H = D

mark_d, info = mark_path(R, R, R, T)
lock = f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {fmt(W)} {fmt(H)}" width="{fmt(W)}" height="{fmt(H)}" fill="currentColor" role="img" aria-label="GeoDispatch">
  <title>GeoDispatch</title>
  <path fill-rule="evenodd" d="{mark_d}"/>
  <path d="{to_d(geo)}"/>
  <path d="{to_d(dis)}"/>
</svg>
'''

# Mark alone, square.
m_d, _ = mark_path(R, R, R, T)
mark = f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {fmt(D)} {fmt(D)}" width="{fmt(D)}" height="{fmt(D)}" fill="currentColor" role="img" aria-label="GeoDispatch">
  <title>GeoDispatch</title>
  <path fill-rule="evenodd" d="{m_d}"/>
</svg>
'''

# Small optical size: the person is dropped (it is a blot below ~24px) and the
# rings are a touch heavier so they survive a 16px favicon.
S = 64.0
sr = S / 2
s_d, _ = mark_path(sr, sr, sr, sr * 0.215, with_person=False)
small = f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {fmt(S)} {fmt(S)}" width="{fmt(S)}" height="{fmt(S)}" fill="currentColor" role="img" aria-label="GeoDispatch">
  <title>GeoDispatch</title>
  <path fill-rule="evenodd" d="{s_d}"/>
</svg>
'''

# Favicon: the small mark knocked out of a #001DF3 tile — legible on light and
# dark browser chrome alike, and the same blue the dark-mode frame uses.
F = 64.0
fr = 20.0
f_d, _ = mark_path(F / 2, F / 2, fr, fr * 0.215, with_person=False)
favicon = f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {fmt(F)} {fmt(F)}">
  <title>GeoDispatch</title>
  <rect width="{fmt(F)}" height="{fmt(F)}" rx="14" fill="#001DF3"/>
  <path fill="#ffffff" fill-rule="evenodd" d="{f_d}"/>
</svg>
'''

open('geodispatch-lockup.svg', 'w').write(lock)
open('geodispatch-mark.svg', 'w').write(mark)
open('geodispatch-mark-small.svg', 'w').write(small)
open('favicon.svg', 'w').write(favicon)

print(f'cap=100  stem={STEM:.2f}  D={D:.2f}  R={R:.2f}  ring t={T:.2f}')
print(f'rings: outer {R:.1f}->{R-T:.1f}   middle {0.66*R:.1f}->{0.66*R-T:.1f}   disc {0.33*R:.1f}')
print(f'gaps : {R-T-0.66*R:.2f} and {0.66*R-T-0.33*R:.2f}   (ring {T:.2f})')
print('person:', {k: round(v, 2) for k, v in info.items()})
print(f'lockup viewBox {W:.1f} x {H:.1f}  (ratio {W/H:.3f})')
