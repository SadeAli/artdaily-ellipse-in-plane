# Ellipse in Plane 🥏

Lay a correct ellipse onto the face of a 2-point-perspective box —
the plate-on-a-table / wheel-on-an-axle skill.

**Draw mode** (the default, and the studio version of this drill):
sweep the whole ellipse onto the highlighted face in one closed
stroke. The stroke is fitted to an ellipse by least squares, then the
handles appear so you can nudge it — or press `R` and draw it again.
**Handles mode** skips the stroke and gives you the gizmo: centre
moves the plate, the rim handles set major-axis length + tilt, the
small accent handle sets the minor axis. `R` starts the plate over in
either mode, so no misplacement is ever a dead end.

Three faces per round, each more foreshortened. After every lock the
true ellipse is revealed in the accent with its ellipse "degree", the
axle, and a one-line note naming whichever of placement / tilt / size
you missed by most — so you learn from the delta, not just the number.

## Ground truth is exact

The face's inscribed circle lives in 3D and is imaged by a real
pinhole camera. Rather than sample it and fit, `projectedCircle()`
builds the plane→screen homography (pinhole *and* the fit-to-canvas
similarity, both linear in homogeneous coordinates) and pushes the
conic `u² + v² − r² = 0` straight through it, so the revealed ellipse
is the image of that circle to floating-point precision — verified
against 512 densely projected samples. The revealed **axle** is the
face's real 3D normal line projected through the same camera, not the
2D minor axis extended.

## Scoring

Pure functions at the top of `js/game.js`, no canvas or DOM in sight.
`scoreItem()` returns the 0–100 score *and* the three error terms that
made it: centre offset (normalized by the face's mean projected
diagonal), axis angle (weighted down as the truth gets rounder, since
a circle's axis direction means nothing) and both radii. Everything
inside a small full-credit tolerance scores 100, so a genuinely nailed
ellipse reads 100. Round score is the mean of the three faces.

Run it: `python3 -m http.server 8080` in this folder, then open
`http://localhost:8080/`. Plain HTML/CSS/JS — no build, no deps.

Part of [Art Daily](https://artdaily.sadeali.com/) ·
more experiments at [sadeali.com](https://sadeali.com/).
