# Ellipse in Plane 🥏

Lay a correct ellipse onto the face of a 2-point-perspective box —
the plate-on-a-table / wheel-on-an-axle skill. Drag the centre to
place it, the rim handles for major-axis length + tilt, the small
handle for the minor axis, then lock it in. Three faces per round,
each more foreshortened; after every attempt the true projected
circle (the face's inscribed circle through the same camera) is
revealed in the accent with its ellipse "degree", so you learn from
the delta. Scoring compares centre, axis angle (weighted by how
eccentric the truth is) and both radii — round score is the mean.

Run it: `python3 -m http.server 8080` in this folder, then open
`http://localhost:8080/`. Plain HTML/CSS/JS — no build, no deps.

Part of [Art Daily](https://artdaily.sadeali.com/) ·
more experiments at [sadeali.com](https://sadeali.com/).
