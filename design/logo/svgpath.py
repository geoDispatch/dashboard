# Minimal SVG path tools: tokenise, convert to absolute, split subpaths,
# bounding boxes from on-curve points AND control points, and affine transform.
import re

TOK = re.compile(r'[MmLlHhVvCcSsQqTtAaZz]|-?(?:\d+\.\d*|\.\d+|\d+)(?:[eE][-+]?\d+)?')
ARGC = dict(M=2, L=2, H=1, V=1, C=6, S=4, Q=4, T=2, A=7, Z=0)

def parse(d):
    toks = TOK.findall(d)
    i, cmd, out = 0, None, []
    while i < len(toks):
        t = toks[i]
        if re.match(r'[A-Za-z]', t):
            cmd = t; i += 1
            if cmd in 'Zz':
                out.append(('Z', [])); continue
        n = ARGC[cmd.upper()]
        args = [float(x) for x in toks[i:i+n]]; i += n
        out.append((cmd, args))
        if cmd == 'M': cmd = 'L'
        elif cmd == 'm': cmd = 'l'
    return out

def absolute(segs):
    """All commands to absolute M/L/C/Z (H,V,S,Q,T expanded; no arcs expected)."""
    x = y = sx = sy = 0.0; lastc = None; res = []
    for cmd, a in segs:
        rel = cmd.islower(); C = cmd.upper()
        if C == 'M':
            x, y = (x + a[0], y + a[1]) if rel else (a[0], a[1]); sx, sy = x, y
            res.append(('M', [x, y])); lastc = None
        elif C == 'L':
            x, y = (x + a[0], y + a[1]) if rel else (a[0], a[1]); res.append(('L', [x, y])); lastc = None
        elif C == 'H':
            x = x + a[0] if rel else a[0]; res.append(('L', [x, y])); lastc = None
        elif C == 'V':
            y = y + a[0] if rel else a[0]; res.append(('L', [x, y])); lastc = None
        elif C == 'C':
            p = [(x + a[k] if rel else a[k]) if k % 2 == 0 else (y + a[k] if rel else a[k]) for k in range(6)]
            res.append(('C', p)); x, y = p[4], p[5]; lastc = (p[2], p[3])
        elif C == 'S':
            c1 = (2*x - lastc[0], 2*y - lastc[1]) if lastc else (x, y)
            p = [(x + a[k] if rel else a[k]) if k % 2 == 0 else (y + a[k] if rel else a[k]) for k in range(4)]
            res.append(('C', [c1[0], c1[1]] + p)); x, y = p[2], p[3]; lastc = (p[0], p[1])
        elif C == 'Z':
            res.append(('Z', [])); x, y = sx, sy; lastc = None
        else:
            raise ValueError('unsupported ' + cmd)
    return res

def subpaths(segs):
    cur, out = [], []
    for s in segs:
        if s[0] == 'M' and cur:
            out.append(cur); cur = []
        cur.append(s)
    if cur: out.append(cur)
    return out

def points(segs, on_curve_only=False):
    for cmd, a in segs:
        if cmd in ('M', 'L'): yield a[0], a[1]
        elif cmd == 'C':
            if not on_curve_only:
                yield a[0], a[1]; yield a[2], a[3]
            yield a[4], a[5]

def bbox(segs, on_curve_only=False):
    pts = list(points(segs, on_curve_only))
    xs = [p[0] for p in pts]; ys = [p[1] for p in pts]
    return min(xs), min(ys), max(xs), max(ys)

def transform(segs, sx, sy, tx, ty):
    out = []
    for cmd, a in segs:
        b = [(v * sx + tx) if k % 2 == 0 else (v * sy + ty) for k, v in enumerate(a)]
        out.append((cmd, b))
    return out

def fmt(n):
    s = ('%.3f' % n).rstrip('0').rstrip('.')
    return '0' if s in ('-0', '') else s

def to_d(segs):
    parts = []
    for cmd, a in segs:
        parts.append(cmd + ' '.join(fmt(v) for v in a) if a else cmd)
    return ''.join(parts)
