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
     ellipse reads 100 instead of 96 — and the scale starts there. */
  var FREE = 0.02;

  /* Item score 0–100 plus the three error terms that made it, so the
     reveal can say WHICH way you were wrong. Angle error is weighted
     by the truth's eccentricity: a near-circular truth makes its axis
     direction meaningless, so the weight fades to zero. */
  function scoreItem(player, truth, faceDiag) {
    var p = normEllipse(player), t = normEllipse(truth);
    var centreErr = Math.hypot(p.cx - t.cx, p.cy - t.cy) / Math.max(1e-9, faceDiag);
    var angErrDeg = foldAngleDeg((p.theta - t.theta) * 180 / Math.PI);
    var wAng = clamp((1 - t.b / Math.max(1e-9, t.a)) * 2, 0, 1);
    var sizeErr = (Math.abs(p.a - t.a) / Math.max(1e-9, t.a)
      + Math.abs(p.b - t.b) / Math.max(1e-9, t.b)) / 2;
    var centre = 1.4 * centreErr;
    var angle = wAng * (angErrDeg / 90) * 0.8;
    var size = sizeErr;
    var err = Math.max(0, centre + angle + size - FREE) / 0.55;
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
  function genItem3D(idx) {
    var s = 1, side = Math.random() < 0.5 ? -1 : 1;
    var yaw, C, faceAxis, faceSign, depr, alpha, Cz;
    if (idx === 0) {
      yaw = side * radians(rand(20, 40));
      depr = radians(rand(44, 56));
      Cz = rand(4.6, 5.4);
      C = { x: rand(-0.3, 0.3), y: -Math.tan(depr) * Cz - 0.5 * s, z: Cz };
      faceAxis = 1; faceSign = 1;
    } else {
      alpha = idx === 1 ? rand(48, 56) : rand(62, 75);
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
  function inks() {
    var cs = getComputedStyle(document.documentElement);
    var accent = cs.getPropertyValue('--game-accent').trim() || cs.getPropertyValue('--bubblegum').trim();
    return {
      ink: cs.getPropertyValue('--ink').trim(),
      muted: cs.getPropertyValue('--muted').trim(),
      accent: accent,
      line: cs.getPropertyValue('--game-line').trim() || accent,
      card: cs.getPropertyValue('--card').trim(),
    };
  }

  /* ---- crisp canvas at any devicePixelRatio; height tracks width ---- */
  var W = 0, H = 0;
  function fitCanvas() {
    var rect = canvas.getBoundingClientRect();
    W = Math.max(1, Math.round(rect.width));
    H = Math.round(W * 0.62);
    var dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    canvas.style.height = H + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  /* ---- round state ---- */
  var round = 0, itemIdx = 0, itemScores = [], roundOver = false, reported = false;
  var scene = null, player = null, state = 'idle'; /* idle | aim | reveal */
  var stroke = null;      /* live freehand points, draw mode */
  var grabbed = false;    /* first handle touch retires the micro-labels */
  var mode = (function () {
    var v = null;
    try { v = localStorage.getItem(MODE_KEY); } catch (e) {}
    return v === 'handles' ? 'handles' : 'draw';
  })();

  var ITEM_NOTE = [
    'face 1 of 3 — the open top, a plate lying on a table.',
    'face 2 of 3 — a turned side, so steeper.',
    'face 3 of 3 — a narrow one: the minor axis runs down the axle, the line straight out of the face.',
  ];

  function itemHint() {
    var verb;
    if (mode === 'draw') {
      verb = player
        ? 'redraw over it, or nudge the handles, then lock it in.'
        : 'sweep the ellipse onto the tinted face in one closed stroke.';
    } else {
      verb = 'drag the plate onto the tinted face — centre moves, rim handles set length and tilt, the small one sets width — then lock it in.';
    }
    return ITEM_NOTE[itemIdx] + ' ' + verb;
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

  function syncMode() {
    btnMode.textContent = mode === 'draw' ? 'mode: draw ✎' : 'mode: handles ⊹';
    btnMode.setAttribute('aria-pressed', String(mode === 'draw'));
    btnMode.title = mode === 'draw'
      ? 'freehand — sweep the whole ellipse in one stroke'
      : 'gizmo — drag the centre, the rim handles and the width handle';
  }

  function startItem(idx) {
    itemIdx = idx;
    scene = layoutScene(genItem3D(idx), W, H);
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
    draw();
  }

  function newRound() {
    round += 1;
    itemScores = [];
    roundOver = false;
    reported = false;
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
    var r = scoreItem(player, scene.truth, scene.faceDiag);
    itemScores.push(r.score);
    state = 'reveal';
    cancelPointer();
    var head = Math.round(r.score) + '/100 — a ' + Math.round(degreeOf(scene.truth)) +
      '° ellipse. ' + missNote(r, player, scene.truth);
    if (itemIdx < ITEMS_PER_ROUND - 1) {
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
        showToast((res.isNewBest ? 'new best! ' : 'score ') + res.score + ' / 100', res.isNewBest);
      }
      hint.textContent = head + ' round done — faces ' + scoreList() +
        '. press “new round” (or enter) to go again.';
    }
    draw();
  }

  function advance() {
    if (state === 'reveal' && !roundOver && itemIdx < ITEMS_PER_ROUND - 1) {
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

  function draw() {
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
      if (stroke) drawStroke(c);
      if (!player && !stroke && mode === 'draw') {
        inkText(c, '✎ drag anywhere to sweep your ellipse', 10, H - 8, 'left', 'bottom', 11);
      }
      if (player && !grabbed && round === 1 && itemIdx === 0) drawHandleLabels(c);
    } else if (state === 'reveal') {
      if (player) drawPlayer(c, false);
      drawTruth(c);
    }
  }

  function drawStroke(c) {
    var p = stroke.pts, i;
    if (p.length < 2) return;
    ctx.save();
    ctx.strokeStyle = c.ink;
    ctx.globalAlpha = 0.8;
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(p[0].x, p[0].y);
    for (i = 1; i < p.length; i++) ctx.lineTo(p[i].x, p[i].y);
    ctx.stroke();
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

    var yext = Math.sqrt(Math.pow(t.a * Math.sin(t.theta), 2) +
      Math.pow(t.b * Math.cos(t.theta), 2));
    var below = t.cy + yext + 14 <= H - 26;
    var y0 = below ? t.cy + yext + 14 : t.cy - yext - 32;
    var x0 = clamp(t.cx, 86, W - 86);
    inkText(c, 'true ' + Math.round(degreeOf(t)) + '° · b/a ' +
      (nt.b / Math.max(1e-9, nt.a)).toFixed(2), x0, clamp(y0, 6, H - 22), 'center', 'top', 12);
    if (player) {
      inkText(c, 'you ' + Math.round(degreeOf(player)) + '°',
        x0, clamp(y0 + 15, 21, H - 6), 'center', 'top', 12);
    }
  }

  /* ---- input: one pointer either drags one handle or draws ---- */

  var HIT = 24; /* handle hit radius: 48px-wide touch targets */
  var drag = null;

  /* Drop whatever pointer is in flight. A second finger can press “new
     round”, flip the mode or resize the sheet while the first is still
     down; without this the grab offset outlives the item it belonged
     to and the grabbing cursor sticks. */
  function cancelPointer() {
    if (stroke) { try { canvas.releasePointerCapture(stroke.id); } catch (e) {} stroke = null; }
    if (drag) { try { canvas.releasePointerCapture(drag.id); } catch (e) {} drag = null; }
    canvas.classList.remove('dragging');
  }

  function pointerPos(ev) {
    var rect = canvas.getBoundingClientRect();
    return { x: ev.clientX - rect.left, y: ev.clientY - rect.top };
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
    var best = null, i, d;
    for (i = 0; i < cand.length; i++) {
      d = Math.hypot(px - cand[i][1], py - cand[i][2]) + cand[i][3];
      if (d < HIT && (!best || d < best.d)) best = { kind: cand[i][0], d: d };
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

  function finishStroke() {
    var pts = stroke.pts, i, len = 0;
    stroke = null;
    canvas.classList.remove('dragging');
    for (i = 1; i < pts.length; i++) {
      len += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    }
    if (len < 24) { draw(); return; }   /* a tap, not a stroke */
    var e = fitEllipseToStroke(pts);
    var ok = e && isFinite(e.theta) && e.a > 8 && e.b > 3 &&
      e.a < 2 * Math.max(W, H) && strokeCoverage(pts, e) >= 0.75;
    if (!ok) {
      hint.textContent = 'that stroke never closed — sweep all the way round, back to where you started.';
      draw();
      return;
    }
    var E = normEllipse(e);
    E.a = clamp(E.a, 14, 0.62 * Math.min(W, H));
    E.b = clamp(E.b, 5, E.a);
    player = E;
    clampCentre(player);
    syncLock();
    hint.textContent = itemHint();
    draw();
  }

  canvas.addEventListener('pointerdown', function (ev) {
    ev.preventDefault();
    canvas.focus();
    if (state !== 'aim' || drag || stroke) return;
    var p = pointerPos(ev);
    var kind = player ? pickHandle(p.x, p.y) : null;
    if (kind) {
      grabbed = true;
      drag = { id: ev.pointerId, kind: kind, gx: p.x - player.cx, gy: p.y - player.cy };
      try { canvas.setPointerCapture(ev.pointerId); } catch (e) {}
      canvas.classList.add('dragging');
      draw();
      return;
    }
    if (mode !== 'draw') return;
    stroke = { id: ev.pointerId, pts: [p] };
    try { canvas.setPointerCapture(ev.pointerId); } catch (e) {}
    canvas.classList.add('dragging');
    draw();
  });

  canvas.addEventListener('pointermove', function (ev) {
    if (state !== 'aim') return;
    var p;
    if (stroke && ev.pointerId === stroke.id) {
      ev.preventDefault();
      p = pointerPos(ev);
      stroke.pts.push({ x: clamp(p.x, 0, W), y: clamp(p.y, 0, H) });
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
      if (ev.type === 'pointercancel') {
        stroke = null;
        canvas.classList.remove('dragging');
        draw();
      } else {
        finishStroke();
      }
      return;
    }
    if (!drag || ev.pointerId !== drag.id) return;
    try { canvas.releasePointerCapture(drag.id); } catch (e) {}
    drag = null;
    canvas.classList.remove('dragging');
  }
  canvas.addEventListener('pointerup', endPointer);
  canvas.addEventListener('pointercancel', endPointer);

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
    try { localStorage.setItem(MODE_KEY, mode); } catch (e) {}
    syncMode();
    if (state !== 'aim') return;
    cancelPointer();
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
  document.getElementById('btnRound').addEventListener('click', newRound);

  var btnHow = document.getElementById('btnHow');
  var howTo = document.getElementById('howTo');
  btnHow.addEventListener('click', function () {
    howTo.hidden = !howTo.hidden;
    btnHow.setAttribute('aria-expanded', String(!howTo.hidden));
  });

  ArtDaily.onTheme(draw);

  /* Resizing re-projects the scene; the player's ellipse rides along
     through the same similarity change so nothing is lost. */
  window.addEventListener('resize', function () {
    var oldT = scene ? scene.T : null;
    cancelPointer();
    fitCanvas();
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
    draw();
  });

  /* ---- boot ---- */
  fitCanvas();
  syncMode();
  var best = ArtDaily.best();
  hudBest.textContent = best === null ? '–' : String(best);
  newRound();
})();
