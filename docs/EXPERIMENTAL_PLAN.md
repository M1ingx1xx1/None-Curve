# Experimental effects plan

**English** · [中文](EXPERIMENTAL_PLAN.zh.md)

**Status:** Phases 1–8 (Noise, Ripple, Wind, more extreme ranges, folds, petals, curl, spikes) built and verified  
**Scope:** A new **Experimental** tab beside **Geometry** in the tools panel, holding creative effects that can all be applied to the same letters at once.

## 1. Goals

- One tab, **Experimental**, for all creative effects: Noise, Ripple, Curl, Wind, and Spikes. There is no separate tab per effect.
- The effects **stack**: any combination can be on at the same time, and the result is always a valid letter that exports.
- Each effect is built and shipped on its own, in this order: **Noise → Ripple → Wind**, then **Curl** (Phase 7), which runs between Ripple and Wind, and **Spikes** (Phase 8), which runs last.
- Random anchors (in the Geometry tab) is no longer experimental: its "Experimental" tag is removed.

## 2. Highest rule: no curves

None-Curve means no curves. That rule comes before every other choice in this plan, and it covers what the letters look like, not only the file format.

1. **Straight lines only in the data.** Every contour stays a closed polygon. SVG keeps using only `M` / `L` / `Z`, and the font export keeps checking that no glyph contains a curve command. Nothing changes here.
2. **No smooth sampling.** No effect may sample a smooth function (a sine wave, smooth noise) densely along the outline. Dense sampling would give straight lines on paper and a curve to the eye.
3. **Every effect is a piecewise-linear warp of the plane.** The plane is cut into triangles, and each triangle is moved by its own linear map. A straight edge stays exactly straight inside a triangle and bends only where it crosses a triangle edge (a **crease**). New vertices are added only at creases. So an effect can only add corners; it can never round anything off. (Spikes, section 4.8, is not a warp: it moves a few anchors along straight lines, so its edges stay straight too.)
4. **Visible facets.** Every mesh has a minimum cell size, so the pieces between creases stay large enough to read as facets.
5. **Faint creases left out.** A crease that turns the outline by less than 3° reads as a wobble, not a corner, so it is left out (as long as the outline stays within 1% of the em of where it was; less where contours are close).
6. **Measured and enforced.** A **curve-like run** is five or more vertices in a row that all turn the same way by 0.5°–20°, between edges shorter than 4% of the em: that is how a polyline starts to look like a curve. Creases are removed until none is needed to make such a run. Runs that the input's own vertices already form are the input's shape (for example a finely flattened bowl) and are left alone; the input's vertices are never removed. Creases of earlier effects count as creases too, so a run that only several effects together form is broken up as well.
7. **Only where it fits.** If removing creases makes a contour touch itself or another, the creases along that one edge are restored and the rest is tidied again. Where two parts of an outline are a fraction of a unit apart (New York's hairline joins), a crease that cannot be removed without touching stays.

What this means for the effects: Ripple waves are zigzags (a triangle wave) on concentric polygons, not sine curves on circles. Noise looks like folded or crumpled paper, not like a wobbly hand-drawn line.

## 3. Stacking

- **Fixed order, last in the pipeline.** Experimental effects run after the whole Geometry pipeline (after Distortion), always as Noise → Ripple → Curl → Wind → Spikes. Each takes the previous effect's result. The pipeline is still rebuilt from the original curves for every change, so turning an effect off simply removes it.
- **Valid by construction.** Up to 100%, each warp keeps every triangle the same way round (it never flips or flattens one), which makes it a one-to-one map of the plane. A one-to-one map cannot make an outline cross itself, push a counter out of its letter, or merge separate parts. Applying several such maps one after another is again one-to-one, so **any combination of effects within 100% is valid** and keeps every letter arranged as it was.
- **Folds beyond 100%.** Past their safe range, effects may fold the letter onto itself; the overlaps are then merged into one clean outline (section 4.5), so the result is still valid and exports, only no longer arranged like the original letter. Spikes may cross the letter at any setting, so whenever it is on the result is merged the same way (section 4.8).
- **Checked anyway.** After each effect, every contour is still checked for self-crossings and against the glyph's other contours, as every Geometry step does. All contours start as their exact images, which are valid together; each is then replaced by its tidied image (faint creases and curve-like runs removed) only if that is valid against the others. A crossing counts only where the input's edges neither crossed nor touched, because heavy Geometry settings can leave outlines lying on top of themselves; nor between two edges still exactly as the warp mapped them whose input edges are less than 0.05 units apart, which only rounding can cross (a strong Wind can squeeze a sharp spike that thin). If rounding ever breaks an exact image, that contour is retried at 1/2 down to 1/16 strength, and if nothing works the glyph is left as it was; the panel says so.
- **One seed.** The Experimental tab has one seed with **Next variant**. Each effect derives its own random numbers from it, so one control rerolls the whole look, and the same seed and settings always give the same letters.
- **Same letter, same shape.** Effects work in each glyph's own coordinates, so every copy of a letter looks the same. Font export needs this, because a font has one shape per character.
- **Vertex budget.** Creases add vertices. The panel shows how many each effect added, and the minimum cell sizes keep the total in check: Noise adds about 30 vertices per glyph at its defaults and about 80 at the smallest facet size.

## 4. Effects

### 4.1 Noise (Phase 1)

Crumples the letter like paper.

- **Mesh:** a square lattice with cells of **Facet size** (8–100% of the em, default 18%), turned by an angle taken from the seed. Each square is split into two triangles along one of its diagonals, also chosen by the seed, so the creases do not line up in a grid.
- **Movement:** every lattice point moves by a random vector from the seed, up to **Amount** × 30% of the facet size. Points between lattice points move linearly with their triangle.
- **Why 30%:** if no corner of a triangle moves more than 30% of the cell size, the triangle keeps at least about 15% of its area and never flips. That guarantees the warp is one-to-one, so Noise never needs to be weakened to stay valid.
- **Controls:** Use noise, Amount (0–500%, default 70%; above 100% facets fold over each other, see section 4.5), Facet size (% of the em), Turn (0–345° in 15° steps, default 0°), and the shared seed. Statistics: largest move and creases added.
- **Turn:** every lattice point's movement is turned by the same angle, so the folds go another way while the lattice and its creases stay put; at 180° the paper is crumpled the opposite way. Only the direction of each movement changes, never its length, and the limits above depend only on the length, so Noise stays one-to-one up to 100% at any turn and folds the same way beyond. Turn 0° gives exactly the earlier result. Checked on the Latin glyphs of Arial, New York, and Georgia at eight turns, alone, on Geometry settings, and with Ripple and Wind: no new crossing, no weakened contour, and every glyph exports; two curve-like runs remain in New York, where the outline touches itself or comes within half a unit of itself.
- **Measured:** on the Latin glyphs of Arial, New York, and Georgia, alone and on top of 11 Geometry settings, no new crossing and no weakened contour; across 9720 random combinations of Geometry and Noise, the same, and every glyph exports. One curve-like run remains in New York, where two parts of the outline are too close to remove the crease. Noise roughly doubles the geometry time. While testing, two older export problems showed up and were fixed: rounding to whole units now retries in the reverse contour order, and zero-width spikes left by heavy Geometry settings are dropped before warping.
- **Difference from Distortion:** Distortion moves each contour along its own length, independently of the others. Noise moves the plane, so a counter and the outline around it fold together, and the folds are straight creases.

### 4.2 Ripple (Phase 2)

Waves spreading from a point.

- **Mesh:** concentric regular polygons with a flat side at the bottom, around a centre given as a fraction of the glyph's ink box, with a ring every half wavelength measured across the sides. Rays through the polygon corners cut the rings into cells, each split into two triangles.
- **Movement:** every ring moves outward or inward as a whole, in turn, so it stays a regular polygon and the outline zigzags where it crosses the rings (a triangle wave). The amplitude can fade linearly toward the farthest point of the glyph.
- **Validity:** the warp is one-to-one as long as neighbouring rings never pass each other, that is, while the amplitude stays below half the ring spacing. It is capped at 45% of the spacing, so rings stay at least 10% of it apart (40% and 20% before Phase 4). The ring just outside the glyph stays put, and without petals everything beyond it is left alone (with petals, see section 4.6).
- **Controls:** Use ripple, Amount (0–400%, default 50%; above 100% rings pass each other, see section 4.5), Wavelength (8–200% of the em, default 30%), Sides (3–12, default 8), Center X and Y (−50% to 150% of the ink box, default the middle), Fade, Petals (0–300%, default 0%, see section 4.6). Ripple uses no randomness.
- **Measured:** on the Latin glyphs of Arial, New York, and Georgia, alone, on top of 9 Geometry settings, and stacked with Noise: no new crossing, no weakened contour, and every glyph exports; 5 curve-like runs remain in New York, all where two parts of the outline are less than one unit apart. Across 19,440 random combinations of Geometry, Noise, and Ripple settings, nothing crosses and every glyph exports. At its defaults Ripple adds about 30 vertices per glyph (about 100 at the shortest wavelength); With Noise and Ripple both on, computing the geometry takes four to five times as long as Geometry alone (about 0.4 ms per glyph).
- **Found while testing:** a segment passing exactly through the centre crossed every ray at once and lost its creases; it is now split at the centre. And Ripple used to keep Noise's creases as fixed vertices, so the two together could still form curve-like runs (69–93 per font); creases are now marked across effects.
- **Later:** one wave across a whole line of text. Each letter would then depend on its position, so the geometry cache, the worker, and export would all have to change. Not in Phase 2.

### 4.3 Wind (Phase 3)

Letters pulled by the wind.

- **Mesh:** bands that run with the wind, one Gust size apart and anchored at the glyph origin (so with a level wind every letter on a line shares the same gusts), cut into square cells, each split into two triangles along a diagonal chosen by the seed.
- **Movement:** every point moves along the wind by Strength × its band's gust × its distance downwind of the glyph's upwind edge. The edge facing the wind stays put and crisp, and the letter is drawn out more the further downwind it reaches; each band's gust is a random share of the full strength (from the seed), varied by Gustiness, so the trailing side breaks into ragged, straight-edged streaks. (This replaces the earlier idea of a separate shift plus stretch: one rule gives both.)
- **Validity:** gusts are never negative and the movement only grows downwind, so every triangle is stretched along the wind and never squeezed: its area ratio is at least 1. Wind is one-to-one at any strength, with no cap needed.
- **Controls:** Use wind, Direction (0° right, 90° up, in 15° steps), Strength (0–800%, default 30%), Gust size (6–50% of the em, default 12%), Gustiness (0–200%, default 60%; above 100% some gusts blow backwards, see section 4.5), and the shared seed. No point moves more than 4 em.
- **Measured:** on the Latin glyphs of Arial, New York, and Georgia, alone, on top of Geometry settings, and with Noise and Ripple: no new crossing, no weakened contour, and every glyph exports; two curve-like runs remain in New York when all three effects are pushed hard, both where the outline is less than one unit from itself. Across 19,440 random combinations of all settings, nothing crosses, no contour is weakened, and every glyph exports. At its defaults Wind adds about 10 vertices per glyph; all three effects together make the geometry five to seven times slower than Geometry alone (about 0.5 ms per glyph).
- **Found while testing:** a strong Wind can squeeze a sharp spike left by heavy Distortion so thin that rounding makes its two sides cross, although the warp keeps them apart. A crossing between two edges still exactly as the warp mapped them, whose input edges are less than 0.05 units apart, is now recognised as rounding instead of weakening the contour.
- **Later:** streaks that trail from the leeward side of each stroke on its own (not only of the letter as a whole), and fragments blowing off. They are not one-to-one maps, so they would need their own crossing repair. Not in Phase 3.

### 4.4 More extreme ranges (Phase 4)

The effects could go further than the first ranges allowed. Two levers, used where each is safe:

- **Higher maxima.** Noise and Ripple were capped by their safety limits, so their maxima cannot simply grow:
  - **Noise:** Amount now goes to 200%. Above 100%, the result is crumpled a second time on the same lattice by the rest (replaced in Phase 5 by folding, section 4.5). Two one-to-one warps in a row are one-to-one, and the same lattice deepens the same folds, so the pattern does not jump as the slider passes 100%. Facet size now goes to 100% of the em.
  - **Ripple:** a second pass does not add up (the rings have already moved, so the second push partly cancels), so the single-pass limit is raised instead, from 40% to 45% of the ring spacing: neighbouring rings come within 10% of the spacing, squeezing strokes into slivers. (48% was tried first: rings within 4% squeezed some New York strokes thinner than a font unit, and those glyphs could no longer be rounded for font export.) Wavelength now goes to 200% of the em, so the waves (and their amplitude) can be far larger.
  - **Wind** had no safety limit: Strength now goes to 300%.
- **Bigger steps.** Every slider moves in about 10–20 steps from end to end: Amount, Strength, Gustiness, Center, and Fade in 10% steps; Facet size, Wavelength, and Gust size in 2% of the em; Direction in 15°.
- **Checked:** the chained Noise and the new Ripple limit keep every mesh triangle the same way round (exact images match densely sampled ones). On the Latin glyphs of Arial, New York, and Georgia at the new maxima, alone, on top of Geometry settings, and all three at once (63 font and setting combinations), and across 29,160 random combinations: no new crossing, no weakened contour, and every glyph exports; one curve-like run remains (New York ç, where the outline is under a unit from itself).
- **Found while testing:** at full strength, Ripple can squeeze an accent or a stroke end into a sliver thinner than a font unit, which rounding to whole units for font export cannot keep. Such a contour (narrower on average than one unit: twice its area over its perimeter) is now left out on its own, like a contour too small to show, instead of the glyph failing to export.

### 4.5 Folds: beyond the safe range (Phase 5)

Even at the Phase 4 maxima the letters stayed readable, because every effect stopped where the plane would fold over itself. Phase 5 lets the effects go past that point. The highest rule stays: **no curves**. What gives way is only the promise that every letter stays arranged like the original.

- **What folds.** Above 100%, each effect is allowed to flip its triangles:
  - **Noise** (to 500%): lattice points move up to 1.5 facets, along the same directions as below 100%, so the pattern grows without jumping. Facets flip over their neighbours.
  - **Ripple** (to 400%): rings move up to 1.8 ring spacings, overtaking their neighbours; the innermost can pass through the centre and turn inside out.
  - **Wind**: Gustiness goes to 200%. Above 100% some gusts are negative and blow backwards, pushing their bands back through the letter and tearing it. Strength goes to 800%.
- **Still no curves.** Folding changes nothing about the warp itself: it is still piecewise-linear, straight edges bend only at creases, and creases are tidied exactly as before (faint ones removed, curve-like runs broken).
- **Merging the overlaps.** A folded letter overlaps itself. Fonts fill outlines by the nonzero rule, so it still has a definite shape, but crossing outlines do not survive rounding for export, and font tools reject them. So, once any effect folds, every effect runs unchecked, and at the end the glyph is redrawn as the outline of exactly what the nonzero rule fills (`src/geometry/overlaps.ts`):
  1. **Snap rounding** on a grid of whole font units: every vertex and every place where outlines cross is rounded to the grid, and each edge is routed through every grid point whose cell it passes. Rounded edges then meet only at their ends, and all further arithmetic is exact.
  2. Each region between edges gets its **winding number**; edges with ink on one side and none on the other are joined into contours. Where two inked regions touch at a single point, each keeps its own contour.
  3. Contours too small to show (under 4 square units, or under one unit wide on average) are left out.
  The result has only straight edges; new vertices appear only where outlines crossed, plus detours under half a unit. Outer contours run counter-clockwise and holes clockwise.
- **Within font limits.** Strong winds with backward gusts could stretch a wide glyph beyond 32,767 units, the largest step a font outline can store, which corrupted the written font. Wind now carries nothing further than 4 em; and font export leaves out (and names) any glyph that is still too wide, instead of writing a broken file.
- **Checked:**
  - Merging: 1,500 random self-crossing polygons give outlines that never cross, with exactly the same filled area away from the edges.
  - On the Latin glyphs of Arial, New York, and Georgia (16 settings each, from each effect alone at its maximum to all three at once, on top of Geometry settings): no crossing in any result and no export failure, at whole units and at two decimals.
  - Whole fonts written as OTF and read back with every effect at its maximum: Arial, New York, and Georgia pass for each effect alone; New York and Georgia pass with all three at once. Arial (2,692 glyphs) with all three at once exceeds the existing limit of 1,000,000 outline points in one file; the message suggests exporting only the characters in the text.
  - Within 100%, every result is identical to Phase 4.
  - Curve-like runs not formed by the input's own vertices: 0–9 per font at the maxima, almost all five vertices long, where a crossing extends four of the input's own vertices. Settings with a dense input (Anchor spacing 5) give more (48–109 per font), of the same kind.
  - The geometry takes about 0.5 ms per glyph for one folding effect and about 6 ms with all three at their maxima.

### 4.6 Petals (Phase 6)

Ripple's rings were always regular polygons. Petals bends every ring into a flower with one petal per side, so **Sides** sets the number of petals: 3 gives a trefoil, and so on up to 12.

- **Idea, and why not curves.** Flower-like ripples in other tools come from moving Bézier control points: the curves balloon into petals. None-Curve cannot use curves, so its petals are made of straight facets instead.
- **Mesh:** when Petals is above 0, each wedge between two polygon corners is cut by three more rays from the centre, through points evenly spaced along the side. Along each side the rays are: tip (the corner), shoulder, notch (the middle of the side), shoulder. Each petal tip points at a polygon corner; since the polygons sit on a flat side, with 5 sides one petal points straight up.
- **Movement:** each ray scales the rings along it (after the ripple has moved them) by its own factor: tips out by the full depth, shoulders out by 70% of it, notches in. At 100% the depth is 0.9: tips reach 90% further out, and notches keep 10% of their distance. Above 100% (to 300%, depth 2.7) tips and shoulders keep growing while the notches stay at 10%. Beyond the last ring the same scaling goes on, linear in each slice, so the plane stays continuous.
- **Validity:** corners only ever move along their own ray and stay on the same side of the centre (no ray's factor falls below 10%), so the rays keep their order and the rings keep their order along each ray. Petals is one-to-one at any depth: it never folds on its own and never needs the overlap merge. Folding (and the merge, section 4.5) still comes only from Ripple **Amount** above 100%.
- **Still no curves.** The warp is still piecewise-linear; the new rays are just more creases. Each petal has only three convex corners (shoulder, tip, shoulder) between concave notches, so petals never form a curve-like run, and creases are tidied as for every effect.
- **Controls:** Petals (0–300%, default 0%, in 10% steps), in the Ripple group between Fade and the statistics. Ripple counts as on when Use ripple is checked and either Amount or Petals is above 0; the pipeline summary lists "petals N%". Settings saved before Petals existed get 0. With Petals at 0 the mesh and every result are exactly as before (positions agree to within 1e-12 units, creases identical).
- **Checked:**
  - Mesh: exact images match densely sampled ones (within 3e-11 units), the map is continuous across every crease, and over 20,000 random points with Petals up to 300% and Amount up to 100% no triangle flips.
  - On the Latin glyphs of Arial, New York, and Georgia (13 settings each: Petals from 50% to 300%, with and without Amount, on top of Geometry settings, and stacked with Noise and Wind): no new crossing, no weakened contour, no curve-like run that needs a crease, and every glyph exports. (One New York R reads as a new crossing to the audit, but it is the letter's own overlap, with a crease landing exactly on it.)
  - With Amount above 100% as well (and with every effect at its maximum): no crossing and no export failure; at most two curve-like runs per font not formed by the input's own vertices.
  - Whole fonts written as OTF and read back pass with Petals at 300%, alone and with Amount at 400%. With every effect at its maximum at once, all three fonts exceed the 1,000,000-point limit, and the message suggests exporting only the characters in the text.
  - Ripple with Petals adds about 0.3 ms per glyph to the geometry; every effect at its maximum at once takes about 20 ms per glyph.

### 4.7 Curl (Phase 7)

Swirls each letter around the centre of its ink box.

- **Mesh:** the one Ripple uses: concentric regular polygons with **Sides** (3–12, default 8) and a flat side at the bottom (so with an even number of sides also a flat top), rays through the corners, each cell split into two triangles. The outermost of the **Rings** (2–12, default 6) lies half the ink box's height from the centre, so the top and bottom of the letter sit on it. (For a flat glyph such as a hyphen it lies at least 5% of the em out, so the glyph still turns.)
- **Movement:** instead of moving out and in, every ring turns as a whole about the centre, so it stays a regular polygon. Points in between move linearly with their triangle, so strokes bend only along straight creases and the swirl is built from straight pieces. **Pin top and bottom** picks one of two ways to turn:
  - **Pinned** (on, the default): the outermost ring and everything beyond it stay put, and the rings turn more toward the centre. The top and bottom of the letter stay where they are and the middle twists.
  - **Whole** (off): the centre stays put, the rings turn more toward the outside, and everything beyond the outermost ring turns with it as one piece. The top and bottom swing round too.
- **Validity:** neighbouring rings turn by the same step relative to each other. Turned too far, the triangles between them flip, and the further out the ring, the smaller the step that does it. At 100% the step is 90% of the largest that keeps every triangle the same way round, worked out for the Sides and Rings in use, with the cell diagonals laid along the swirl (whichever of the two diagonal directions lets the rings turn further). So up to 100% either way Curl is one-to-one: no crossings, and counters stay inside. How far the swirl turns at 100% depends on Sides and Rings: from about 30° with 3 sides to well over a full turn with 12 sides and many rings. Above 100% either way, triangles flip, the letter folds, and the overlaps are merged (section 4.5); Curl counts as folding when Amount is beyond ±100%.
- **Still no curves.** The warp is piecewise-linear: the creases are the ring sides, the rays, and the cell diagonals inside the rings. Beyond the outermost ring nothing creases (pinned: it is unchanged; whole: it turns rigidly as one piece). Creases are tidied as for every effect (faint ones removed, curve-like runs broken). Like Ripple and Wind, Curl places itself by the ink box of what it receives.
- **Controls:** Use curl, Amount (−400% to 400%, default 60%, in 10% steps; below 0% it turns clockwise), Pin top and bottom (default on), Rings (2–12, default 6), Sides (3–12, default 8). Curl uses no randomness, so the shared seed does not affect it. Statistics as in the other groups (largest move, creases added); the pipeline summary lists "curl N% (pinned|whole), R rings, S sides".
- **Checked:**
  - Mesh: exact images match densely sampled ones (within 1e-11 units), the map is continuous across every crease, and over 24,000 random points at up to ±100% (both modes, 3–12 sides, 2–12 rings) no triangle flips.
  - On the Latin glyphs of Arial, New York, and Georgia (12 settings each: ±30–100%, pinned and whole, 2–12 rings, 3–12 sides, on top of Geometry settings, and stacked with Noise, Ripple, and Wind): no new crossing, no weakened contour, and every glyph exports. One curve-like run that needs a crease remains (New York č with very fine flattening, where the outline comes within 0.7 units of itself).
  - Beyond 100% (±200% to ±400%, both modes, 2–12 rings, 3–12 sides, and all four effects folding at once): no crossing and no export failure. Curve-like runs not formed by the input's own vertices appear only with the coarsest mesh at 300% (2 rings, 3 sides; 6–11 per font, every one five vertices long, where a crossing extends four of the input's own vertices) and at most 2 per font otherwise. Whole fonts written as OTF and read back pass at 100% with 12 rings and 12 sides, and at 400% whole.

### 4.8 Spikes (Phase 8)

A few anchors of each letter jump out into the canvas, pulling long, straight spikes.

- **Which anchors:** only anchors on the outside of the letter, on contours that do not lie inside another contour, so counters never spike. **Anchors** of them jump per letter. They are picked by a hash of the shared seed and each anchor's position, so the same seed and outline always give the same spikes, every copy of a letter spikes the same way, and **Next variant** moves them. Driven by Sound (Beat → Seed), they jump somewhere new on every beat.
- **Movement:** each picked anchor jumps straight away from the ink (along the mean of its two edges' outward normals) by a seeded 35–100% of **Reach**. **Spread** turns each jump by a seeded angle: at 0% every anchor jumps straight out from the outline, at 100% anywhere up to 90° to either side.
- **Width:** how wide each spike is where it leaves the letter. Below 100%, two new anchors go on the jumping anchor's edges, Width × its shorter edge away from it (at least 2%: a thin needle), and the rest of each edge stays put; when two neighbouring anchors both jump, each keeps half the edge between them. At 100% the jumping anchor pulls its whole edges along: a wide wedge.
- **Not a warp, so merged.** Unlike the other effects, Spikes moves single anchors rather than the plane, and it runs last, on what Wind leaves. A spike may cross the letter or another spike at any setting, so whenever Spikes is on, the outlines are merged into one clean outline at the end, exactly as when an effect folds (section 4.5), and the letters still export.
- **Still no curves.** Every spike is two straight edges from its base to its tip; nothing is sampled or smoothed. Each spike adds at most two anchors (its base), and the merge adds vertices only where outlines cross.
- **Controls:** Use spikes, Anchors (1–12, default 3), Reach (0–200% of the em, default 60%), Spread (0–100%, default 50%), Width (0–100%, default 30%), the last three in 5% steps, and the shared seed. Statistics: Spikes (how many jumped) and Longest (font units); while Spikes is on, the intro also shows Crossings merged and Slivers dropped. The pipeline summary lists "spikes ×N, reach N% em, spread N%, width N%, seed S". Settings saved before Spikes existed have it off.
- **Checked:** on all Latin glyphs of Arial, Georgia, and New York, across 141 combinations of 4 Geometry settings (default, Tolerance 1, Anchor spacing 5, a heavy combination), 6 Spikes settings (1–12 anchors, Reach 30–200%, Spread 0–100%, Width 0–100%), with and without Noise and Wind, and 3 seeds: no crossing in any result and no export failure. The farthest point lies about 3 em from the origin. The geometry takes 0.2–0.9 ms per glyph at the default Geometry settings, and up to about 6 ms with dense anchors plus Noise and Wind.

## 5. Interface

- The Geometry panel gets two tabs: **Geometry** and **Experimental**. The chosen tab is remembered in the browser. **Show all explanations** stays above the tabs and applies to both.
- The Experimental tab, from top to bottom: a short line on the order (Noise → Ripple → Curl → Wind → Spikes, after Geometry); one group per effect, each with its own on/off control; the shared seed; and **Reset experimental**.
- Each group shows its statistics (largest move, vertices added) and warnings, like the Geometry groups. When an effect goes beyond 100%, or Spikes is on, the intro also shows how many crossings were merged and how many slivers were dropped.
- The pipeline summary in the status bar and export notes lists the active effects.
- English-only labels, short, with explanations folded behind ⓘ buttons.

## 6. Verification for each effect

- **Validity audit:** every Latin glyph of Arial, New York, and Georgia at several settings, alone and on top of Geometry settings: no new self-crossings, no contour crossing another, counters still inside.
- **Stacking fuzz:** random combinations of Geometry and Experimental settings, including every effect at full strength together.
- **No-curves audit:** smooth runs (section 2) do not increase, and the triangle check confirms that no mesh triangle flips.
- **Export regression:** OTF and SVG from the results still pass the export checks with no failures.
- **Performance:** a full specimen recomputes about as fast as before with every effect at its default.
- **In the browser:** check each effect on screen and with the Geometry settings, mainly to confirm that nothing reads as a curve.
- **Docs:** README, User Guide, and PRD updated, in English and Chinese, in separate files.

## 7. Phases and estimates

| Phase | Content | Estimate |
|---|---|---|
| 1 | Experimental tab, shared warp framework (creases, mapping, checks), Noise, Random anchors no longer experimental | Done |
| 2 | Ripple on the shared framework | Done |
| 3 | Wind on the shared framework | Done |
| 4 | More extreme ranges and bigger slider steps (section 4.4) | Done |
| 5 | Folds beyond 100%, with overlaps merged (section 4.5) | Done |
| 6 | Petals: flower-shaped Ripple (section 4.6) | Done |
| 7 | Curl: swirl, pinned or whole (section 4.7) | Done |
| 8 | Spikes: anchors that jump out into the canvas (section 4.8) | Done |
| Later | Text-wide Ripple, Wind streaks and fragments, Slice, Frankenstein | Separate plan |

Each phase ends with the verification in section 6 and is shipped on its own.
