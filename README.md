# Ellipse in Plane 🥏

Lay a correct ellipse onto the face of a 2-point-perspective box —
the plate-on-a-table / wheel-on-an-axle skill.

**Draw mode** (the default, and the studio version of this drill):
sweep the whole ellipse onto the highlighted face. **A lift does not
end the sweep** — press again near where you stopped, within ~2.5s, and
the segments are fitted together as one ellipse, with coverage measured
over their union. A short-throw trackpad physically cannot pull a 250px
closed arc in one motion; the old rule discarded such an attempt
entirely and said "that stroke never closed", so the drill hard-failed
on the most common laptop. Nothing is discarded now: the ink stays, and
the message says how far round you actually got. The sweep is fitted to
an ellipse by least squares, then the handles appear so you can nudge it
— or press `R` and draw it again.

**Handles mode** skips the sweeping and gives you the gizmo: centre
moves the plate, the rim handles set major-axis length + tilt, the
small accent handle sets the minor axis. The button names where it will
take you (*switch to handles ⊹*), the first face offers it once to
anyone who is not on a pen, and two unfinished sweeps offer it again.
`R` starts the plate over in either mode, so no misplacement is ever a
dead end.

Three faces per round, each turned further away — a first-ever round is
two, so the drill hands over a score before it hands over its hardest
face. After every lock the
true ellipse is revealed in the accent with its ellipse "degree", the
axle (labelled, with the minor axis named on it), and a one-line note
naming whichever of placement / tilt / size you missed by most — so you
learn from the delta, not just the number. The round-done line names
your best face as well as the mean, because the difficulty ramp
guarantees the last face is the worst one.

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
diagonal), axis angle (weighted down as the truth gets rounder, since a
circle's axis direction means nothing) and size. Everything inside a
small full-credit tolerance scores 100, so a genuinely nailed ellipse
reads 100. Round score is the mean of the faces.

**Size is scale + shape, and it is capped.** It used to be the mean of
two relative radius errors, which punished the same absolute miss far
harder on a narrow truth — face 3's minor axis is ~40px, so ordinary
hand noise there spent a third of the whole error budget — and it was
uncapped, so it could zero an otherwise good ellipse on its own, while
the drill's own studio tip asks for tilt first. Now the shape term is
the error in `b/a`: the *degree* the drill exists to teach and the
number the reveal already prints.

**Tolerances follow the hardware** via `ArtDaily.ease()`, and the HUD
says which mode it eased for (scores are only ever compared with your
own). The free zone is 2% of the face diagonal on a pen, doubled on a
mouse or trackpad, ×1.5 on a finger, and floored at 5px eased — 2% of a
150px phone face diagonal is 3px, inside a fingertip's own jitter. The
error that reaches zero is eased the same way. Closure needs 75% of the
way round on a pen, 66% on a mouse. Handles are grabbed within
`ArtDaily.startRadius(24)` — 41px on a pen tablet, where the hand is
out of sight. Measured on simulated sweeps (`scoreItem` and the real
conic fit, in the scratch harness): a trackpad-noise sweep aimed dead at
a 22° truth scored ~50 and now scores ~77; the same sweep taken in two
lifts scored *nothing at all* and now scores ~76.

Stroke samples are no longer clamped into the canvas rect either: a
finger overshooting the sheet used to write a straight run along the
edge into the point cloud, quietly dragging the fitted conic into a
wrong answer with no message at all.

Run it: `python3 -m http.server 8080` in this folder, then open
`http://localhost:8080/`. Plain HTML/CSS/JS — no build, no deps.

Part of [Art Daily](https://artdaily.sadeali.com/) ·
more experiments at [sadeali.com](https://sadeali.com/).
