/* ============================================================
   game.js — Ellipse in Plane.
   A 2-VP box is drawn with one face tinted; the player lays an
   ellipse onto it like a plate on a table (or a wheel on an axle)
   and locks it in — either by sweeping it freehand in one stroke
   (draw mode, the studio way) or by dragging a handle gizmo.
   Ground truth is the face's inscribed circle imaged through the
   same pinhole camera, solved in closed form as an exact conic —
   so the reveal is the ellipse perspective demands, to the pixel.
   Three faces per round, each more foreshortened than the last.
   ============================================================ */
(function () {
  'use strict';

  var SLUG = 'ellipse-in-plane';
  var ITEMS_PER_ROUND = 3;
  var CIRCLE_SAMPLES = 64;
  var TAU = Math.PI * 2;
  /* derived from the slug so it can never collide with a sibling drill's
     preference on the shared sadeali.com origin */
  var MODE_KEY = 'artdaily-' + SLUG + '-mode';
  var MONO = 'ui-monospace, Menlo, Consolas, monospace';

  var canvas = document.getElementById('gameCanvas');
  var ctx = canvas.getContext('2d');
  var hint = document.getElementById('hint');
  var toast = document.getElementById('toast');
  var hudRound = document.getElementById('hudRound');
  var hudScore = document.getElementById('hudScore');
  var hudBest = document.getElementById('hudBest');
  var btnLock = document.getElementById('btnLock');
  var btnMode = document.getElementById('btnMode');

  ArtDaily.init({ slug: SLUG });

  /* ============================================================
     PURE scoring + geometry — no canvas, no DOM, no randomness.
     Inputs in, numbers out; unit-testable in isolation.
     ============================================================ */

  function clamp(x, lo, hi) { return x < lo ? lo : (x > hi ? hi : x); }

  function radians(d) { return d * Math.PI / 180; }

  /* An ellipse's axis has no direction: 178° off means 2° off. */
  function foldAngleDeg(d) {
    d = Math.abs(d) % 180;
    return d > 90 ? 180 - d : d;
  }

  /* Ensure a >= b (swapping the roles rotates the axis by 90°). */
  function normEllipse(e) {
    if (e.b <= e.a) return { cx: e.cx, cy: e.cy, a: e.a, b: e.b, theta: e.theta };
    return { cx: e.cx, cy: e.cy, a: e.b, b: e.a, theta: e.theta + Math.PI / 2 };
  }

  /* ---- conics ---------------------------------------------------
     A general conic Ax² + Bxy + Cy² + Dx + Ey + F = 0 read back as
     centre / semi-axes / tilt, or null when it is not a real
     ellipse. The coefficients are normalised to a positive-definite
     quadratic part first, so an overall sign flip (which leaves the
     same curve) cannot swap the major and minor axes. */
  function conicEllipse(A, B, C, D, E, F) {
    if (A + C < 0) { A = -A; B = -B; C = -C; D = -D; E = -E; F = -F; }
    var det = 4 * A * C - B * B;
    if (!(det > 0)) return null;
    var cx = (B * E - 2 * C * D) / det;
    var cy = (B * D - 2 * A * E) / det;
    var Fc = A * cx * cx + B * cx * cy + C * cy * cy + D * cx + E * cy + F;
    var m = (A + C) / 2, d = Math.hypot((A - C) / 2, B / 2);
    var l1 = m + d, l2 = m - d;          /* l1 >= l2 > 0 */
    var s1 = -Fc / l1, s2 = -Fc / l2;    /* squared semi-axes */
    if (!(s1 > 0) || !(s2 > 0)) return null;
    var theta = (Math.abs(B) < 1e-15)
      ? (A <= C ? 0 : Math.PI / 2)
      : Math.atan2(l2 - A, B / 2);       /* eigenvector of the major axis */
    var out = { cx: cx, cy: cy, a: Math.sqrt(s2), b: Math.sqrt(s1), theta: theta };
    return (isFinite(out.cx) && isFinite(out.cy) &&
      isFinite(out.a) && isFinite(out.b) && out.a > 0 && out.b > 0) ? out : null;
  }

  /* Adjugate of a 3×3 — the inverse up to a scale a conic ignores. */
  function adj3(m) {
    return [
      [m[1][1] * m[2][2] - m[1][2] * m[2][1],
       m[0][2] * m[2][1] - m[0][1] * m[2][2],
       m[0][1] * m[1][2] - m[0][2] * m[1][1]],
      [m[1][2] * m[2][0] - m[1][0] * m[2][2],
       m[0][0] * m[2][2] - m[0][2] * m[2][0],
       m[0][2] * m[1][0] - m[0][0] * m[1][2]],
      [m[1][0] * m[2][1] - m[1][1] * m[2][0],
       m[0][1] * m[2][0] - m[0][0] * m[2][1],
       m[0][0] * m[1][1] - m[0][1] * m[1][0]]
    ];
  }

  /* THE ground truth. A circle of radius r centred at F3, spanning
     the orthonormal in-plane vectors e1/e2, imaged by the pinhole
     (x/z, −y/z) and then by the fit-to-canvas similarity T. Both
     maps are linear in homogeneous coordinates, so the image of the
     circle is exactly a conic: build the plane→screen homography,
     push u² + v² − r² = 0 through it, read the ellipse back. No
     sampling, no fitting, no "within a couple of pixels". */
  function projectedCircle(F3, e1, e2, r, T) {
    var M = [
      [T.tx * e1.z + T.k * e1.x, T.tx * e2.z + T.k * e2.x, T.tx * F3.z + T.k * F3.x],
      [T.ty * e1.z - T.k * e1.y, T.ty * e2.z - T.k * e2.y, T.ty * F3.z - T.k * F3.y],
      [e1.z, e2.z, F3.z]
    ];
    var Q = adj3(M), i, j, C = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
    /* Cimg ∝ Qᵀ · diag(1, 1, −r²) · Q */
    for (i = 0; i < 3; i++) {
      for (j = 0; j < 3; j++) {
        C[i][j] = Q[0][i] * Q[0][j] + Q[1][i] * Q[1][j] - r * r * Q[2][i] * Q[2][j];
      }
    }
    return conicEllipse(C[0][0], 2 * C[0][1], C[1][1], 2 * C[0][2], 2 * C[1][2], C[2][2]);
  }

  /* Dense linear solve (Gauss–Jordan, partial pivoting). */
  function solveDense(N, v) {
    var n = v.length, M = [], i, j, k, piv, mx, f, tmp, out = [];
    for (i = 0; i < n; i++) M.push(N[i].concat([v[i]]));
    for (i = 0; i < n; i++) {
      piv = i; mx = Math.abs(M[i][i]);
      for (k = i + 1; k < n; k++) {
        if (Math.abs(M[k][i]) > mx) { mx = Math.abs(M[k][i]); piv = k; }
      }
      if (!(mx > 1e-12)) return null;
      tmp = M[i]; M[i] = M[piv]; M[piv] = tmp;
      for (k = 0; k < n; k++) {
        if (k === i) continue;
        f = M[k][i] / M[i][i];
        if (!f) continue;
        for (j = i; j <= n; j++) M[k][j] -= f * M[i][j];
      }
    }
    for (i = 0; i < n; i++) {
      if (!isFinite(M[i][n] / M[i][i])) return null;
      out.push(M[i][n] / M[i][i]);
    }
    return out;
  }

  /* Least-squares conic through a freehand stroke. Centring and
     scaling the points on their own spread conditions the system;
     with the origin inside the curve the constant term is safely
     non-zero, so pinning it at −1 turns the fit into five linear
     unknowns. Returns null when the stroke is not ellipse-shaped. */
  function fitEllipseToStroke(pts) {
    var n = pts.length, i, j, k, mx = 0, my = 0, sd = 0, x, y, row;
    if (n < 10) return null;
    for (i = 0; i < n; i++) { mx += pts[i].x; my += pts[i].y; }
    mx /= n; my /= n;
    for (i = 0; i < n; i++) {
      sd += (pts[i].x - mx) * (pts[i].x - mx) + (pts[i].y - my) * (pts[i].y - my);
    }
    sd = Math.sqrt(sd / n);
    if (!(sd > 4)) return null;
    var N = [[0, 0, 0, 0, 0], [0, 0, 0, 0, 0], [0, 0, 0, 0, 0],
             [0, 0, 0, 0, 0], [0, 0, 0, 0, 0]];
    var v = [0, 0, 0, 0, 0];
    for (i = 0; i < n; i++) {
      x = (pts[i].x - mx) / sd; y = (pts[i].y - my) / sd;
      row = [x * x, x * y, y * y, x, y];
      for (j = 0; j < 5; j++) {
        v[j] += row[j];
        for (k = 0; k < 5; k++) N[j][k] += row[j] * row[k];
      }
    }
    var p = solveDense(N, v);
    if (!p) return null;
    var e = conicEllipse(p[0], p[1], p[2], p[3], p[4], -1);
    if (!e) return null;
    return {
      cx: e.cx * sd + mx, cy: e.cy * sd + my,
      a: e.a * sd, b: e.b * sd, theta: e.theta
    };
  }

  /* A conic only means something if the stroke actually went round:
     the fraction of 24 angular bins it visited. Measured in the
     fitted ellipse's OWN frame — coordinates normalised by its
     semi-axes first — because polar angle around the centre bunches
     up near the major axis, so a legitimate sweep of a 15° cigar
     would look like a half-stroke while a circle looked complete. */
  function strokeCoverage(pts, e) {
    var bins = [], i, k, hit = 0, dx, dy, u, v;
    var cs = Math.cos(e.theta), sn = Math.sin(e.theta);
    for (i = 0; i < 24; i++) bins.push(0);
    for (i = 0; i < pts.length; i++) {
      dx = pts[i].x - e.cx; dy = pts[i].y - e.cy;
      u = (dx * cs + dy * sn) / Math.max(1e-9, e.a);
      v = (-dx * sn + dy * cs) / Math.max(1e-9, e.b);
      if (!(u * u + v * v > 1e-9)) continue;
      k = Math.floor(((Math.atan2(v, u) + Math.PI) / TAU) * 24);
      bins[k < 0 ? 0 : (k > 23 ? 23 : k)] = 1;
    }
    for (i = 0; i < 24; i++) hit += bins[i];
    return hit / 24;
  }

  /* Moment fit, kept as the safety net if the closed-form conic ever
     degenerates: centre = mean, axes from the 2×2 covariance. */
  function fitEllipseFromPoints(pts) {
    var n = pts.length, i, mx = 0, my = 0;
    if (!n) return { cx: 0, cy: 0, a: 0, b: 0, theta: 0 };
    for (i = 0; i < n; i++) { mx += pts[i].x; my += pts[i].y; }
    mx /= n; my /= n;
    var sxx = 0, sxy = 0, syy = 0, dx, dy;
    for (i = 0; i < n; i++) {
      dx = pts[i].x - mx; dy = pts[i].y - my;
      sxx += dx * dx; sxy += dx * dy; syy += dy * dy;
    }
    sxx /= n; sxy /= n; syy /= n;
    var tr = sxx + syy;
    var disc = Math.sqrt(Math.max(0, (sxx - syy) * (sxx - syy) / 4 + sxy * sxy));
    var l1 = tr / 2 + disc, l2 = Math.max(0, tr / 2 - disc);
    var theta = (Math.abs(sxy) > 1e-12) ? Math.atan2(l1 - sxx, sxy)
      : (sxx >= syy ? 0 : Math.PI / 2);
    return { cx: mx, cy: my, a: Math.sqrt(2 * l1), b: Math.sqrt(2 * l2), theta: theta };
  }

  /* Mean of the two projected diagonals of the face quad —
     the scale every error is judged against. */
  function faceDiagOf(quad) {
    var d1 = Math.hypot(quad[2].x - quad[0].x, quad[2].y - quad[0].y);
    var d2 = Math.hypot(quad[3].x - quad[1].x, quad[3].y - quad[1].y);
    return (d1 + d2) / 2;
  }

  /* Everything inside FREE is full credit, so a genuinely nailed
     ellipse reads 100 instead of 96 — and the scale starts there. FREE is
     the pen standard; ArtDaily.ease() opens it for a hand that cannot hold
     as still, and FREE_PX floors it, because 2% of a 150px phone face
     diagonal is 3px — inside a fingertip's own jitter. */
  var FREE = 0.02;
  var FREE_PX = 5;
  var ZERO = 0.55;      /* total error that reaches 0, pen standard */
  var SIZE_CAP = 0.38;  /* size alone can no longer swallow the budget */

  /* Item score 0–100 plus the three error terms that made it, so the
     reveal can say WHICH way you were wrong. Angle error is weighted
     by the truth's eccentricity: a near-circular truth makes its axis
     direction meaningless, so the weight fades to zero.

     The size term is scale + SHAPE, not two relative radius errors. The
     old `|p.b−t.b|/t.b` made a small absolute miss on a narrow truth
     catastrophic (face 3's minor axis is ~40px, so 8px of hand noise cost
     20% of the whole budget) and it was uncapped, so it could zero an
     otherwise good ellipse on its own — while the drill's own coaching
     asks for tilt first. Shape is measured as b/a: the DEGREE the drill
     exists to teach, and the number the reveal already prints. */
  function scoreItem(player, truth, faceDiag, ease) {
    var p = normEllipse(player), t = normEllipse(truth);
    var diag = Math.max(1e-9, faceDiag);
    var centreErr = Math.hypot(p.cx - t.cx, p.cy - t.cy) / diag;
    var angErrDeg = foldAngleDeg((p.theta - t.theta) * 180 / Math.PI);
    var wAng = clamp((1 - t.b / Math.max(1e-9, t.a)) * 2, 0, 1);
    var scaleErr = Math.abs(p.a - t.a) / Math.max(1e-9, t.a);
    var shapeErr = Math.abs(p.b / Math.max(1e-9, p.a) - t.b / Math.max(1e-9, t.a));
    var centre = 1.4 * centreErr;
    var angle = wAng * (angErrDeg / 90) * 0.8;
    var size = Math.min(SIZE_CAP, 0.7 * scaleErr + shapeErr);
    var free = Math.max(ease(FREE), ease(FREE_PX) / diag);
    var err = Math.max(0, centre + angle + size - free) / Math.max(1e-9, ease(ZERO));
    var s = 100 * clamp(1 - err, 0, 1);
    return {
      score: isFinite(s) ? s : 0,
      centre: centre, angle: angle, size: size
    };
  }

  function roundScore(scores) {
    if (!scores.length) return 0;
    var s = 0, i;
    for (i = 0; i < scores.length; i++) s += scores[i];
    return s / scores.length;
  }

  function bestScore(scores) {
    var b = 0, i;
    for (i = 0; i < scores.length; i++) if (scores[i] > b) b = scores[i];
    return b;
  }

  /* The "degree" artists buy ellipse templates in: b/a = sin(deg). */
  function degreeOf(e) {
    var t = normEllipse(e);
    return Math.asin(clamp(t.b / Math.max(1e-9, t.a), 0, 1)) * 180 / Math.PI;
  }

  /* Name the biggest of the three errors, in studio words. */
  function missNote(parts, player, truth) {
    var worst = 'centre', v = parts.centre;
    if (parts.angle > v) { worst = 'angle'; v = parts.angle; }
    if (parts.size > v) { worst = 'size'; v = parts.size; }
    if (v <= FREE) return 'dead on.';
    if (worst === 'centre') return 'mostly placement — the plate slid off the face.';
    if (worst === 'angle') return 'mostly tilt — swing the minor axis onto the axle.';
    return degreeOf(player) > degreeOf(truth)
      ? 'mostly size — yours is too round, squash it further.'
      : 'mostly size — yours is too narrow, open it up.';
  }

  /* Pinhole camera at the origin: x right, y up, z forward, f = 1
     (the fit-to-canvas similarity supplies the scale). Screen y is
     flipped because canvas y grows downward. */
  function project(p) { return { x: p.x / p.z, y: -p.y / p.z }; }

  function applyT(T, p) { return { x: T.tx + T.k * p.x, y: T.ty + T.k * p.y }; }

  /* ============================================================
     Scene generation — the 2-VP box, its highlighted face and
     that face's inscribed circle in 3D. Math only, no DOM.
     ============================================================ */

  function rand(lo, hi) { return lo + Math.random() * (hi - lo); }

  /* A box yawed about the vertical axis; the camera looks along +z,
     so vertical edges stay vertical: classic 2-point perspective. */
  function makeBox(yaw, C, s) {
    var cy = Math.cos(yaw), sy = Math.sin(yaw);
    var axes = {
      u: { x: cy, y: 0, z: sy },
      v: { x: 0, y: 1, z: 0 },
      w: { x: -sy, y: 0, z: cy },
    };
    var corners = [], signs = [], i, a, b, c;
    for (i = 0; i < 8; i++) {
      a = (i & 1) ? 1 : -1; b = (i & 2) ? 1 : -1; c = (i & 4) ? 1 : -1;
      signs.push([a, b, c]);
      corners.push({
        x: C.x + 0.5 * s * (a * axes.u.x + c * axes.w.x),
        y: C.y + 0.5 * s * b,
        z: C.z + 0.5 * s * (a * axes.u.z + c * axes.w.z),
      });
    }
    return { axes: axes, C: C, s: s, corners: corners, signs: signs };
  }

  /* Corner indices (bit0=u, bit1=v, bit2=w) of one face, in cyclic
     order so the quad path closes cleanly. */
  function faceIndices(axis, sign) {
    var others = [[2, 4], [1, 4], [1, 2]][axis];
    var base = sign > 0 ? [1, 2, 4][axis] : 0;
    var order = [[1, 1], [1, -1], [-1, -1], [-1, 1]];
    var out = [], i, idx;
    for (i = 0; i < 4; i++) {
      idx = base;
      if (order[i][0] > 0) idx |= others[0];
      if (order[i][1] > 0) idx |= others[1];
      out.push(idx);
    }
    return out;
  }

  /* The 12 edges as [cornerA, cornerB, differing axis bit]. */
  var EDGES = (function () {
    var out = [], i, j, d;
    for (i = 0; i < 8; i++) {
      for (j = i + 1; j < 8; j++) {
        d = i ^ j;
        if (d === 1 || d === 2 || d === 4) out.push([i, j, d]);
      }
    }
    return out;
  })();

  function axisOfBit(b) { return b === 1 ? 0 : (b === 2 ? 1 : 2); }

  function faceVisible(box, axis, sign) {
    var ax = [box.axes.u, box.axes.v, box.axes.w][axis];
    var nx = sign * ax.x, ny = sign * ax.y, nz = sign * ax.z;
    var fx = box.C.x + 0.5 * box.s * nx;
    var fy = box.C.y + 0.5 * box.s * ny;
    var fz = box.C.z + 0.5 * box.s * nz;
    return fx * nx + fy * ny + fz * nz < 0;
  }

  /* A convex solid's edge shows iff either adjacent face shows. */
  function edgeVisible(sc, e) {
    var bits = [1, 2, 4], k, ob, sign;
    for (k = 0; k < 3; k++) {
      ob = bits[k];
      if (ob === e[2]) continue;
      sign = (e[0] & ob) ? 1 : 0;
      if (sc.vis[axisOfBit(ob)][sign]) return true;
    }
    return false;
  }

  /* Difficulty ramp lives here — foreshortening strictly increases:
     item 0 an open top face (looked down on at 44–56°), item 1 a
     turned side, item 2 a narrow, heavily foreshortened side (face
     normal 62–75° off the view axis). */
  function genItem3D(idx, gentle) {
    var s = 1, side = Math.random() < 0.5 ? -1 : 1;
    var yaw, C, faceAxis, faceSign, depr, alpha, Cz;
    if (idx === 0) {
      yaw = side * radians(rand(20, 40));
      depr = radians(rand(44, 56));
      Cz = rand(4.6, 5.4);
      C = { x: rand(-0.3, 0.3), y: -Math.tan(depr) * Cz - 0.5 * s, z: Cz };
      faceAxis = 1; faceSign = 1;
    } else {
      /* gentle: a first-ever round, or a canvas small enough that the
         narrow face's minor axis would come out under ~25px. A 20° ellipse
         is a template shape most beginners have never drawn — meeting it
         on the last item of the first round is how a round ends on its
         worst number. */
      alpha = idx === 1 ? rand(48, 56) : (gentle ? rand(52, 62) : rand(62, 75));
      yaw = side * radians(alpha);
      Cz = idx === 1 ? rand(4.2, 5.0) : rand(5.2, 6.2);
      /* lateral shift keeps the chosen face turned toward the camera */
      C = { x: -side * rand(0.05, 0.35), y: rand(-0.75, 0.05), z: Cz };
      faceAxis = 2; faceSign = -1;
    }
    var box = makeBox(yaw, C, s);
    var vis = [], a2;
    for (a2 = 0; a2 < 3; a2++) {
      vis.push([faceVisible(box, a2, -1), faceVisible(box, a2, 1)]);
    }
    var axArr = [box.axes.u, box.axes.v, box.axes.w];
    var fn = axArr[faceAxis];
    var F = {
      x: C.x + 0.5 * s * faceSign * fn.x,
      y: C.y + 0.5 * s * faceSign * fn.y,
      z: C.z + 0.5 * s * faceSign * fn.z,
    };
    return {
      box: box, vis: vis, faceAxis: faceAxis, faceSign: faceSign,
      faceIdx: faceIndices(faceAxis, faceSign),
      F: F, r: 0.5 * s,
      e1: axArr[(faceAxis + 1) % 3], e2: axArr[(faceAxis + 2) % 3],
      /* the real axle: the face's outward normal in 3D */
      n: { x: faceSign * fn.x, y: faceSign * fn.y, z: faceSign * fn.z },
    };
  }

  function sampleCircle(sc) {
    var out = [], i, t, ct, st;
    for (i = 0; i < CIRCLE_SAMPLES; i++) {
      t = i / CIRCLE_SAMPLES * TAU;
      ct = Math.cos(t); st = Math.sin(t);
      out.push({
        x: sc.F.x + sc.r * (ct * sc.e1.x + st * sc.e2.x),
        y: sc.F.y + sc.r * (ct * sc.e1.y + st * sc.e2.y),
        z: sc.F.z + sc.r * (ct * sc.e1.z + st * sc.e2.z),
      });
    }
    return out;
  }

  /* Project the scene and fit it into a w×h canvas. The similarity
     transform is folded straight into the truth homography, so the
     ground-truth conic is exact at every layout. */
  function layoutScene(sc, w, h) {
    var pp = [], i, p;
    for (i = 0; i < 8; i++) pp.push(project(sc.box.corners[i]));
    var minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
    for (i = 0; i < 8; i++) {
      p = pp[i];
      if (p.x < minx) minx = p.x;
      if (p.x > maxx) maxx = p.x;
      if (p.y < miny) miny = p.y;
      if (p.y > maxy) maxy = p.y;
    }
    var m = 40;
    var k = Math.min(
      (w - 2 * m) / Math.max(1e-9, maxx - minx),
      (h - 2 * m) / Math.max(1e-9, maxy - miny)
    );
    var T = { k: k, tx: w / 2 - k * (minx + maxx) / 2, ty: h / 2 - k * (miny + maxy) / 2 };
    sc.T = T;
    sc.pts = [];
    for (i = 0; i < 8; i++) sc.pts.push(applyT(T, pp[i]));
    sc.quad = [];
    for (i = 0; i < 4; i++) sc.quad.push(sc.pts[sc.faceIdx[i]]);
    sc.truth = projectedCircle(sc.F, sc.e1, sc.e2, sc.r, T);
    if (!sc.truth) {
      /* never expected: the circle plane would have to touch the eye */
      var samples = [], j, q = sampleCircle(sc);
      for (j = 0; j < q.length; j++) samples.push(applyT(T, project(q[j])));
      sc.truth = fitEllipseFromPoints(samples);
    }
    /* the axle, imaged for real: the 3D normal line through the face
       centre pushed through the same camera, not the 2D minor axis */
    var f0 = applyT(T, project(sc.F));
    var f1 = applyT(T, project({
      x: sc.F.x + 0.25 * sc.n.x, y: sc.F.y + 0.25 * sc.n.y, z: sc.F.z + 0.25 * sc.n.z
    }));
    var ax = f1.x - f0.x, ay = f1.y - f0.y, al = Math.hypot(ax, ay) || 1;
    sc.axle = { x: f0.x, y: f0.y, dx: ax / al, dy: ay / al };
    sc.faceDiag = faceDiagOf(sc.quad);
    sc.horizonY = T.ty; /* eye level projects to camera y = 0 */
    return sc;
  }

  /* ============================================================
     Canvas + DOM from here down.
     ============================================================ */

  /* accent is the wash rose (fills, haloes, the odd-one-out handle);
     line is the same rose at graphite weight, for the strokes that
     carry meaning — the wash is only 2.95:1 on the paper card, the
     line clears AA in both themes. Re-read on every repaint. */
  /* The ONLY thing that moves any of these is the data-theme attribute
     (see css/style.css), so reading them once per theme gives the same
     answer as reading them once per repaint — minus a forced style
     recalculation on every sample of every sweep. An empty read
     (stylesheet not parsed yet) is never cached, so a cold boot still
     corrects itself on the next frame. */
  var inkCache = null, inkTheme = '';
  function inks() {
    var t = ArtDaily.theme();
    if (inkCache && inkTheme === t) return inkCache;
    var cs = getComputedStyle(document.documentElement);
    var accent = cs.getPropertyValue('--game-accent').trim() || cs.getPropertyValue('--bubblegum').trim();
    var c = {
      ink: cs.getPropertyValue('--ink').trim(),
      muted: cs.getPropertyValue('--muted').trim(),
      accent: accent,
      line: cs.getPropertyValue('--game-line').trim() || accent,
      card: cs.getPropertyValue('--card').trim(),
    };
    if (c.ink && c.card) { inkCache = c; inkTheme = t; }
    return c;
  }

  /* ---- crisp canvas at any devicePixelRatio; height tracks width ----
     Assigning canvas.width BLANKS the sheet, so it is only assigned when
     something really moved: a phone fires `resize` on every pixel of
     address-bar slide, at an unchanged width, and each one used to
     reallocate the backing store and re-project the whole scene. */
  var W = 0, H = 0, fitDpr = 0;
  function fitCanvas() {
    var rect = canvas.getBoundingClientRect();
    var w = Math.max(1, Math.round(rect.width));
    var h = Math.round(w * 0.62);
    var dpr = window.devicePixelRatio || 1;
    if (w === W && h === H && dpr === fitDpr) return false;
    W = w; H = h; fitDpr = dpr;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    canvas.style.height = H + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return true;
  }

  /* ---- round state ---- */
  var round = 0, itemIdx = 0, itemScores = [], roundOver = false, reported = false;
  var scene = null, player = null, state = 'idle'; /* idle | aim | reveal */
  var stroke = null;      /* live freehand segment, draw mode */
  /* Every segment of the sweep in progress. A trackpad physically cannot
     pull a 250px closed arc in one go, and the old rule threw a lifted
     sweep away entirely, so the drill hard-failed on the most common
     laptop. A press near where you stopped, soon after, continues the
     same sweep; the conic is fitted to the union. */
  var sweep = null;       /* { segs: [[pt,…],…], liftAt, liftPt } */
  var missedClosure = 0;  /* consecutive unfinished sweeps on this face */
  var grabbed = false;    /* first handle touch retires the micro-labels */
  var FIRST_VISIT = ArtDaily.best() === null;
  var RESUME_MS = 2500;

  function ease(v) { return ArtDaily.ease(v); }

  /* How far round a sweep must get before it counts as an ellipse. A pen
     keeps the strict rule; a hand that has to lift is given room, and with
     multi-segment sweeps it rarely matters. */
  function coverMin() { return 0.75 - (ease(1) - 1) * 0.09; }

  function sweepPts() {
    var out = [], i, j, s;
    if (sweep) {
      for (i = 0; i < sweep.segs.length; i++) {
        s = sweep.segs[i];
        for (j = 0; j < s.length; j++) out.push(s[j]);
      }
    }
    if (stroke) for (j = 0; j < stroke.pts.length; j++) out.push(stroke.pts[j]);
    return out;
  }

  function pathLen(pts) {
    var i, len = 0;
    for (i = 1; i < pts.length; i++) len += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    return len;
  }
  var modeChosen = false;   /* has the player ever picked a mode? */
  var mode = (function () {
    var v = null;
    try { v = localStorage.getItem(MODE_KEY); } catch (e) {}
    modeChosen = (v === 'handles' || v === 'draw');
    return v === 'handles' ? 'handles' : 'draw';
  })();

  /* FIRST-EVER VISIT: TWO FACES, NOT THREE. Face 3 is the heavily
     foreshortened one — a 20-something-degree ellipse, the template shape
     a beginner has never drawn — and it is the face that only makes sense
     once the first two have taught what the axle is. Three full freehand
     sweeps, each one re-swept until it closes, is several minutes before a
     single reported number, which is a long time to ask of somebody still
     deciding whether the drill is for them. Every sibling drill in the set
     already shortens its first round exactly this way; this was the one
     that did not. It can only ever fire for a player with NO recorded
     best, so no score, streak or record that already exists changes what
     it means — and the round is still the mean of the faces played. */
  var itemsThisRound = ITEMS_PER_ROUND;

  /* the "n of m" is built by itemHint(), so a short first round counts
     itself honestly instead of promising a third face that never comes */
  var ITEM_NOTE = [
    'the open top, a plate lying on a table.',
    'a turned side, so steeper.',
    'a narrow one: the minor axis runs down the axle, the line straight out of the face.',
  ];

  function itemHint() {
    var verb;
    if (mode === 'draw') {
      verb = player
        ? 'redraw over it, or nudge the handles, then lock it in.'
        : 'sweep the ellipse onto the tinted face — all the way round. ' +
          'lifting is fine: press near where you stopped and carry on.';
    } else {
      verb = 'drag the plate onto the tinted face — centre moves, rim handles set length and tilt, the small one sets width — then lock it in.';
    }
    return 'face ' + (itemIdx + 1) + ' of ' + itemsThisRound + ' — ' +
      (ITEM_NOTE[itemIdx] || '') + ' ' + verb;
  }

  /* Where the corner sticker sits, in canvas coordinates — null when
     it is hidden or a narrow-screen layout has moved it off the
     sheet. Measured on layout changes only, never mid-drag. */
  var lockBox = null;
  function measureLock() {
    lockBox = null;
    if (btnLock.hidden) return;
    var cr = canvas.getBoundingClientRect(), br = btnLock.getBoundingClientRect();
    if (!br.width || !br.height) return;
    var r = {
      x0: br.left - cr.left, y0: br.top - cr.top,
      x1: br.right - cr.left, y1: br.bottom - cr.top
    };
    if (r.x1 < 0 || r.y1 < 0 || r.x0 > W || r.y0 > H) return;
    lockBox = r;
  }

  /* Keep the plate's centre out from under the sticker, so a tap
     meant for the centre can never land on "lock it in" instead. */
  function clampCentre(E) {
    E.cx = clamp(E.cx, 12, W - 12);
    E.cy = clamp(E.cy, 12, H - 12);
    var r = lockBox;
    if (r && E.cx > r.x0 - 16 && E.cx < r.x1 + 16 && E.cy > r.y0 - 16) {
      E.cy = Math.max(12, r.y0 - 16);
    }
  }

  function initPlayer(sc) {
    var f = { x: 0, y: 0 }, i;
    for (i = 0; i < 4; i++) { f.x += sc.quad[i].x / 4; f.y += sc.quad[i].y / 4; }
    var a0 = clamp(0.3 * sc.faceDiag, 20, 0.4 * H);
    var cy0 = f.y + 0.55 * sc.faceDiag;
    if (cy0 > H - 30) cy0 = f.y - 0.55 * sc.faceDiag;
    var E = {
      cx: clamp(f.x + rand(-0.08, 0.08) * sc.faceDiag, 36, W - 36),
      cy: clamp(cy0, 30, H - 30),
      a: a0, b: 0.62 * a0, theta: 0,
    };
    clampCentre(E);
    return E;
  }

  function syncLock() {
    if (state === 'aim') {
      btnLock.disabled = !player;
      btnLock.textContent = player ? 'lock it in' : 'draw it first';
    }
  }

  /* The button names the DESTINATION, not the state it is already in.
     "mode: draw ✎" told a trackpad player nothing about the way out. */
  function syncMode() {
    btnMode.textContent = mode === 'draw' ? 'switch to handles ⊹' : 'switch to drawing ✎';
    btnMode.setAttribute('aria-pressed', String(mode === 'draw'));
    btnMode.title = mode === 'draw'
      ? 'same drill, drag a plate into place instead of sweeping it'
      : 'freehand — sweep the whole ellipse, lifting as often as you like';
  }

  function startItem(idx) {
    itemIdx = idx;
    /* narrow sheets get the gentler foreshortening too: the truth's minor
       axis must stay big enough to aim at */
    scene = layoutScene(genItem3D(idx, FIRST_VISIT && round <= 1 || W < 480), W, H);
    sweep = null;
    missedClosure = 0;
    cancelPointer();
    state = 'aim';
    btnLock.hidden = false;
    /* label the sticker for the mode we are about to be in, THEN
       measure it, so the first plate is clamped against its real box */
    btnLock.disabled = (mode === 'draw');
    btnLock.textContent = (mode === 'draw') ? 'draw it first' : 'lock it in';
    measureLock();
    player = (mode === 'draw') ? null : initPlayer(scene);
    hint.textContent = itemHint();
    /* Draw mode is the default and the studio way, but a trackpad had no
       way to learn the other one existed short of opening the how-to.
       Say it once, on the first face, and never again. */
    if (!modeChosen && mode === 'draw' && round === 1 && idx === 0 &&
        ArtDaily.inputMode() !== 'pen') {
      hint.textContent += ' on a mouse or trackpad? “switch to handles ⊹” is the same drill, dragged instead of swept.';
    }
    draw();
  }

  function newRound() {
    round += 1;
    itemScores = [];
    roundOver = false;
    reported = false;
    itemsThisRound = (FIRST_VISIT && round === 1) ? 2 : ITEMS_PER_ROUND;
    hudRound.textContent = String(round);
    hudScore.textContent = '–';
    startItem(0);
  }

  function scoreList() {
    var out = [], i;
    for (i = 0; i < itemScores.length; i++) out.push(Math.round(itemScores[i]));
    return out.join(' · ');
  }

  function lockIn() {
    if (state !== 'aim' || !player) return;
    var r = scoreItem(player, scene.truth, scene.faceDiag, ease);
    itemScores.push(r.score);
    state = 'reveal';
    cancelPointer();
    /* "a 47° ellipse" is the first thing anybody reads here, and on a
       first-ever reveal it is a number with no unit anyone owns. Say what
       it measures once, and point at the label on the sheet that shows
       it — after that the word carries itself. */
    var head = Math.round(r.score) + '/100 — a ' + Math.round(degreeOf(scene.truth)) +
      '° ellipse' +
      (round === 1 && itemIdx === 0
        ? ' (that ° is how open an ellipse is — the label on the sheet says what it means)'
        : '') +
      '. ' + missNote(r, player, scene.truth);
    if (itemIdx < itemsThisRound - 1) {
      btnLock.disabled = false;
      btnLock.textContent = 'next face →';
      hint.textContent = head + ' study the delta, then next face.';
    } else {
      roundOver = true;
      btnLock.hidden = true;
      measureLock();
      if (!reported) {
        reported = true;
        var res = ArtDaily.report(roundScore(itemScores));
        hudScore.textContent = String(res.score);
        hudBest.textContent = res.best === null ? '–' : String(res.best);
        /* A first-ever round has no previous best, so isNewBest is
           trivially true and "new best!" celebrates nothing — on the one
           round where the number most needs saying what it IS. The SDK
           marks that round with isFirst; an older vendored SDK simply
           leaves it undefined and the old wording stands. */
        showToast(res.isFirst
          ? 'first score ' + res.score + ' / 100 — your mark to beat'
          : (res.isNewBest ? 'new best! ' : 'score ') + res.score + ' / 100', res.isNewBest);
      }
      /* the ramp guarantees the LAST face is the worst, so the round used
         to end on the player's weakest number. Name the best one too. */
      hint.textContent = head + ' round done — faces ' + scoreList() +
        ' · your best face ' + Math.round(bestScore(itemScores)) +
        '. press “new round” (or enter) to go again' +
        (itemsThisRound < ITEMS_PER_ROUND ? ' — the next round adds a third face.' : '.');
    }
    draw();
  }

  function advance() {
    if (state === 'reveal' && !roundOver && itemIdx < itemsThisRound - 1) {
      startItem(itemIdx + 1);
    }
  }

  /* ---- painting (canvas bg stays clear so the CSS dot-grid shows) ---- */

  function line(x1, y1, x2, y2) {
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
  }

  function pathPoly(pts) {
    var i;
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.closePath();
  }

  function ellipsePath(e) {
    ctx.beginPath();
    ctx.ellipse(e.cx, e.cy, e.a, e.b, e.theta, 0, TAU);
  }

  /* half the rendered width of a label, so a centred one can be kept on
     the sheet by its own size instead of by a guessed margin */
  function textHalfWidth(txt, size) {
    ctx.save();
    ctx.font = '700 ' + size + 'px ' + MONO;
    var w = ctx.measureText(txt).width;
    ctx.restore();
    return (isFinite(w) ? w : 0) / 2;
  }

  /* Graphite on a paper-coloured halo: legible over box edges and
     the tinted face, in both themes, without tinting the type. */
  function inkText(c, txt, x, y, align, base, size) {
    ctx.save();
    ctx.font = '700 ' + size + 'px ' + MONO;
    ctx.textAlign = align;
    ctx.textBaseline = base;
    ctx.lineWidth = 3;
    ctx.lineJoin = 'round';
    ctx.strokeStyle = c.card;
    ctx.strokeText(txt, x, y);
    ctx.fillStyle = c.ink;
    ctx.fillText(txt, x, y);
    ctx.restore();
  }

  function handlePts() {
    var E = player, cs = Math.cos(E.theta), sn = Math.sin(E.theta);
    return {
      r0: { x: E.cx + E.a * cs, y: E.cy + E.a * sn },
      r1: { x: E.cx - E.a * cs, y: E.cy - E.a * sn },
      m: { x: E.cx - E.b * sn, y: E.cy + E.b * cs },
    };
  }

  /* ---- repaint scheduling ----
     A sweep is the fastest gesture in the whole drill, and it arrives
     faster still: several pointermoves per displayed frame, each of which
     used to redraw the box, both sets of edges, the tinted face and every
     point of the sweep so far. Only the last of those was ever seen, and
     the cost of each grew with the length of the sweep — so the ink lagged
     the hand most at the end of the arc, which is exactly where closing an
     ellipse needs the hand to be believed. draw() now only ASKS for a
     frame; paint() runs once, right before the browser composites. */
  var rafId = 0;
  function draw() {
    if (rafId) return;
    rafId = requestAnimationFrame(function () { rafId = 0; paint(); });
  }
  /* for paths that must not show a blank frame — a resize has already
     cleared the sheet, so it repaints on the spot */
  function paintNow() {
    if (rafId) { cancelAnimationFrame(rafId); rafId = 0; }
    paint();
  }

  function paint() {
    var c = inks();
    ctx.clearRect(0, 0, W, H);
    if (!scene) return;
    var i, e;

    if (scene.horizonY > 10 && scene.horizonY < H - 10) {
      ctx.save();
      ctx.strokeStyle = c.muted;
      ctx.globalAlpha = 0.9;   /* labelled and load-bearing: keep it AA */
      ctx.lineWidth = 1;
      ctx.setLineDash([2, 5]);
      line(0, scene.horizonY, W, scene.horizonY);
      ctx.restore();
      inkText(c, 'horizon · eye level', W - 8, scene.horizonY - 5, 'right', 'bottom', 10);
    }

    /* hidden edges: drafting convention says lighter and dashed, but
       still readable — muted at 0.75 clears AA on both sheets */
    ctx.save();
    ctx.strokeStyle = c.muted;
    ctx.globalAlpha = 0.75;
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    for (i = 0; i < EDGES.length; i++) {
      e = EDGES[i];
      if (!edgeVisible(scene, e)) line(scene.pts[e[0]].x, scene.pts[e[0]].y, scene.pts[e[1]].x, scene.pts[e[1]].y);
    }
    ctx.restore();

    /* the tint says WHICH face — a wash you can see the box through,
       fenced by a graphite-weight rose outline that clears AA */
    ctx.save();
    ctx.fillStyle = c.accent;
    ctx.globalAlpha = 0.13;
    pathPoly(scene.quad);
    ctx.fill();
    ctx.globalAlpha = 0.9;
    ctx.strokeStyle = c.line;
    ctx.lineWidth = 1.5;
    pathPoly(scene.quad);
    ctx.stroke();
    ctx.restore();

    ctx.save();
    ctx.strokeStyle = c.ink;
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (i = 0; i < EDGES.length; i++) {
      e = EDGES[i];
      if (edgeVisible(scene, e)) line(scene.pts[e[0]].x, scene.pts[e[0]].y, scene.pts[e[1]].x, scene.pts[e[1]].y);
    }
    ctx.restore();

    if (state === 'aim') {
      if (player) drawPlayer(c, true);
      if (stroke || (sweep && sweep.segs.length)) drawStroke(c);
      if (!player && !stroke && !(sweep && sweep.segs.length) && mode === 'draw') {
        inkText(c, '✎ drag anywhere to sweep your ellipse — lifting is fine', 10, H - 8, 'left', 'bottom', 11);
      }
      if (player && !grabbed && round === 1 && itemIdx === 0) drawHandleLabels(c);
    } else if (state === 'reveal') {
      if (player) drawPlayer(c, false);
      drawTruth(c);
    }
  }

  /* Every segment of the sweep, each as its own path — a lift leaves a
     gap in the ink rather than a false chord across the plate. */
  function drawStroke(c) {
    var segs = (sweep ? sweep.segs.slice() : []), i, j, p;
    if (stroke) segs.push(stroke.pts);
    ctx.save();
    ctx.strokeStyle = c.ink;
    ctx.globalAlpha = 0.8;
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (i = 0; i < segs.length; i++) {
      p = segs[i];
      if (p.length < 2) continue;
      ctx.beginPath();
      ctx.moveTo(p[0].x, p[0].y);
      for (j = 1; j < p.length; j++) ctx.lineTo(p[j].x, p[j].y);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawPlayer(c, withHandles) {
    var E = player;
    ctx.save();
    ctx.translate(E.cx, E.cy);
    ctx.rotate(E.theta);
    ctx.strokeStyle = withHandles ? c.ink : c.muted;
    ctx.globalAlpha = 0.55;   /* the axis cross is construction, but AA */
    ctx.lineWidth = 1;
    line(-E.a, 0, E.a, 0);
    line(0, -E.b, 0, E.b);
    ctx.globalAlpha = withHandles ? 0.95 : 0.8;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(0, 0, E.a, E.b, 0, 0, TAU);
    ctx.stroke();
    ctx.restore();
    if (!withHandles) return;

    var hp = handlePts();
    ctx.save();
    ctx.globalAlpha = 0.7;
    ctx.strokeStyle = c.muted;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(E.cx, E.cy, 9, 0, TAU);
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.fillStyle = c.ink;
    ctx.beginPath();
    ctx.arc(E.cx, E.cy, 3, 0, TAU);
    ctx.fill();
    handleDot(hp.r0, 8, c.card, c.ink, 2);
    handleDot(hp.r1, 8, c.card, c.ink, 2);
    /* wash-rose fill, graphite rim: colour-codes it as the odd one out,
       and the rim (not the fill) is what carries AA on the paper sheet */
    handleDot(hp.m, 6.5, c.accent, c.ink, 2);
    ctx.restore();
  }

  /* One-time coaching: on the very first face of the very first
     round the handles say what they are, then never again. */
  function drawHandleLabels(c) {
    var hp = handlePts();
    labelHandle(c, hp.r0, 'length + tilt');
    labelHandle(c, hp.m, 'width');
    labelHandle(c, { x: player.cx, y: player.cy }, 'move');
  }

  function labelHandle(c, p, txt) {
    var right = p.x > W - 110;
    inkText(c, txt, clamp(p.x, 6, W - 6) + (right ? -13 : 13),
      clamp(p.y, 9, H - 9), right ? 'right' : 'left', 'middle', 11);
  }

  function handleDot(p, r, fill, stroke2, lw) {
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, TAU);
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.lineWidth = lw;
    ctx.strokeStyle = stroke2;
    ctx.stroke();
  }

  /* The reveal draws the exact image of the face's inscribed circle
     (closed-form conic, not a fit) and the real axle: the face
     normal in 3D, projected through the same camera. */
  function drawTruth(c) {
    var t = scene.truth, ax = scene.axle, nt = normEllipse(t);
    ctx.save();
    ctx.lineJoin = 'round';
    /* watercolor halo in the wash rose, the answer itself in the
       graphite-weight rose so it clears AA on the paper sheet too */
    ctx.strokeStyle = c.accent;
    ctx.globalAlpha = 0.28;
    ctx.lineWidth = 6;
    ellipsePath(t);
    ctx.stroke();
    ctx.strokeStyle = c.line;
    ctx.globalAlpha = 1;
    ctx.lineWidth = 2.2;
    ellipsePath(t);
    ctx.stroke();
    ctx.restore();

    var L = nt.b * 1.55 + 10;
    ctx.save();
    ctx.strokeStyle = c.ink;
    ctx.globalAlpha = 0.8;
    ctx.setLineDash([5, 4]);
    ctx.lineWidth = 1.4;
    line(ax.x - ax.dx * L, ax.y - ax.dy * L, ax.x + ax.dx * L, ax.y + ax.dy * L);
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
    ctx.fillStyle = c.ink;
    ctx.beginPath();
    ctx.arc(ax.x, ax.y, 2.6, 0, TAU);
    ctx.fill();
    ctx.restore();
    /* name both at once, on the picture that defines them: the dashed line
       IS the axle, and the ellipse's short way across lies along it.
       Clamped by its own measured width — the old fixed 96px margin was
       narrower than half this label, so its left end hung off the sheet
       whenever the axle pointed left. */
    var axleTxt = 'axle · the minor (short) axis lies along it';
    var axleHalf = textHalfWidth(axleTxt, 10);
    inkText(c, axleTxt,
      clamp(ax.x + ax.dx * (L + 6),
        Math.min(axleHalf + 4, W / 2), Math.max(W - axleHalf - 4, W / 2)),
      clamp(ax.y + ax.dy * (L + 6), 10, H - 10), 'center', 'middle', 10);

    var yext = Math.sqrt(Math.pow(t.a * Math.sin(t.theta), 2) +
      Math.pow(t.b * Math.cos(t.theta), 2));
    var below = t.cy + yext + 14 <= H - 26;
    var y0 = below ? t.cy + yext + 14 : t.cy - yext - 32;
    /* "b/a" was algebra, and it was the first thing a beginner met on the
       first reveal of their first round. The number is the same number;
       it just says which two things it is comparing. Centred text has to
       be clamped by its own measured half-width or a long label runs off
       a 330px sheet. */
    var trueTxt = 'true ' + Math.round(degreeOf(t)) + '° · short ' +
      (nt.b / Math.max(1e-9, nt.a)).toFixed(2) + ' of long';
    var half = textHalfWidth(trueTxt, 12);
    var x0 = clamp(t.cx, Math.min(half + 4, W / 2), Math.max(W - half - 4, W / 2));
    inkText(c, trueTxt, x0, clamp(y0, 6, H - 22), 'center', 'top', 12);
    if (player) {
      inkText(c, 'you ' + Math.round(degreeOf(player)) + '°',
        x0, clamp(y0 + 15, 21, H - 6), 'center', 'top', 12);
    }
  }

  /* ---- input: one pointer either drags one handle or draws ---- */

  /* handle hit radius: 48px-wide targets on a mouse, wider on a pen
     tablet (the hand is out of sight) and on a fingertip */
  function hitR() { return ArtDaily.startRadius(24); }
  var drag = null;
  var dragType = '', lastPenAt = 0;

  /* Palm rejection: a pen press takes the sheet off a touch that is
     mid-stroke (its ink is dropped — it was a palm, not a player), and a
     touch press is ignored for a moment after any pen. */
  function palmBlocked(ev) {
    return ev.pointerType === 'touch' && lastPenAt && (Date.now() - lastPenAt) < 1200;
  }

  /* Drop whatever pointer is in flight. A second finger can press “new
     round”, flip the mode or resize the sheet while the first is still
     down; without this the grab offset outlives the item it belonged
     to and the grabbing cursor sticks. */
  function cancelPointer() {
    if (stroke) { try { canvas.releasePointerCapture(stroke.id); } catch (e) {} stroke = null; }
    if (drag) { try { canvas.releasePointerCapture(drag.id); } catch (e) {} drag = null; }
    dragType = '';
    canvas.classList.remove('dragging');
  }

  /* One rect per EVENT, not one per sample: a 240Hz pen hands over a dozen
     coalesced positions in a single dispatch, and measuring the canvas box
     a dozen times to convert them is a dozen forced layouts for an answer
     that cannot have changed in between. */
  function pointerPos(ev, rect) {
    var r = rect || canvas.getBoundingClientRect();
    return { x: ev.clientX - r.left, y: ev.clientY - r.top };
  }

  /* Every position the hardware actually recorded, not only the ones the
     browser chose to dispatch. A sweep is fast, and between two delivered
     moves a real hand may have travelled a quarter of the arc through
     three recorded samples. Without them the ink is the chord across that
     gap: the conic is fitted to a polygon instead of a curve, and
     strokeCoverage — which decides whether the sweep counts as having gone
     round at all — reads the gap as ground never covered.
     ArtDaily.samples is that pattern once, guarded; this drill used to
     hand-roll it, and an engine that throws out of getCoalescedEvents took
     the whole pointermove handler — and so the live sweep — down with it. */

  /* Sub-pixel repeats are not shape. strokeCoverage bins them into the arc
     they already filled, so dropping them cannot cost a sweep any ground —
     but the conic fit is a least-squares over the points, and it weights
     every copy, so a hand resting for half a second used to pull the whole
     ellipse toward wherever it rested. */
  function addSample(pts, p) {
    var last = pts.length ? pts[pts.length - 1] : null;
    if (last && Math.abs(p.x - last.x) < 1 && Math.abs(p.y - last.y) < 1) return;
    pts.push(p);
  }

  function pickHandle(px, py) {
    var E = player, hp = handlePts();
    var cand = [
      ['r0', hp.r0.x, hp.r0.y, 0],
      ['r1', hp.r1.x, hp.r1.y, 0],
      ['m', hp.m.x, hp.m.y, 0],
      ['c', E.cx, E.cy, 4], /* centre yields to overlapping rim handles,
                               but keeps a >= 40px effective target */
    ];
    var best = null, i, d, reach = hitR();
    for (i = 0; i < cand.length; i++) {
      d = Math.hypot(px - cand[i][1], py - cand[i][2]) + cand[i][3];
      if (d < reach && (!best || d < best.d)) best = { kind: cand[i][0], d: d };
    }
    if (best) return best.kind;
    /* in handles mode, anywhere inside the plate drags the whole plate;
       in draw mode that surface belongs to the pencil instead */
    if (mode === 'draw') return null;
    var cs = Math.cos(E.theta), sn = Math.sin(E.theta);
    var rx = px - E.cx, ry = py - E.cy;
    var lx = (rx * cs + ry * sn) / Math.max(1e-9, E.a);
    var ly = (-rx * sn + ry * cs) / Math.max(1e-9, E.b);
    return (lx * lx + ly * ly <= 1.2) ? 'c' : null;
  }

  /* A lifted sweep is an UNFINISHED sweep, not a failed one. The segment
     that just ended is banked, the ink stays on the sheet, and the fit is
     tried against every segment together — so two half-arcs read as one
     ellipse. Nothing is ever silently discarded, and the message says what
     is actually missing rather than accusing the player of a mistake their
     hardware made. */
  function finishStroke() {
    var seg = stroke.pts;
    stroke = null;
    canvas.classList.remove('dragging');
    if (!sweep) sweep = { segs: [], liftAt: 0, liftPt: null };
    if (seg.length > 1) sweep.segs.push(seg);
    sweep.liftAt = Date.now();
    sweep.liftPt = seg[seg.length - 1];
    var pts = sweepPts();
    if (pathLen(pts) < 24) { draw(); return; }   /* a tap, not a sweep */
    var e = fitEllipseToStroke(pts);
    var cov = e ? strokeCoverage(pts, e) : 0;
    var fitOk = e && isFinite(e.theta) && e.a > 8 && e.b > 3 && e.a < 2 * Math.max(W, H);
    if (!fitOk || cov < coverMin()) {
      missedClosure += 1;
      /* two different failures, two different truths */
      hint.textContent = !fitOk
        ? 'that loop crossed itself — one smooth pass round the face, and keep going: ' +
          'a lift does not end it, press near where you stopped to carry on.'
        : 'you are ' + Math.round(cov * 100) + '% of the way round — press near where you ' +
          'stopped and keep sweeping. the halves count as one ellipse.';
      if (missedClosure >= 2 && mode === 'draw') {
        hint.textContent += ' (or press “switch to handles ⊹” and drag one into place instead.)';
      }
      draw();
      return;
    }
    var E = normEllipse(e);
    E.a = clamp(E.a, 14, 0.62 * Math.min(W, H));
    E.b = clamp(E.b, 5, E.a);
    player = E;
    missedClosure = 0;
    sweep = null;           /* accepted: the plate takes over from the ink */
    clampCentre(player);
    syncLock();
    hint.textContent = itemHint();
    draw();
  }

  canvas.addEventListener('pointerdown', function (ev) {
    if (ev.pointerType === 'pen') lastPenAt = Date.now();
    if (palmBlocked(ev)) return;
    ev.preventDefault();
    canvas.focus();
    if (state !== 'aim') return;
    if (drag || stroke) {
      /* the pen is the hand that meant it: it takes the sheet off a touch
         mid-stroke, and that touch's ink goes with it */
      if (!(ev.pointerType === 'pen' && dragType === 'touch')) return;
      if (stroke) sweep = null;
      cancelPointer();
    }
    var p = pointerPos(ev);
    var kind = player ? pickHandle(p.x, p.y) : null;
    if (kind) {
      grabbed = true;
      dragType = ev.pointerType;
      drag = { id: ev.pointerId, kind: kind, gx: p.x - player.cx, gy: p.y - player.cy };
      try { canvas.setPointerCapture(ev.pointerId); } catch (e) {}
      canvas.classList.add('dragging');
      draw();
      return;
    }
    if (mode !== 'draw') return;
    /* carry on the same sweep when the press lands near where the last one
       lifted, soon after; otherwise this is a fresh attempt */
    var carry = sweep && sweep.liftPt && (Date.now() - sweep.liftAt) < RESUME_MS &&
      Math.hypot(p.x - sweep.liftPt.x, p.y - sweep.liftPt.y) <= ArtDaily.startRadius(50);
    if (!carry) { sweep = null; missedClosure = 0; }
    dragType = ev.pointerType;
    stroke = { id: ev.pointerId, pts: [p] };
    try { canvas.setPointerCapture(ev.pointerId); } catch (e) {}
    canvas.classList.add('dragging');
    draw();
  });

  canvas.addEventListener('pointermove', function (ev) {
    if (state !== 'aim') return;
    var p, rect;
    if (stroke && ev.pointerId === stroke.id) {
      ev.preventDefault();
      rect = canvas.getBoundingClientRect();
      var evs = ArtDaily.samples(ev), i;
      for (i = 0; i < evs.length; i++) {
        p = pointerPos(evs[i], rect);
        /* True coordinates, NOT clamped into the rect. Clamping wrote a
           straight run along the sheet edge into the point cloud whenever a
           finger overshot, which quietly dragged the fitted conic — a wrong
           ellipse with no message, which is worse than a rejection. Samples
           far outside the sheet are dropped instead. */
        if (!(Math.abs(p.x - W / 2) < 1.6 * W && Math.abs(p.y - H / 2) < 1.6 * H)) continue;
        /* A hand that pauses mid-sweep keeps emitting samples from the
           same spot. Those are not shape — they are a hundred copies of
           one point, and the least-squares conic weights every copy, so
           pausing on the near end of an arc quietly pulled the fit toward
           it. Sub-pixel repeats are ink the sheet already has. */
        addSample(stroke.pts, p);
      }
      draw();
      return;
    }
    if (!drag || ev.pointerId !== drag.id) return;
    ev.preventDefault();
    p = pointerPos(ev);
    var E = player, vx, vy, maxA = 0.62 * Math.min(W, H);
    if (drag.kind === 'c') {
      E.cx = p.x - drag.gx;
      E.cy = p.y - drag.gy;
      clampCentre(E);
    } else if (drag.kind === 'r0' || drag.kind === 'r1') {
      vx = p.x - E.cx; vy = p.y - E.cy;
      if (drag.kind === 'r1') { vx = -vx; vy = -vy; }
      E.a = clamp(Math.hypot(vx, vy), 14, maxA);
      E.theta = Math.atan2(vy, vx);
      if (E.b > E.a) E.b = E.a;
    } else {
      E.b = clamp(Math.hypot(p.x - E.cx, p.y - E.cy), 5, E.a);
    }
    draw();
  });

  function endPointer(ev) {
    if (stroke && ev.pointerId === stroke.id) {
      try { canvas.releasePointerCapture(stroke.id); } catch (e) {}
      dragType = '';
      if (ev.type === 'pointercancel') {
        stroke = null;
        canvas.classList.remove('dragging');
        draw();
      } else {
        /* THE TAIL OF A FAST SWEEP. pointerup carries a position of its
           own, and it is the only record of where the hand really stopped
           — the last pointermove can be most of a frame behind it. On the
           closing stretch of an arc that is the difference between a sweep
           that reads as having gone round and one the drill sends back. It
           also anchors lift-and-resume, which measures the next press
           against where you actually lifted. */
        if (typeof ev.clientX === 'number') addSample(stroke.pts, pointerPos(ev));
        finishStroke();
      }
      return;
    }
    if (!drag || ev.pointerId !== drag.id) return;
    try { canvas.releasePointerCapture(drag.id); } catch (e) {}
    drag = null;
    dragType = '';
    canvas.classList.remove('dragging');
  }
  canvas.addEventListener('pointerup', endPointer);
  canvas.addEventListener('pointercancel', endPointer);
  /* a pointerup lost outside the canvas used to block every later press
     until the next item, because pointerdown returns early while one is
     in flight */
  window.addEventListener('pointerup', endPointer);
  window.addEventListener('pointercancel', endPointer);

  /* keyboard: enter locks / advances / starts the next round,
     arrows move, [ ] tilt, - = major, , . minor, r starts over */
  canvas.addEventListener('keydown', function (ev) {
    var k = ev.key;
    if (k === 'Enter') {
      ev.preventDefault();
      if (state === 'aim') lockIn();
      else if (roundOver) newRound();
      else advance();
      return;
    }
    if (state !== 'aim') return;
    /* R is "start this plate over" in both modes: in draw mode that
       means an empty sheet to sweep again, in handles mode a fresh
       gizmo — either way no misplacement is ever a dead end. */
    if (k === 'r' || k === 'R') {
      ev.preventDefault();
      cancelPointer();
      sweep = null;
      missedClosure = 0;
      player = (mode === 'draw' || !scene) ? null : initPlayer(scene);
      syncLock();
      hint.textContent = itemHint();
      draw();
      return;
    }
    if (!player) return;
    var E = player, step = ev.shiftKey ? 10 : 2, rot = radians(ev.shiftKey ? 6 : 1.5);
    var used = true;
    if (k === 'ArrowLeft') { E.cx -= step; clampCentre(E); }
    else if (k === 'ArrowRight') { E.cx += step; clampCentre(E); }
    else if (k === 'ArrowUp') { E.cy -= step; clampCentre(E); }
    else if (k === 'ArrowDown') { E.cy += step; clampCentre(E); }
    else if (k === '[') E.theta -= rot;
    else if (k === ']') E.theta += rot;
    else if (k === '-') { E.a = Math.max(14, E.a - step); if (E.b > E.a) E.b = E.a; }
    else if (k === '=') E.a = Math.min(0.62 * Math.min(W, H), E.a + step);
    else if (k === ',') E.b = Math.max(5, E.b - step);
    else if (k === '.') E.b = Math.min(E.a, E.b + step);
    else used = false;
    if (used) { grabbed = true; ev.preventDefault(); draw(); }
  });

  btnLock.addEventListener('click', function () {
    if (btnLock.disabled) return;
    if (state === 'aim') lockIn(); else advance();
  });

  btnMode.addEventListener('click', function () {
    mode = (mode === 'draw') ? 'handles' : 'draw';
    modeChosen = true;
    try { localStorage.setItem(MODE_KEY, mode); } catch (e) {}
    syncMode();
    if (state !== 'aim') return;
    cancelPointer();
    sweep = null;
    missedClosure = 0;
    /* handles mode always has a plate to grab; switching back to draw
       keeps the one you already have. Label the sticker for the mode we
       are now in BEFORE measuring it, then re-clamp the plate against
       its real box — same order startItem() uses. */
    if (mode === 'handles' && !player && scene) player = initPlayer(scene);
    syncLock();
    measureLock();
    if (player) clampCentre(player);
    hint.textContent = itemHint();
    draw();
  });

  var toastTimer = null;
  function showToast(msg, celebrate) {
    toast.innerHTML = '';
    var s = document.createElement('span');
    s.className = celebrate ? 'toast-accent' : '';
    s.textContent = msg;
    toast.appendChild(s);
    toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toast.hidden = true; }, 2200);
  }

  /* ---- chrome wiring ---- */
  /* "new round" arms first when it would throw away a live round — a
     second press within the window confirms, otherwise it snaps back.
     An unfinished round is never reported, so a mis-tap here used to
     bin every face scored so far without a word. (The five sibling
     drills all guard this button; this one did not.) */
  var btnRound = document.getElementById('btnRound');
  var roundArmTimer = null, roundArmed = false;
  function disarmRoundBtn() {
    roundArmed = false;
    clearTimeout(roundArmTimer);
    btnRound.innerHTML = 'new round <span aria-hidden="true">↻</span>';
  }
  btnRound.addEventListener('click', function () {
    if (itemScores.length && !roundOver && !roundArmed) {
      roundArmed = true;
      btnRound.textContent = 'discard round?';
      roundArmTimer = setTimeout(disarmRoundBtn, 2600);
      return;
    }
    disarmRoundBtn();
    newRound();
  });

  var btnHow = document.getElementById('btnHow');
  var howTo = document.getElementById('howTo');
  btnHow.addEventListener('click', function () {
    howTo.hidden = !howTo.hidden;
    btnHow.setAttribute('aria-expanded', String(!howTo.hidden));
  });

  ArtDaily.onTheme(function () { inkCache = null; paintNow(); });
  /* the hardware can change mid-session (an iPad user picks up the
     pencil): handle reach, the closure rule and the free zone follow it */
  ArtDaily.onInput(draw);

  /* Resizing re-projects the scene; the player's ellipse rides along
     through the same similarity change so nothing is lost. A resize that
     did not change the sheet is not a resize: an address bar sliding on a
     phone used to cancel the sweep in flight, re-project the box and
     rescale the plate for nothing. */
  var resizeRaf = 0;
  function onResize() {
    resizeRaf = 0;
    var oldT = scene ? scene.T : null;
    if (!fitCanvas()) return;   /* nothing moved, and nothing was cleared */
    cancelPointer();
    measureLock();
    if (scene && oldT) {
      layoutScene(scene, W, H);
      if (player) {
        var r = scene.T.k / oldT.k;
        player.cx = scene.T.tx + (player.cx - oldT.tx) * r;
        player.cy = scene.T.ty + (player.cy - oldT.ty) * r;
        player.a *= r;
        player.b *= r;
        clampCentre(player);
      }
    }
    paintNow();   /* fitCanvas already blanked the sheet — no empty frame */
  }
  window.addEventListener('resize', function () {
    if (resizeRaf) return;
    resizeRaf = requestAnimationFrame(onResize);
  });

  /* ---- boot ---- */
  fitCanvas();
  syncMode();
  var best = ArtDaily.best();
  hudBest.textContent = best === null ? '–' : String(best);
  newRound();
})();
