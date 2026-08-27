import sys, json, fitz, numpy as np
import os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import get_curve_points, numeric_words, linfit

PCTS = [3, 10, 25, 50, 75, 90, 97]

def axis_calibration(page):
    nums = numeric_words(page)
    W = page.rect.width
    # age axis: months 0,3,6,...,24 -- appears top AND bottom, same x positions.
    # Restrict to the plot interior so cm/kg axis labels that coincidentally
    # share these same numeric values (3,6,9,12,15) don't leak in.
    age_cands = [(v, (x0+x1)/2, (y0+y1)/2) for v, x0, y0, x1, y1 in nums
                 if v in (0,3,6,9,12,15,18,21,24) and x0>60 and x1<W-60]
    xs = np.array([t[1] for t in age_cands]); vs = np.array([t[0] for t in age_cands])
    A_age, resid_age = linfit(vs, xs)   # x_px = A0*age_months + A1

    left  = [(v,(y0+y1)/2) for v,x0,y0,x1,y1 in nums if x0<50]
    right = [(v,(y0+y1)/2) for v,x0,y0,x1,y1 in nums if x0>545]
    # cm (length) and kg (weight) ranges don't overlap on this chart (45-95 vs
    # 3-15), unlike the 2-19y chart -- classify directly by value instead of
    # the fragile "largest pixel gap" heuristic used there.
    cm_leg = np.array(sorted(set([t for t in left if t[0] >= 20] + [t for t in right if t[0] >= 20])))
    kg_leg = np.array(sorted(set([t for t in left if t[0] < 20] + [t for t in right if t[0] < 20]), key=lambda t: -t[1]))
    Bc, resid_cm = linfit(cm_leg[:,1], cm_leg[:,0])
    Bk, resid_kg = linfit(kg_leg[:,1], kg_leg[:,0])

    def age_of_x(x): return (x - A_age[1]) / A_age[0]
    def cm_of_y(y): return Bc[0]*y + Bc[1]
    def kg_of_y(y): return Bk[0]*y + Bk[1]
    return age_of_x, cm_of_y, kg_of_y, dict(resid_cm=resid_cm, resid_kg=resid_kg, resid_age_px=resid_age,
                                              n_cm=len(cm_leg), n_kg=len(kg_leg), n_age=len(age_cands))

def digitize(path):
    doc = fitz.open(path)
    page = doc[0]
    age_of_x, cm_of_y, kg_of_y, calib = axis_calibration(page)
    draws = page.get_drawings()
    curves = [d for d in draws if d['type']=='s' and d.get('width') in (0.5,0.75) and len(d['items']) >= 20]
    assert len(curves) == 14, f"expected 14 curves, got {len(curves)}"

    parsed = []
    for d in curves:
        pts = get_curve_points(d['items'])
        pts.sort(key=lambda p: p[0])
        parsed.append(pts)
    npts = [len(p) for p in parsed]
    assert len(set(npts)) == 1, f"inconsistent point counts: {npts}"

    means = [np.mean([p[1] for p in c]) for c in parsed]
    order = np.argsort(means)
    length_group = [parsed[i] for i in order[:7]]
    weight_group = [parsed[i] for i in order[7:]]

    def sort_group(g, val_of_y):
        return sorted(g, key=lambda c: val_of_y(c[-1][1]))

    length_sorted = sort_group(length_group, cm_of_y)
    weight_sorted = sort_group(weight_group, kg_of_y)

    def to_series(curve, val_of_y):
        return [(round(age_of_x(x), 4), round(val_of_y(y), 4)) for x, y in curve]

    length_curves = {p: to_series(c, cm_of_y) for p, c in zip(PCTS, length_sorted)}
    weight_curves = {p: to_series(c, kg_of_y) for p, c in zip(PCTS, weight_sorted)}
    return dict(length=length_curves, weight=weight_curves), calib

if __name__ == '__main__':
    path, outpath = sys.argv[1], sys.argv[2]
    res, calib = digitize(path)
    print('calib:', calib)
    for k in ['length','weight']:
        print(k, {p: (v[0], v[-1], len(v)) for p, v in res[k].items()})
    json.dump(res, open(outpath, 'w'))
