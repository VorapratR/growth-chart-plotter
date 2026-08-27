import fitz, numpy as np

def get_curve_points(items):
    pts = []
    for it in items:
        op = it[0]
        if op == 'l':
            p1, p2 = it[1], it[2]
            if not pts: pts.append((p1.x, p1.y))
            pts.append((p2.x, p2.y))
    return pts

def numeric_words(page):
    words = page.get_text("words")
    out = []
    for w in words:
        t = w[4].replace('\u2212','-')  # unicode minus -> ascii
        try:
            v = float(t)
        except ValueError:
            continue
        out.append((v, w[0], w[1], w[2], w[3]))
    return out

def linfit(xs, ys):
    A = np.polyfit(xs, ys, 1)
    resid = np.abs(np.polyval(A, xs) - ys).max()
    return A, resid

def cluster_rows(items, gap=15):
    """items: list of (value, x0,y0,x1,y1). Cluster into rows by y-position (gap-based)."""
    items = sorted(items, key=lambda t: t[2])
    clusters, cur = [], []
    for it in items:
        if cur and it[2] - cur[-1][2] > gap:
            clusters.append(cur); cur = []
        cur.append(it)
    if cur: clusters.append(cur)
    return clusters

def cluster_cols(items, gap=15):
    """items: list of (value, x0,y0,x1,y1). Cluster into columns by x-position (gap-based)."""
    items = sorted(items, key=lambda t: t[1])
    clusters, cur = [], []
    for it in items:
        if cur and it[1] - cur[-1][1] > gap:
            clusters.append(cur); cur = []
        cur.append(it)
    if cur: clusters.append(cur)
    return clusters

def robust_axis_fit(candidates, axis, max_resid=1.0, min_pts=3):
    """
    candidates: list of (value, x0, y0, x1, y1) tuples, pre-filtered to a
    plausible value range.
    axis='x': calibrating pixel-X as a function of value (an x-axis, e.g. age
              or height) -> cluster into ROWS (same y, varying x), fit x vs value.
    axis='y': calibrating pixel-Y as a function of value (a y-axis, e.g. cm/kg)
              -> cluster into COLUMNS (same x, varying y), fit y vs value.
    Keeps only clusters that individually fit well (real evenly-spaced axis
    ticks, not stray body text), then combines all good clusters for one
    final, more precise regression.
    Returns (A, residual, n_points_used, n_clusters_used) where A=[slope,intercept].
    """
    clusters = cluster_rows(candidates) if axis == 'x' else cluster_cols(candidates)
    good = []
    for c in clusters:
        if len(c) < min_pts:
            continue
        vals = np.array([t[0] for t in c])
        poss = np.array([(t[1]+t[3])/2 for t in c]) if axis == 'x' else np.array([(t[2]+t[4])/2 for t in c])
        if len(set(vals.tolist())) < min_pts:
            continue
        A, r = linfit(poss, vals)   # value ≈ A0*pixel + A1  (so callers invert trivially)
        if r < max_resid:
            good.append((vals, poss, r))
    if not good:
        raise ValueError("no clean axis cluster found")
    allv = np.concatenate([g[0] for g in good])
    allp = np.concatenate([g[1] for g in good])
    A, resid = linfit(allp, allv)
    return A, resid, len(allv), len(good)

def dedup_sorted(pts):
    """pts: list of (x,val) -> dedup by x, sort by x"""
    d = {}
    for x, v in pts:
        d[x] = v
    return sorted(d.items())
