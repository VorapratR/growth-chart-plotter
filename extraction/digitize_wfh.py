import sys, json, fitz, numpy as np
import os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import get_curve_points, numeric_words, linfit

PCTS = [3, 10, 25, 50, 75, 90, 97]

def calibrate(page, ht_lo, ht_hi):
    nums = numeric_words(page)
    W, H = page.rect.width, page.rect.height
    bottom = [(v,(x0+x1)/2) for v,x0,y0,x1,y1 in nums
              if ht_lo<=v<=ht_hi and v % 10 == 0 and y0>H*0.9]
    xs = np.array([t[1] for t in bottom]); vs = np.array([t[0] for t in bottom])
    Ax, resid_x = linfit(vs, xs)   # x_px = A0*height + A1

    left  = [(v,(y0+y1)/2) for v,x0,y0,x1,y1 in nums if x1<50 and 5<=v<=90]
    right = [(v,(y0+y1)/2) for v,x0,y0,x1,y1 in nums if x0>W-50 and 5<=v<=90]
    ally = np.array([t[1] for t in left] + [t[1] for t in right])
    allv = np.array([t[0] for t in left] + [t[0] for t in right])
    Ay, resid_y = linfit(ally, allv)   # weight = A0*y_px + A1

    def ht_of_x(x): return (x - Ax[1]) / Ax[0]
    def wt_of_y(y): return Ay[0]*y + Ay[1]
    return ht_of_x, wt_of_y, dict(resid_x=resid_x, resid_y=resid_y, n_x=len(bottom), n_y=len(left)+len(right))

def digitize(path, ht_lo, ht_hi):
    doc = fitz.open(path)
    page = doc[0]
    ht_of_x, wt_of_y, calib = calibrate(page, ht_lo, ht_hi)
    draws = page.get_drawings()
    curves = [d for d in draws if d['type']=='s' and len(d['items']) >= 20]
    assert len(curves) == 7, f"expected 7 curves, got {len(curves)}: " + str([(d.get('color'),d.get('width'),len(d['items'])) for d in curves])

    parsed = []
    for d in curves:
        pts = get_curve_points(d['items'])
        pts.sort(key=lambda p: p[0])
        parsed.append(pts)

    ordered = sorted(parsed, key=lambda c: wt_of_y(c[-1][1]))
    series = {}
    for pc, curve in zip(PCTS, ordered):
        series[pc] = [(round(ht_of_x(x), 4), round(wt_of_y(y), 4)) for x, y in curve]
    return series, calib

if __name__ == '__main__':
    path, lo, hi, outpath = sys.argv[1], float(sys.argv[2]), float(sys.argv[3]), sys.argv[4]
    series, calib = digitize(path, lo, hi)
    print('calib:', calib)
    for pc in PCTS:
        pts = series[pc]
        print(f'P{pc:<3} n={len(pts)}  ht[{pts[0][0]:.2f},{pts[-1][0]:.2f}]  wt[{pts[0][1]:.3f} .. {pts[-1][1]:.3f}]')
    json.dump(series, open(outpath, 'w'))
