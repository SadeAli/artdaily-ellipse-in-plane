/* ============================================================
   game.js — Ellipse in Plane.
   A 2-VP box is drawn with one face tinted; the player lays an
   adjustable ellipse onto it like a plate on a table (or a wheel
   on an axle) and locks it in. Ground truth is the face's
   inscribed circle, projected through the same camera — so the
   reveal shows exactly the ellipse perspective demands.
   Three faces per round, each more foreshortened than the last.
   ============================================================ */
(function () {
  'use strict';

  var SLUG = 'ellipse-in-plane';
  var ITEMS_PER_ROUND = 3;
  var CIRCLE_SAMPLES = 64;
  var TAU = Math.PI * 2;

  var canvas = document.getElementById('gameCanvas');
  var ctx = canvas.getContext('2d');
  var hint = document.getElementById('hint');
  var toast = document.getElementById('toast');
  var hudRound = document.getElementById('hudRound');
  var hudScore = document.getElementById('hudScore');
  var hudBest = document.getElementById('hudBest');
  var btnLock = document.getElementById('btnLock');

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

  /* Ellipse through sampled points of a projected circle: centre =
     mean, axes from the 2x2 covariance eigen-decomposition (points
     uniform in circle angle -> semi-axis = sqrt(2 * eigenvalue)).
     A faithful ellipse for a perspective-projected circle at these
     scales. */
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

  /* Item score 0–100. Angle error is weighted by the truth's
     eccentricity: a near-circular truth makes its axis direction
     meaningless, so the weight fades to zero. */
  function scoreItem(player, truth, faceDiag) {
    var p = normEllipse(player), t = normEllipse(truth);
    var centreErr = Math.hypot(p.cx - t.cx, p.cy - t.cy) / Math.max(1e-9, faceDiag);
    var angErrDeg = foldAngleDeg((p.theta - t.theta) * 180 / Math.PI);
    var wAng = clamp((1 - t.b / Math.max(1e-9, t.a)) * 2, 0, 1);
    var sizeErr = (Math.abs(p.a - t.a) / Math.max(1e-9, t.a)
      + Math.abs(p.b - t.b) / Math.max(1e-9, t.b)) / 2;
    var err = (1.4 * centreErr + wAng * (angErrDeg / 90) * 0.8 + sizeErr) / 0.55;
    var s = 100 * clamp(1 - err, 0, 1);
    return isFinite(s) ? s : 0;
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
    var n = axArr[faceAxis];
    var F = {
      x: C.x + 0.5 * s * faceSign * n.x,
      y: C.y + 0.5 * s * faceSign * n.y,
      z: C.z + 0.5 * s * faceSign * n.z,
    };
    var e1 = axArr[(faceAxis + 1) % 3], e2 = axArr[(faceAxis + 2) % 3];
    var circle3 = [], i, t, ct, st;
    for (i = 0; i < CIRCLE_SAMPLES; i++) {
      t = i / CIRCLE_SAMPLES * TAU;
      ct = Math.cos(t); st = Math.sin(t);
      circle3.push({
        x: F.x + 0.5 * s * (ct * e1.x + st * e2.x),
        y: F.y + 0.5 * s * (ct * e1.y + st * e2.y),
        z: F.z + 0.5 * s * (ct * e1.z + st * e2.z),
      });
    }
    return {
      box: box, vis: vis, faceAxis: faceAxis, faceSign: faceSign,
      faceIdx: faceIndices(faceAxis, faceSign), circle3: circle3,
    };
  }

  /* Project the scene and fit it into a w×h canvas. The similarity
     transform is uniform, so the projected circle stays the exact
     conic perspective produces — ground truth survives layout. */
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
    sc.samples = [];
    for (i = 0; i < sc.circle3.length; i++) sc.samples.push(applyT(T, project(sc.circle3[i])));
    sc.truth = fitEllipseFromPoints(sc.samples);
    sc.faceDiag = faceDiagOf(sc.quad);
    sc.horizonY = T.ty; /* eye level projects to camera y = 0 */
    return sc;
  }

  /* ============================================================
     Canvas + DOM from here down.
     ============================================================ */

  function inks() {
    var cs = getComputedStyle(document.documentElement);
    return {
      ink: cs.getPropertyValue('--ink').trim(),
      muted: cs.getPropertyValue('--muted').trim(),
      accent: cs.getPropertyValue('--game-accent').trim() || cs.getPropertyValue('--bubblegum').trim(),
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
  var round = 0, itemIdx = 0, itemScores = [], roundOver = false;
  var scene = null, player = null, state = 'idle'; /* idle | aim | reveal */

  var ITEM_HINTS = [
    'face 1 of 3 — lay the plate on the tinted face, then lock it in.',
    'face 2 of 3 — steeper now. centre first, then tilt, then size.',
    'face 3 of 3 — a narrow one. aim the minor axis down the axle.',
  ];

  function initPlayer(sc) {
    var f = { x: 0, y: 0 }, i;
    for (i = 0; i < 4; i++) { f.x += sc.quad[i].x / 4; f.y += sc.quad[i].y / 4; }
    var a0 = clamp(0.3 * sc.faceDiag, 20, 0.4 * H);
    var cy0 = f.y + 0.55 * sc.faceDiag;
    if (cy0 > H - 30) cy0 = f.y - 0.55 * sc.faceDiag;
    return {
      cx: clamp(f.x + rand(-0.08, 0.08) * sc.faceDiag, 36, W - 36),
      cy: clamp(cy0, 30, H - 30),
      a: a0, b: 0.62 * a0, theta: 0,
    };
  }

  function startItem(idx) {
    itemIdx = idx;
    scene = layoutScene(genItem3D(idx), W, H);
    player = initPlayer(scene);
    state = 'aim';
    btnLock.hidden = false;
    btnLock.textContent = 'lock it in';
    hint.textContent = ITEM_HINTS[idx];
    draw();
  }

  function newRound() {
    round += 1;
    itemScores = [];
    roundOver = false;
    hudRound.textContent = String(round);
    hudScore.textContent = '–';
    startItem(0);
  }

  function lockIn() {
    if (state !== 'aim') return;
    var sc = scoreItem(player, scene.truth, scene.faceDiag);
    itemScores.push(sc);
    state = 'reveal';
    var deg = Math.round(degreeOf(scene.truth));
    var summary = 'a ' + deg + '° ellipse — ' + Math.round(sc) + '/100. ';
    if (itemIdx < ITEMS_PER_ROUND - 1) {
      btnLock.textContent = 'next face →';
      hint.textContent = summary + 'study the delta, then next face.';
    } else {
      roundOver = true;
      btnLock.hidden = true;
      var res = ArtDaily.report(roundScore(itemScores));
      hudScore.textContent = String(res.score);
      hudBest.textContent = res.best === null ? '–' : String(res.best);
      hint.textContent = summary + 'round done — “new round” to go again.';
      showToast((res.isNewBest ? 'new best! ' : 'score ') + res.score + ' / 100', res.isNewBest);
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
      ctx.globalAlpha = 0.5;
      ctx.lineWidth = 1;
      ctx.setLineDash([2, 5]);
      line(0, scene.horizonY, W, scene.horizonY);
      ctx.restore();
    }

    ctx.save();
    ctx.strokeStyle = c.muted;
    ctx.globalAlpha = 0.45;
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    for (i = 0; i < EDGES.length; i++) {
      e = EDGES[i];
      if (!edgeVisible(scene, e)) line(scene.pts[e[0]].x, scene.pts[e[0]].y, scene.pts[e[1]].x, scene.pts[e[1]].y);
    }
    ctx.restore();

    ctx.save();
    ctx.fillStyle = c.accent;
    ctx.globalAlpha = 0.13;
    pathPoly(scene.quad);
    ctx.fill();
    ctx.globalAlpha = 0.55;
    ctx.strokeStyle = c.accent;
    ctx.lineWidth = 1.3;
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

    if (state === 'aim') drawPlayer(c, true);
    else if (state === 'reveal') { drawPlayer(c, false); drawTruth(c); }
  }

  function drawPlayer(c, withHandles) {
    var E = player;
    ctx.save();
    ctx.translate(E.cx, E.cy);
    ctx.rotate(E.theta);
    ctx.strokeStyle = withHandles ? c.ink : c.muted;
    ctx.globalAlpha = 0.35;
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
    handleDot(hp.m, 6.5, c.card, c.accent, 2.5);
    ctx.restore();
  }

  function handleDot(p, r, fill, stroke, lw) {
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, TAU);
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.lineWidth = lw;
    ctx.strokeStyle = stroke;
    ctx.stroke();
  }

  /* The reveal draws the fitted truth ellipse — the exact shape the
     score compares against, so matching it perfectly is a 100. It
     sits within a couple of pixels of the raw projected circle (the
     camera distances are chosen to keep the fit faithful). */
  function drawTruth(c) {
    var t = scene.truth;
    ctx.save();
    ctx.strokeStyle = c.accent;
    ctx.lineJoin = 'round';
    /* watercolor halo under the true circle */
    ctx.globalAlpha = 0.28;
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.ellipse(t.cx, t.cy, t.a, t.b, t.theta, 0, TAU);
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    ctx.ellipse(t.cx, t.cy, t.a, t.b, t.theta, 0, TAU);
    ctx.stroke();
    /* the axle: the minor axis extended through the centre */
    var nx = -Math.sin(t.theta), ny = Math.cos(t.theta);
    var L = t.b * 1.55 + 8;
    ctx.setLineDash([5, 4]);
    ctx.lineWidth = 1.4;
    ctx.globalAlpha = 0.9;
    line(t.cx - nx * L, t.cy - ny * L, t.cx + nx * L, t.cy + ny * L);
    ctx.setLineDash([]);
    ctx.fillStyle = c.accent;
    ctx.beginPath();
    ctx.arc(t.cx, t.cy, 2.6, 0, TAU);
    ctx.fill();
    ctx.restore();

    var nt = normEllipse(t);
    var txt = Math.round(degreeOf(t)) + '° ellipse · minor/major ' + (nt.b / Math.max(1e-9, nt.a)).toFixed(2);
    ctx.save();
    ctx.font = '600 12px ui-monospace, Menlo, Consolas, monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    var yext = Math.sqrt(Math.pow(t.a * Math.sin(t.theta), 2) + Math.pow(t.b * Math.cos(t.theta), 2));
    var ay = t.cy + yext + 10;
    if (ay > H - 20) ay = t.cy - yext - 22;
    ctx.fillStyle = c.ink;
    ctx.globalAlpha = 0.85;
    ctx.fillText(txt, clamp(t.cx, 92, W - 92), ay);
    ctx.restore();
  }

  /* ---- input: one pointer drags one handle (pointerId-guarded) ---- */

  var HIT = 24; /* handle hit radius: 48px-wide touch targets */
  var drag = null;

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
    /* anywhere inside the plate drags the whole plate */
    var cs = Math.cos(E.theta), sn = Math.sin(E.theta);
    var rx = px - E.cx, ry = py - E.cy;
    var lx = (rx * cs + ry * sn) / Math.max(1e-9, E.a);
    var ly = (-rx * sn + ry * cs) / Math.max(1e-9, E.b);
    return (lx * lx + ly * ly <= 1.2) ? 'c' : null;
  }

  canvas.addEventListener('pointerdown', function (ev) {
    ev.preventDefault();
    canvas.focus();
    if (state !== 'aim' || drag) return;
    var p = pointerPos(ev);
    var kind = pickHandle(p.x, p.y);
    if (!kind) return;
    drag = { id: ev.pointerId, kind: kind, gx: p.x - player.cx, gy: p.y - player.cy };
    try { canvas.setPointerCapture(ev.pointerId); } catch (e) {}
    canvas.classList.add('dragging');
  });

  canvas.addEventListener('pointermove', function (ev) {
    if (!drag || ev.pointerId !== drag.id || state !== 'aim') return;
    ev.preventDefault();
    var p = pointerPos(ev);
    var E = player, vx, vy, maxA = 0.62 * Math.min(W, H);
    if (drag.kind === 'c') {
      E.cx = clamp(p.x - drag.gx, 12, W - 12);
      E.cy = clamp(p.y - drag.gy, 12, H - 12);
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

  function endDrag(ev) {
    if (!drag || ev.pointerId !== drag.id) return;
    try { canvas.releasePointerCapture(drag.id); } catch (e) {}
    drag = null;
    canvas.classList.remove('dragging');
  }
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);

  /* keyboard fallback: arrows move, [ ] tilt, - = major, , . minor */
  canvas.addEventListener('keydown', function (ev) {
    var k = ev.key;
    if (k === 'Enter') {
      ev.preventDefault();
      if (state === 'aim') lockIn(); else advance();
      return;
    }
    if (state !== 'aim') return;
    var E = player, step = ev.shiftKey ? 10 : 2, rot = radians(ev.shiftKey ? 6 : 1.5);
    var used = true;
    if (k === 'ArrowLeft') E.cx = clamp(E.cx - step, 12, W - 12);
    else if (k === 'ArrowRight') E.cx = clamp(E.cx + step, 12, W - 12);
    else if (k === 'ArrowUp') E.cy = clamp(E.cy - step, 12, H - 12);
    else if (k === 'ArrowDown') E.cy = clamp(E.cy + step, 12, H - 12);
    else if (k === '[') E.theta -= rot;
    else if (k === ']') E.theta += rot;
    else if (k === '-') { E.a = Math.max(14, E.a - step); if (E.b > E.a) E.b = E.a; }
    else if (k === '=') E.a = Math.min(0.62 * Math.min(W, H), E.a + step);
    else if (k === ',') E.b = Math.max(5, E.b - step);
    else if (k === '.') E.b = Math.min(E.a, E.b + step);
    else used = false;
    if (used) { ev.preventDefault(); draw(); }
  });

  btnLock.addEventListener('click', function () {
    if (state === 'aim') lockIn(); else advance();
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
    fitCanvas();
    if (scene && oldT) {
      layoutScene(scene, W, H);
      var r = scene.T.k / oldT.k;
      player.cx = scene.T.tx + (player.cx - oldT.tx) * r;
      player.cy = scene.T.ty + (player.cy - oldT.ty) * r;
      player.a *= r;
      player.b *= r;
    }
    draw();
  });

  /* ---- boot ---- */
  fitCanvas();
  var best = ArtDaily.best();
  hudBest.textContent = best === null ? '–' : String(best);
  newRound();
})();
