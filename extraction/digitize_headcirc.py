import sys, json, fitz, numpy as np
import os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import get_curve_points, numeric_words, robust_axis_fit

PCTS = [3,10,25,50,75,90,97]

def calibrate(page, age_lo=0, age_hi=5):
    nums = numeric_words(page)
    W, H = page.rect.width, page.rect.height

    age_cands = [n for n in nums if age_lo-0.5<=n[0]<=age_hi+0.5]
    Ax, rx, nx, ncx = robust_axis_fit(age_cands, axis='x', max_resid=1.0, min_pts=4)

    hc_cands = [n for n in nums if 25<=n[0]<=60]
    Ay, ry, ny, ncy = robust_axis_fit(hc_cands, axis='y', max_resid=1.0, min_pts=4)

    def age_of_x(x): return Ax[0]*x + Ax[1]
    def hc_of_y(y): return Ay[0]*y + Ay[1]
    return age_of_x, hc_of_y, dict(resid_x_px=rx, resid_y=ry, n_x=nx, n_y=ny, clusters_x=ncx, clusters_y=ncy)

def digitize(path):
    doc = fitz.open(path)
    page = doc[0]
    age_of_x, hc_of_y, calib = calibrate(page)
    draws = page.get_drawings()
    curves = [d for d in draws if d['type']=='s' and len(d['items']) >= 20 and d.get('color')==(0.0,0.0,0.0)]
    assert len(curves) == 7, f"expected 7 head-circumference curves, got {len(curves)}"

    parsed = []
    for d in curves:
        pts = get_curve_points(d['items'])
        pts.sort(key=lambda p: p[0])
        parsed.append(pts)
    npts = [len(p) for p in parsed]
    assert len(set(npts)) == 1, f"inconsistent point counts: {npts}"

    ordered = sorted(parsed, key=lambda c: hc_of_y(c[-1][1]))
    series = {}
    for pc, curve in zip(PCTS, ordered):
        series[pc] = [(round(age_of_x(x),4), round(hc_of_y(y),4)) for x,y in curve]
    return series, calib

if __name__ == '__main__':
    path, outpath = sys.argv[1], sys.argv[2]
    series, calib = digitize(path)
    print('calib:', calib)
    for pc in PCTS:
        pts = series[pc]
        print(f'P{pc:<3} n={len(pts)}  age[{pts[0][0]:.3f},{pts[-1][0]:.3f}]  hc[{pts[0][1]:.3f} .. {pts[-1][1]:.3f}]')
    json.dump(series, open(outpath, 'w'))
