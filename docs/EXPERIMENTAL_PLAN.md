# Experimental effects plan

**English** · [中文](EXPERIMENTAL_PLAN.zh.md)

**Status:** Phase 1 (Noise), Phase 2 (Ripple), and Phase 3 (Wind) built and verified  
**Scope:** A new **Experimental** tab beside **Geometry** in the tools panel, holding creative effects that can all be applied to the same letters at once.

## 1. Goals

- One tab, **Experimental**, for all creative effects: Noise, Ripple, and Wind. There is no separate tab per effect.
- The effects **stack**: any combination can be on at the same time, and the result is always a valid letter.
- Each effect is built and shipped on its own, in this order: **Noise → Ripple → Wind**.
- Random anchors (in the Geometry tab) is no longer experimental: its "Experimental" tag is removed.

## 2. Highest rule: no curves

None-Curve means no curves. That rule comes before every other choice in this plan, and it covers what the letters look like, not only the file format.

1. **Straight lines only in the data.** Every contour stays a closed polygon. SVG keeps using only `M` / `L` / `Z`, and the font export keeps checking that no glyph contains a curve command. Nothing changes here.
2. **No smooth sampling.** No effect may sample a smooth function (a sine wave, smooth noise) densely along the outline. Dense sampling would give straight lines on paper and a curve to the eye.
3. **Every effect is a piecewise-linear warp of the plane.** The plane is cut into triangles, and each triangle is moved by its own linear map. A straight edge stays exactly straight inside a triangle and bends only where it crosses a triangle edge (a **crease**). New vertices are added only at creases. So an effect can only add corners; it can never round anything off.
4. **Visible facets.** Every mesh has a minimum cell size, so the pieces between creases stay large enough to read as facets.
5. **Faint creases left out.** A crease that turns the outline by less than 3° reads as a wobble, not a corner, so it is left out (as long as the outline stays within 1% of the em of where it was; less where contours are close).
6. **Measured and enforced.** A **curve-like run** is five or more vertices in a row that all turn the same way by 0.5°–20°, between edges shorter than 4% of the em: that is how a polyline starts to look like a curve. Creases are removed until none is needed to make such a run. Runs that the input's own vertices already form are the input's shape (for example a finely flattened bowl) and are left alone; the input's vertices are never removed. Creases of earlier effects count as creases too, so a run that only several effects together form is broken up as well.
7. **Only where it fits.** If removing creases makes a contour touch itself or another, the creases along that one edge are restored and the rest is tidied again. Where two parts of an outline are a fraction of a unit apart (New York's hairline joins), a crease that cannot be removed without touching stays.

What this means for the effects: Ripple waves are zigzags (a triangle wave) on concentric polygons, not sine curves on circles. Noise looks like folded or crumpled paper, not like a wobbly hand-drawn line.

## 3. Stacking

- **Fixed order, last in the pipeline.** Experimental effects run after the whole Geometry pipeline (after Distortion), always as Noise → Ripple → Wind. Each takes the previous effect's result. The pipeline is still rebuilt from the original curves for every change, so turning an effect off simply removes it.
- **Valid by construction.** Each warp keeps every triangle the same way round (it never flips or flattens one), which makes it a one-to-one map of the plane. A one-to-one map cannot make an outline cross itself, push a counter out of its letter, or merge separate parts. Applying several such maps one after another is again one-to-one, so **any combination of effects is valid**, at any strength.
- **Checked anyway.** After each effect, every contour is still checked for self-crossings and against the glyph's other contours, as every Geometry step does. All contours start as their exact images, which are valid together; each is then replaced by its tidied image (faint creases and curve-like runs removed) only if that is valid against the others. A crossing counts only where the input's edges neither crossed nor touched, because heavy Geometry settings can leave outlines lying on top of themselves; nor between two edges still exactly as the warp mapped them whose input edges are less than 0.05 units apart, which only rounding can cross (a strong Wind can squeeze a sharp spike that thin). If rounding ever breaks an exact image, that contour is retried at 1/2 down to 1/16 strength, and if nothing works the glyph is left as it was; the panel says so.
- **One seed.** The Experimental tab has one seed with **Next variant**. Each effect derives its own random numbers from it, so one control rerolls the whole look, and the same seed and settings always give the same letters.
- **Same letter, same shape.** Effects work in each glyph's own coordinates, so every copy of a letter looks the same. Font export needs this, because a font has one shape per character.
- **Vertex budget.** Creases add vertices. The panel shows how many each effect added, and the minimum cell sizes keep the total in check: Noise adds about 30 vertices per glyph at its defaults and about 80 at the smallest facet size.

## 4. Effects

### 4.1 Noise (Phase 1)

Crumples the letter like paper.

- **Mesh:** a square lattice with cells of **Facet size** (8–60% of the em, default 18%), turned by an angle taken from the seed. Each square is split into two triangles along one of its diagonals, also chosen by the seed, so the creases do not line up in a grid.
- **Movement:** every lattice point moves by a random vector from the seed, up to **Amount** × 30% of the facet size. Points between lattice points move linearly with their triangle.
- **Why 30%:** if no corner of a triangle moves more than 30% of the cell size, the triangle keeps at least about 15% of its area and never flips. That guarantees the warp is one-to-one, so Noise never needs to be weakened to stay valid.
- **Controls:** Use noise, Amount (0–100%, default 70%), Facet size (% of the em), and the shared seed. Statistics: largest move and creases added.
- **Measured:** on the Latin glyphs of Arial, New York, and Georgia, alone and on top of 11 Geometry settings, no new crossing and no weakened contour; across 9720 random combinations of Geometry and Noise, the same, and every glyph exports. One curve-like run remains in New York, where two parts of the outline are too close to remove the crease. Noise roughly doubles the geometry time. While testing, two older export problems showed up and were fixed: rounding to whole units now retries in the reverse contour order, and zero-width spikes left by heavy Geometry settings are dropped before warping.
- **Difference from Distortion:** Distortion moves each contour along its own length, independently of the others. Noise moves the plane, so a counter and the outline around it fold together, and the folds are straight creases.

### 4.2 Ripple (Phase 2)

Waves spreading from a point.

- **Mesh:** concentric regular polygons with a flat side at the bottom, around a centre given as a fraction of the glyph's ink box, with a ring every half wavelength measured across the sides. Rays through the polygon corners cut the rings into cells, each split into two triangles.
- **Movement:** every ring moves outward or inward as a whole, in turn, so it stays a regular polygon and the outline zigzags where it crosses the rings (a triangle wave). The amplitude can fade linearly toward the farthest point of the glyph.
- **Validity:** the warp is one-to-one as long as neighbouring rings never pass each other, that is, while the amplitude stays below half the ring spacing. It is capped at 40% of the spacing, so rings stay at least 20% of it apart. The ring just outside the glyph stays put and everything beyond is left alone.
- **Controls:** Use ripple, Amount (default 50%), Wavelength (8–100% of the em, default 30%), Sides (3–12, default 8), Center X and Y (−50% to 150% of the ink box, default the middle), Fade. Ripple uses no randomness.
- **Measured:** on the Latin glyphs of Arial, New York, and Georgia, alone, on top of 9 Geometry settings, and stacked with Noise: no new crossing, no weakened contour, and every glyph exports; 5 curve-like runs remain in New York, all where two parts of the outline are less than one unit apart. Across 19,440 random combinations of Geometry, Noise, and Ripple settings, nothing crosses and every glyph exports. At its defaults Ripple adds about 30 vertices per glyph (about 100 at the shortest wavelength); With Noise and Ripple both on, computing the geometry takes four to five times as long as Geometry alone (about 0.4 ms per glyph).
- **Found while testing:** a segment passing exactly through the centre crossed every ray at once and lost its creases; it is now split at the centre. And Ripple used to keep Noise's creases as fixed vertices, so the two together could still form curve-like runs (69–93 per font); creases are now marked across effects.
- **Later:** one wave across a whole line of text. Each letter would then depend on its position, so the geometry cache, the worker, and export would all have to change. Not in Phase 2.

### 4.3 Wind (Phase 3)

Letters pulled by the wind.

- **Mesh:** bands that run with the wind, one Gust size apart and anchored at the glyph origin (so with a level wind every letter on a line shares the same gusts), cut into square cells, each split into two triangles along a diagonal chosen by the seed.
- **Movement:** every point moves along the wind by Strength × its band's gust × its distance downwind of the glyph's upwind edge. The edge facing the wind stays put and crisp, and the letter is drawn out more the further downwind it reaches; each band's gust is a random share of the full strength (from the seed), varied by Gustiness, so the trailing side breaks into ragged, straight-edged streaks. (This replaces the earlier idea of a separate shift plus stretch: one rule gives both.)
- **Validity:** gusts are never negative and the movement only grows downwind, so every triangle is stretched along the wind and never squeezed: its area ratio is at least 1. Wind is one-to-one at any strength, with no cap needed.
- **Controls:** Use wind, Direction (0° right, 90° up, in 5° steps), Strength (0–100%, default 30%), Gust size (6–50% of the em, default 12%), Gustiness (0–100%, default 60%), and the shared seed.
- **Measured:** on the Latin glyphs of Arial, New York, and Georgia, alone, on top of Geometry settings, and with Noise and Ripple: no new crossing, no weakened contour, and every glyph exports; two curve-like runs remain in New York when all three effects are pushed hard, both where the outline is less than one unit from itself. Across 19,440 random combinations of all settings, nothing crosses, no contour is weakened, and every glyph exports. At its defaults Wind adds about 10 vertices per glyph; all three effects together make the geometry five to seven times slower than Geometry alone (about 0.5 ms per glyph).
- **Found while testing:** a strong Wind can squeeze a sharp spike left by heavy Distortion so thin that rounding makes its two sides cross, although the warp keeps them apart. A crossing between two edges still exactly as the warp mapped them, whose input edges are less than 0.05 units apart, is now recognised as rounding instead of weakening the contour.
- **Later:** streaks that trail from the leeward side of each stroke on its own (not only of the letter as a whole), and fragments blowing off. They are not one-to-one maps, so they would need their own crossing repair. Not in Phase 3.

## 5. Interface

- The Geometry panel gets two tabs: **Geometry** and **Experimental**. The chosen tab is remembered in the browser. **Show all explanations** stays above the tabs and applies to both.
- The Experimental tab, from top to bottom: a short line on the order (Noise → Ripple → Wind, after Geometry); one group per effect, each with its own on/off control; the shared seed; and **Reset experimental**.
- Each group shows its statistics (largest move, vertices added) and warnings, like the Geometry groups.
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
| Later | Text-wide Ripple, Wind streaks and fragments, Slice, Frankenstein | Separate plan |

Each phase ends with the verification in section 6 and is shipped on its own.
