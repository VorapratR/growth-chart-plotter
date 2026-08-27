import json, numpy as np
from scipy.optimize import least_squares

PCT_Z = {3:-1.8807936, 10:-1.2815516, 25:-0.6744898, 50:0.0, 75:0.6744898, 90:1.2815516, 97:1.8807936}

def lms_value(L, M, S, z):
    if abs(L) < 1e-8:
        return M*np.exp(S*z)
    return M*(1+L*S*z)**(1/L)

def fit_one_x(zmap, m_key):
    """zmap: {z_value: measured_value, ...} including the z=0 (median) entry keyed by m_key."""
    M = zmap[m_key]
    others = [(z, v) for z, v in zmap.items() if z != m_key]
    zs = np.array([z for z, v in others])
    ys = np.array([v for z, v in others])
    def resid(params):
        L, S = params
        return lms_value(L, M, S, zs) - ys
    s0 = (zmap.get(max(zmap.keys())) - zmap.get(min(zmap.keys()))) / (2*max(abs(k) for k in zmap)*M) if M else 0.1
    res = least_squares(resid, x0=[1.0, s0 if s0 > 0 else 0.1], method='lm', max_nfev=5000)
    L, S = res.x
    return L, M, S, float(np.max(np.abs(res.fun))) if len(res.fun) else 0.0

def dedup(pts):
    d = {}
    for x, v in pts:
        d[x] = v
    return sorted(d.items())

def fit_percentile_series(series_by_pct):
    """series_by_pct: {pct: [(x,val),...], ...} for pct in 3,10,25,50,75,90,97.
    Returns rows [[x,L,M,S],...] and worst residual."""
    clean = {pc: dict(dedup(pts)) for pc, pts in series_by_pct.items()}
    xs = sorted(clean[50].keys())
    rows, worst = [], 0.0
    for x in xs:
        zmap = {PCT_Z[pc]: clean[pc][x] for pc in clean if x in clean[pc]}
        if 0.0 not in zmap or len(zmap) < 4:
            continue
        L, M, S, resid = fit_one_x(zmap, 0.0)
        worst = max(worst, resid)
        rows.append([round(x, 4), round(L, 6), round(M, 6), round(S, 6)])
    return rows, worst

def fit_zscore_series(series_by_z):
    """series_by_z: {z: [(x,val),...], ...} for z in the BMI SDS set including 0."""
    clean = {z: dict(dedup(pts)) for z, pts in series_by_z.items()}
    xs = sorted(clean[0].keys())
    rows, worst = [], 0.0
    for x in xs:
        zmap = {z: clean[z][x] for z in clean if x in clean[z]}
        if 0.0 not in zmap or len(zmap) < 4:
            continue
        L, M, S, resid = fit_one_x(zmap, 0.0)
        worst = max(worst, resid)
        rows.append([round(x, 4), round(L, 6), round(M, 6), round(S, 6)])
    return rows, worst
