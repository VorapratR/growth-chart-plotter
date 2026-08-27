import sys, json, fitz, numpy as np
import os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import get_curve_points, numeric_words, linfit

Z_LIST = [-3, -2, -1.5, -1, 0, 1, 1.5, 2, 3]

def calibrate(page, age_lo, age_hi):
    nums = numeric_words(page)
    W, H = page.rect.width, page.rect.height
    # x axis: bottom row only -- require BOTH the y-position (near bottom) AND
    # x-position well inside the plot (excludes left/right axis number columns,
    # which can coincidentally hold values that also fall in the age range)
    bottom = [(v,(x0+x1)/2,(y0+y1)/2) for v,x0,y0,x1,y1 in nums
              if age_lo-0.5<=v<=age_hi+0.5 and y0>H*0.9 and x0>60 and x1<W-60]
    xs = np.array([t[1] for t in bottom]); vs = np.array([t[0] for t in bottom])
    Ax, rx = linfit(vs, xs)   # x_px = Ax0*age + Ax1

    # y axis: left + right columns -- require the text box to sit fully inside
    # the margin (x1<50 / x0>W-50) so boundary-straddling top-axis labels
    # (e.g. the age tick sitting right at the left margin) don't leak in
    left  = [(v,(y0+y1)/2) for v,x0,y0,x1,y1 in nums if x1<50 and 5<=v<=45]
    right = [(v,(y0+y1)/2) for v,x0,y0,x1,y1 in nums if x0>W-50 and 5<=v<=45]
    ly = np.array([t[1] for t in left]);  lv = np.array([t[0] for t in left])
    ry = np.array([t[1] for t in right]); rv = np.array([t[0] for t in right])
    Ay_l, ry_l = linfit(ly, lv)
    Ay_r, ry_r = linfit(ry, rv)
    # combine both sides for the final fit (more label points -> tighter fit)
    ally = np.concatenate([ly, ry]); allv = np.concatenate([lv, rv])
    Ay, ry_resid = linfit(ally, allv)

    def age_of_x(x): return (x - Ax[1]) / Ax[0]
    def bmi_of_y(y): return Ay[0]*y + Ay[1]
    return age_of_x, bmi_of_y, dict(resid_x_px=rx, resid_y_left=ry_l, resid_y_right=ry_r,
                                      resid_y_combined=ry_resid, n_x=len(bottom), n_y_left=len(left), n_y_right=len(right))

def digitize(path, age_lo, age_hi):
    doc = fitz.open(path)
    page = doc[0]
    age_of_x, bmi_of_y, calib = calibrate(page, age_lo, age_hi)
    draws = page.get_drawings()
    curves = [d for d in draws if d['type']=='s' and len(d['items']) >= 20]
    assert len(curves) == 9, f"expected 9 BMI curves, got {len(curves)}"

    parsed = []
    for d in curves:
        pts = get_curve_points(d['items'])
        pts.sort(key=lambda p: p[0])
        parsed.append(pts)
    npts = [len(p) for p in parsed]
    assert len(set(npts)) == 1, f"curves have inconsistent point counts: {npts}"

    # sort ascending by value at the last (oldest-age) x -> z=-3 .. z=+3
    ordered = sorted(parsed, key=lambda c: bmi_of_y(c[-1][1]))
    series = {}
    for z, curve in zip(Z_LIST, ordered):
        series[z] = [(round(age_of_x(x), 4), round(bmi_of_y(y), 4)) for x, y in curve]
    return series, calib

if __name__ == '__main__':
    import sys
    path, age_lo, age_hi, outpath = sys.argv[1], float(sys.argv[2]), float(sys.argv[3]), sys.argv[4]
    series, calib = digitize(path, age_lo, age_hi)
    print('calib:', calib)
    for z in Z_LIST:
        pts = series[z]
        print(f'z={z:+.1f}  n={len(pts)}  age[{pts[0][0]:.3f},{pts[-1][0]:.3f}]  bmi[{pts[0][1]:.3f} .. {pts[-1][1]:.3f}]')
    json.dump(series, open(outpath, 'w'))
