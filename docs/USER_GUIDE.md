# None-Curve User Guide

**English** · [中文](USER_GUIDE.zh.md)

This guide is for designers and anyone curious — no programming knowledge needed. It explains what each part of the screen does, what every control changes, and how to save your work.

---

## 1. What None-Curve does

Letters in a font are drawn with smooth curves. None-Curve rebuilds those curves out of **straight lines**, so the letters become polygons — anywhere from "almost identical to the original" to "boldly faceted", "square", "snapped to a grid", or "rough and carved".

You can:

- Load a font from your computer or from Google Fonts.
- Type any text and see it rebuilt live as you move the sliders.
- Look at one letter closely, with its original curve points.
- Save a letter or your text as an **SVG** image, or turn the reshaped letters into a new **font file** (`.otf`).
- Play an audio file or use the microphone and let the sound move the letters live — for example, outlines that roughen when the music gets loud, petals that open on the bass, or points that jump to new places on every beat.

Everything happens inside your web browser. Your font and audio files are never uploaded anywhere.

---

## 2. What you need

- A recent web browser (Chrome, Edge, Firefox, or Safari) on a computer. A phone works, but a larger screen is much more comfortable.
- Either a font file on your computer (`.ttf`, `.otf`, `.woff`, or `.woff2`) **or** an internet connection to load a font from Google Fonts.
- Optional, for the **Sound** tab: an audio file (such as an MP3) or a microphone.
- The app's web address — for example `https://m1ingx1xx1.github.io/None-Curve/` — or ask whoever set up the project for it.

---

## 3. A tour of the screen

The screen is split into two rows and five areas:

```text
┌────────────────────────╥─────────────────────────────────────────────────────┐
│ ① Tools                ║ ② Result canvas                                     │
│   Import font          ║   your text, rebuilt live                           │
│   Font information     ║                                                     │
│   Shaping controls     ║                                                     │
╞════════════════════════╩═╦══════════════════════════╦════════════════════════╡
│ ③ Typography,            ║ ④ Text input             ║ ⑤ Preview              │
│   Glyphs & Color tabs    ║   type here              ║   small copy of ②,     │
│                          ║                          ║   with Blur & Invert   │
└──────────────────────────╨──────────────────────────╨────────────────────────┘
```

1. **Tools (top left)** — the **Import font** button, information about the loaded font, and three tabs: **Geometry** and **Experimental** hold the controls that shape the letters, and **Sound** listens to an audio file or the microphone and can move the letters with it. Scroll to see every control.
2. **Result canvas (top right)** — the big preview. It shows the canvas (a page of fixed size) with the text you typed, rebuilt with your current settings. The page that gets exported sits in the middle with a soft shadow, as if it lay slightly above the background. Around it, the background is a little darker and has a light grid, so the page itself stays clean and looks exactly like the export. The grid also appears on the page while you drag the text or when you zoom in to 200 % or more, to help you line things up. After you change a setting, the letters update in the background one after another — the app stays responsive meanwhile, and the label in the canvas corner says "Updating…" until all of them are done. The **Canvas size** bar at its bottom opens the size settings.
3. **Typography, Glyphs, and Color (bottom left)** — three tabs. **Typography** sets the size, spacing, slant, alignment, and position of the text. **Glyphs** lists every letter, number, and symbol in the font: click one to type it into the text box — handy for symbols that are hard to type, like `©`, `→`, or accented letters. **Color** sets the text and background colours.
4. **Text input** — type the text you want to see on the canvas.
5. **Preview** — a small copy of the result canvas showing all your text, with its own **Blur** slider and **Invert** button.

At the very top there is an **Export…** button, and along the bottom a status line tells you what is shown and which settings are active.

**Light or dark screen.** At the far right of the status line, two small buttons — a sun and a moon — switch the app between a light and a dark look. The app always opens in the same look as your computer (its light or dark mode); your choice lasts until you close the page and is not remembered. The canvas is not affected: its colours come from the **Color** tab.

**Changing the size of the areas.** The double lines in the picture are the thin grey lines between the areas; you can drag them:

- between the **top and bottom rows** — drag up or down to give the canvas or the bottom row more height;
- between the **tools and the canvas** — drag left or right;
- between the **Typography / Glyphs / Color tabs and the text input** — drag left or right;
- between the **text input and the preview** — drag left or right.

Whatever one side gains, the other side loses, so everything always fits in the window exactly — the page never needs scrolling. Each area keeps a minimum size. Double-click a line to put it back where it started. The app remembers your choices the next time you open it.

> On a phone the areas are stacked: tools, canvas, text input, preview, then the Typography / Glyphs / Color tabs. The shaping controls are folded away — tap **Parameters** in the canvas toolbar to open them.

---

## 4. Quick start (five minutes)

1. Click **Import font** (top left) → **Google Fonts** → choose **Inter** → **Load font**.
2. In the text input, type a word, for example `Hello`.
3. In the tools area, find **Curve flattening**, choose **Fixed segments**, and set **Segments per curve** to `2`.
4. Turn on **Merge joined curves**. The letters become clearly faceted.
5. Click **Export…** at the top → **SVG — main view** → **Download SVG**.

That's the whole workflow. The rest of this guide explains each step in more detail.

---

## 5. Loading a font

Click **Import font** at the top of the tools area. You get two choices.

### From your computer

- Choose **Local file** and pick a font file, **or** simply drag a font file onto the big canvas.
- Supported: `.ttf`, `.otf`, `.woff`, `.woff2`. Font "collections" (`.ttc`) are not supported.
- The file stays on your computer; it is only read by your browser.

### From Google Fonts

Choose **Google Fonts**. In the **Family** box you can:

- **Pick from the list** — 15 fonts are listed, grouped as Sans, Serif, Slab, and Mono (for example Google Sans, Inter, EB Garamond, Bodoni Moda, Arvo, JetBrains Mono).
- **Type a name** — any Google font, spelled exactly as on fonts.google.com (capital letters matter: `Open Sans`, not `open sans`). Then click **Use "…"**.
- **Paste a link** — copy the address of a font page from fonts.google.com, for example `https://fonts.google.com/specimen/Plaster`, and paste it. Links that already say a weight or italic (for example `…css2?family=Roboto:ital,wght@1,700`) are understood too.

After choosing a font, set:

- **Weight** — how bold it is (400 is regular, 700 is bold). This works for every font, including "variable" fonts that keep all their weights in one file.
- **Italic** — if the font has an italic version.
- **Character subset** — Google splits fonts by language (for example `latin`, `latin-ext`, `cyrillic`). Only one subset is loaded at a time, so letters from other languages may be missing.

Click **Load font**. Once it has downloaded, the font name appears in the tools area.

### If something goes wrong

The tools area shows what happened and offers **Retry**:

| Message | What it means | What to do |
|---|---|---|
| Empty file / Unsupported format | The file is not a font, or is empty. | Use a `.ttf`, `.otf`, `.woff`, or `.woff2` file. |
| Font parsing failed | The file is damaged. | Try another copy of the font. |
| Google Fonts API error | Google does not know that name. | Check the spelling and capital letters. |
| Network / CORS error | No internet, or a browser extension blocked the request. | Check your connection or ad blocker, then **Retry**. |
| Only fonts.google.com … URLs are accepted | The pasted link is not a Google Fonts link. | Paste a link from fonts.google.com. |

If a new font fails to load, the previous font stays on screen.

---

## 6. Typing text

- Type in the **Text** box (bottom right). Press Enter for a new line.
- The sample menu next to **Clear** offers ready-made texts: **Lorem ipsum** (placeholder text), **Pangrams** (sentences that use every letter), **Spacing** (classic test words such as "Hamburgefontsiv"), and **Alphabet** (all capitals, lowercase letters, digits, and common punctuation, one group per line). The app starts with Lorem ipsum. Once you change the text, the menu shows the last sample with "(edited)"; pick it again to get the original back.
- **Clear** empties the box.
- Right of the **Text** title, **AA** (all capitals), **Aa** (a capital at the start of every word), and **aa** (all lowercase) change how the letters appear on the canvas and in exports. Your typed text stays as it is. Click the highlighted button again to go back to the text as typed. (Hover over a button to see its name.)
- Below the box you see how many characters you typed and whether the font's own **kerning** (fine spacing between pairs like "AV") is applied.
- If a character is not in the font, it appears on the canvas as a **dashed red box** and is listed under the text box. The rest of the line still shows.
- Up to 1000 characters are shown.
- To add a symbol you cannot type easily, click it in the **Glyphs** tab (bottom left). It goes in where your cursor is in the text box (or at the end, if you have not clicked into the box yet). If you selected some text, the symbol replaces it.
- If you make the Glyphs list narrow, it shows only the characters, without their codes, so more fit in. Make it wider to see the codes again (or hover over a character).
- The **search box** above the Glyphs list finds characters by the character itself (`A`), its code (`U+0041`), or part of its name (`arrow`, `dieresis`).

---

## 7. Looking at the result

### The canvas toolbar

**Outline view** — what shape is drawn:

- **Original** — the font exactly as designed, with its curves. Use it to compare.
- **Flattened** — the result of all your settings (the default).
- **Compare** — the result in grey with the original curves drawn on top as a blue dashed line.

**Layers** — extra information you can switch on and off (only **Fill** is on at the start):

- **Fill** — solid letters. Turn it off to see only the outlines.
- **Skeleton** — the points that define the original curves: blue squares sit on the curve, hollow orange circles are the "control points" that pull the curve, and thin lines connect them.
- **Vertices** — green dots at every corner of the new straight-line shape.
- **Metrics** — horizontal guide lines: ascender (top of tall letters like "h"), cap height (top of capitals), x-height (top of "x"), baseline (where letters sit), and descender (bottom of "p" and "g").

> Skeleton points and vertices appear only when letters are large enough to read them. If the canvas says "Zoom in to see skeleton points and vertices", zoom in.

**Zoom** — `−` and `+` zoom out and in, **Fit** shows all the text again. You can also scroll the mouse wheel over the canvas to zoom, and drag to move around.

### Looking at one letter

- Click a letter on the canvas to select it (clicking anywhere in the letter's own space is enough). It changes colour wherever it appears. The colour is worked out from your text and background colours so that it stands out and is still easy to read — for black text on cream paper it is a vermilion red. Pointing at a letter colours it the same way. Inserting a character from the Glyphs list selects it too.
- Click an empty part of the canvas, or press Escape, to remove the highlight. Dragging the canvas around does not remove it.
- The numbers in the shaping controls (vertices, curves, and so on) describe the selected letter — or, after you removed the highlight, the letter you selected last. The **Statistics** line at the top of each tab always says which letter that is, for example "Statistics: l U+006C".
- The preview never shows the highlight, because it shows exactly what will be exported.
- To look closely, zoom in on the canvas.

### The preview: Blur, Invert, and width

The **Preview** (bottom right) shows the whole canvas exactly as it will be exported — anything outside the canvas is cut off. It follows the canvas's Original / Flattened / Compare and layer buttons, but not its zoom.

- **Blur** softens the preview, as if you looked at the text from far away or squinted. This shows the overall shape and rhythm of the letters without the details — a quick way to check whether a rough or faceted style still reads well.
- **Invert** swaps the text and background colours in the preview — dark letters on light become light on dark, and back. Useful to check how the text works both ways, for example for a sign or a dark poster.
- Blur and Invert only change this small view. To save them in a file, tick **Export the preview look** when exporting.
- **Making the preview wider:** drag the thin line on its left (see "Changing the size of the areas" in section 3).

### Canvas size

The text sits on a **canvas** of a fixed size in pixels, like a page or an artboard. Click the **Canvas size** bar under the big canvas to open or close its settings:

- **W** and **H** — the width and height in pixels. Drag the slider or type a number (it takes effect when you press Enter or click elsewhere).
- **1:1, 4:3, 16:9, 4:5, 3:2, 3:4** — common picture shapes. The width stays and the height follows. **Swap** turns a landscape canvas into a portrait one and back.
- **1×, 2×, 3×, 4×** — how many times larger a PNG export is. The layout stays the same; a higher number just gives a sharper, larger image (shown underneath, for example 2400 × 1600 px).

If the text is too big for the canvas, a red note appears on the big canvas; the preview and exports cut the text off at the edge. **Typography → Fit text** makes it fit.

---

## 8. The shaping controls

These are in the tools panel (top left), in two tabs. (The third tab, **Sound**, does not shape the letters itself: it moves the letters with the sound, as if it were moving the sliders and seeds of these two tabs (they themselves stay where you put them; a thin line on each slider, or a small number beside each seed, shows where the sound has taken it); see [Sound tab](#sound-tab--letters-that-move-with-the-sound) below.) The **Geometry** tab is applied in a fixed order, top to bottom, so later steps work on the result of earlier ones; the **Experimental** tab comes after all of it:

**Curve flattening → Squaring → Anchors → Grid & angles → Distortion → Experimental**

All sizes are in **font units**. A font is designed on an invisible square called the **em**, usually 1000 or 2048 units wide (shown as "Units/em" in the font information). So "20 u" in a 1000-unit font is 2 % of the letter height. The settings do not change when you zoom.

Controls whose name does not say it all have a short explanation. To keep the panel tidy, explanations are folded away: click the small **ⓘ** next to a control's name to read it, and click again to fold it. To see all of them at once — handy the first time — tick **Show all explanations** at the top of the tools panel, just below the tabs (it opens the explanations in the Typography and Color tabs too). Yellow warnings and numbers are always shown. If a setting would break a shape (for example, make a letter cross over itself, or push the hole of an **A**, **B**, or **e** out of the letter so it shows as a solid blob), the app first tries a gentler version for that part of the letter — a little less squaring, a slightly simpler outline, stair steps for angle lock, or less distortion — and a grey note says so. Only if nothing works does that part keep its previous shape, with a yellow note explaining why.

### Curve flattening — how curves become straight lines

Choose one **Mode**:

- **Adaptive** — keeps the shape close to the original. **Tolerance** is how far the straight lines may stray from the curve. Small values (0.1–2) look almost identical to the original; large values (20–500) look visibly angular. On its own, Adaptive stops getting coarser at around 100 — turn on **Merge joined curves** to go further.
- **Fixed segments** — every curve is replaced by the same number of straight lines. **Segments per curve** sets that number (1–32). Fewer lines give a cruder, more faceted look.

**Merge joined curves** (works in both modes) — the key to a strong faceted look. A curve you see as one arc is usually stored in the font as several small curves. Without merging, the settings apply to each small piece, so letters still look smooth. With merging, the whole visible arc counts as one curve:

- with **Fixed segments**, try **Segments per curve** 4, then 3, then 2 to go from subtle to bold;
- with **Adaptive**, raise **Tolerance** (try 50, 150, then 500): each arc is straightened as much as the tolerance allows, down to a single line.

The merge settings below are shared by both modes, so switching mode keeps them.

- **Break merged curves at** — where one merged curve ends and the next begins:
  - **Corners & extremes** (default) — at sharp corners and at the leftmost, rightmost, top, and bottom points of each round shape. A round "O" is split into four quarter arcs, which gives balanced, symmetric facets.
  - **Corners only** — only at sharp corners. A smooth loop like "O" becomes a single curve, which can give triangular or very simplified shapes.
- **Merge through straight lines** — also merges straight parts that flow smoothly into a curve, such as the stems of n, m, and u running into their arches. They are then reshaped together with the curve, for a much coarser, "low-resolution" look. Stems may lose their ends, so this is off by default.
- **Corner angle** — how sharp a bend must be to count as a corner (default 15°); gentler bends are merged. On its own it rarely changes anything, because the curves inside a font almost always join smoothly. **Turn on Merge through straight lines to make it matter:** then raising the angle (try 45° and 90°) merges more and more of each letter into a few big strokes.

### Squaring — make round letters square

Pushes round shapes toward a rectangle. At **100 %** ("Square") a round **O** and its inner hole both become squares, while the stroke keeps its thickness.

- **Amount** — 0 % is off, **Soft** is half way, **Square** is fully square. Use the slider for anything in between.
- **Applies to:**
  - **Round contours** (recommended) — only shapes that are close to a circle or ellipse are changed, such as O, o, 0, and the bowls of b, d, g, p, q. Straight and pointed shapes like A, E, S keep their form.
  - **All contours** — every shape is pushed toward a rectangle. Much stronger, and some letters may look odd.

Tip: after squaring, add a little **Anchor reduction** (for example 2) to clean up the straight sides.

### Anchors — how many points the outline has

- **Anchor spacing** — adds extra points along the straight edges, so no edge is longer than this length. The shape does not change, but later steps (like distortion) get more points to work with. 0 is off.
- **Anchor reduction** — removes points that barely change the shape. Higher values remove more points and simplify the letter; very high values can erase small details. 0 is off.
- Using both at once cancels out (reduction removes the points spacing just added); a note warns you.
- **Reset anchors** turns both off.

### Grid & angles — a constructed, geometric look

- **Snap to grid** + **Grid size** — moves every point onto an invisible grid, like drawing on graph paper. Larger grids give blockier, pixel-like letters. While it is on, the grid is drawn faintly on the canvas.
- **Angle lock** + **Allowed directions** — straightens every edge to a set of directions:
  - **90°** — only horizontal and vertical lines.
  - **45°** — also diagonals.
  - **30°** / **15°** — finer steps.
- Where straightening would move part of a letter too far, that part gets small stair steps instead, so letters stay in place.
- When both are on, snapping happens first, so angle lock may move some points slightly off the grid.
- **Reset grid & angles** turns both off.

### Distortion — a rough, hand-made or carved edge

Moves the points of the outline in a controlled, repeatable way.

- **Noise amplitude** — how far points may move. 0 is off. Small values (5–20) give a subtle hand-cut feel; large values look worn or eroded.
- **Noise frequency** — how often the edge wobbles. Low = slow, gentle waves; high = quick, jittery roughness.
- **Normal bias** — the direction of movement. 0 % slides points along the edge; 100 % pushes the edge in and out.
- **Seed** — a number that picks one particular random pattern. The same seed always gives exactly the same result, so you can come back to a version you liked. **Next variant** tries the next pattern.
- **Reset distortion** turns it off but keeps your seed.

**A note you may see after loading Flicker.** The **Flicker** preset in the Sound tab switches Distortion to a special mode in which only a few points of each letter move — at most five — while its corners and outermost points stay where they are, so the letter keeps its shape. Each point that moves jumps clearly, and a new seed picks other points. There is no switch for this mode, so the panel says "Only a few anchors move (set by the Flicker preset in the Sound tab). Reset distortion moves every anchor again.", and an extra number, **Anchors moved**, counts the points that moved. To go back to ordinary distortion, press **Reset distortion** (it also sets Noise amplitude back to 0, so raise it again), or load another preset.

Distortion can make text harder to read — use it with care.

### Random anchors — a different look every time, but repeatable

At the very bottom of the Geometry tab. Normally the app places points on the curves at regular spacing (Curve flattening). With **Use random anchors** on, it places them at random spots on the letter's original outline instead — the points always sit on the real letter, only *where* they sit is random. The later controls (Squaring, Anchors, Grid & angles, Distortion) still apply on top.

While random anchors are on, the **Curve flattening** controls are greyed out with a note, because random anchors replace them — changing them would do nothing. Turn random anchors off to use them again.

- **Density** — roughly how many points per 1000 font units of outline. Low values (2–6) give rough, chunky letters; high values stay close to the original.
- **Randomness** — 0 % spaces the points evenly; 100 % lets each point wander within its own small stretch. Points never swap places, so the letter cannot tangle.
- **Keep sharp corners** — keeps the real corners of the letter (for example the ends of stems and serifs) so they stay crisp. Turn it off for a looser result.
- **Seed** — the number behind one particular random result.
  - **Shuffle** picks a new seed and shows it in the box.
  - **Copy** copies the seed so you can paste it into your notes.
  - **Previous** lists the seeds you tried before in this session; click one to go back to it.
  - To get a result again later, load the same font, use the same settings, and type the seed into the box.
  - At **Randomness** 0 % the points are evenly spaced, so the seed does nothing and is greyed out.
- **Reset random anchors** turns it off and restores the other settings, but keeps your seed.

The seed is also shown in the status line at the bottom and in the export dialog, so it is recorded with what you export.

### Experimental tab — effects you can stack

Next to the **Geometry** tab at the top of the tools panel. The effects here work on the finished result of the Geometry tab, and you can turn on as many as you like at once. **Noise**, **Ripple**, **Curl**, and **Wind** each fold the letters along **straight creases**: they add corners but never curves. Up to 100 %, no combination of them can make a letter cross itself or push the hole of an **A**, **B**, or **e** out of the letter. **Spikes** works differently: it pulls a few points of each letter far out into straight spikes, which may cross the letter (see below). They always run in the same order: **Noise**, then **Ripple**, then **Curl**, then **Wind**, then **Spikes**.

**Beyond 100 % — folds.** Noise, Ripple, Curl, and Wind's Gustiness go past 100 % (Curl in both directions). There the letters fold over themselves like paper crushed flat: strokes land on other strokes, holes fill in or open up, and the letters stop being readable. Wherever parts overlap they are merged into one clean shape, still made only of straight lines, so the font still exports. While an effect is past 100 %, or **Spikes** is on, the top of the tab shows how many places were merged (**Crossings merged**) and how many specks too small to show were dropped (**Slivers dropped**).

**Noise — crumpled paper**

- **Use noise** — turns it on.
- **Amount** — how strongly the letters are crumpled, up to 500 %. Small values give a light, hand-folded feel; 100 % gives sharp, obvious folds; above that the folds flip over each other, and towards 500 % the letters break into a heap of overlapping shards.
- **Facet size** — the size of the folds, as a share of the em (the font's design square). Small facets give many small folds; large facets give a few big ones that can bend whole strokes. The smallest size still keeps the folds far enough apart to read as corners.
- **Turn** — which way the folds go. Raising **Amount** pushes every fold further the same way; Turn points them another way while the creases stay where they are. At 180° the letters are crumpled the opposite way. (**Next variant** under Seed instead gives a completely new sheet of paper.)
- The numbers show how far the outline moved at most (**Max move**) and how many corners the folds added (**Creases**).

**Ripple — polygonal waves**

- **Use ripple** — turns it on.
- **Amount** — how far the waves push the outline in and out. Around 50 % the letters stay readable; 100 % squeezes strokes between the rings into thin slivers and tears the letters into sharp, broken shapes; above that, up to 400 %, the rings pass through each other and the letters fold into spiky, star-like shapes.
- **Wavelength** — the distance from one wave to the next, as a share of the em (up to 200 %). Short waves give many fine zigzags; long waves bend whole strokes or swell the whole letter.
- **Sides** — the shape of the rings: 3 gives triangles, 4 squares, 8 octagons, up to 12. The rings always sit on a flat side.
- **Center X / Center Y** — where the waves start, as a share of each letter's width and height (50 % / 50 % is the middle of the letter). Values below 0 % or above 100 % put the center outside the letter, so the waves sweep across it from one side.
- **Fade** — how much the waves die down away from the center. At 100 % they are gone by the far edge of the letter.
- **Petals** — turns the rings into a flower with straight-edged petals, one per side, so **Sides** sets how many petals there are (3 gives a three-leaf shape). Small values give a faceted flower inside round letters like **o** and **e**; at 100 % and above, up to 300 %, the whole letter becomes a large flower, and the notches between the petals pinch strokes into hairlines. Petals alone never folds the letter; combine it with **Amount** above 100 % for folded, chaotic blossoms.

**Curl — swirls**

- **Use curl** — turns it on.
- **Amount** — how far the letters swirl around their middle, from −400 % to 400 %. Below 0 % the swirl turns clockwise instead. Around 60 % the letters get a clear twist; at 100 % the swirl turns as far as it can while every letter keeps its shape. How far that is depends on **Sides** and **Rings**: about a twelfth of a turn with 3 sides, more than a full turn with 12 sides and many rings. Beyond 100 % either way, the rings turn past each other and the letters fold onto themselves.
- **Pin top and bottom** — on (the default): the top and bottom of each letter stay where they are and the middle twists. Off: the middle stays where it is and the outside turns instead, so the top and bottom swing round too and the whole letter spins.
- **Rings** — how many rings the swirl is made of, from the middle of the letter out to its top and bottom (2–12). Fewer rings give bigger, chunkier facets; more rings give a finer swirl of many small straight pieces.
- **Sides** — the shape of the rings: 3 gives triangles, 4 squares, 8 octagons, up to 12. More sides let the swirl turn further before the letters fold.

**Wind — letters pulled out by the wind**

- **Use wind** — turns it on.
- **Direction** — where the wind blows to: 0° to the right, 90° up, 180° to the left, 270° down.
- **Strength** — how much longer the letters get. The side facing the wind stays where it is; the further downwind a part of the letter lies, the further it is pulled. At 100 % a part is pulled as far again as it lies from the side facing the wind, at 800 % eight times as far (but never more than 4 em), so letters reach far into their neighbours.
- **Gust size** — the width of the bands the gusts pull, as a share of the em. With a level wind (0° or 180°) every letter on a line shares the same bands, so the streaks run straight through the text.
- **Gustiness** — how different the bands are. At 0 % every band is pulled equally and the letters are simply stretched; at 100 % some bands barely move while others are dragged far, leaving ragged, straight-edged streaks; above 100 % (up to 200 %) some gusts blow backwards, tearing the letters apart.

**Spikes — points that shoot out**

A few points (anchors) on the outside of each letter jump straight out into the canvas, away from the letter, and the two edges that meet at each of them stretch into a long, straight spike. Only the outer outline of a letter spikes: the holes of letters like **o**, **e**, and **B** never do. Spikes runs last, on the letters as the other effects left them.

- **Use spikes** — turns it on.
- **Anchors** — how many points of each letter jump, from 1 to 12 (3 to start with).
- **Reach** — how far they jump, as a share of the em, up to 200 % (60 % to start with). Each point goes its own distance, somewhere between about a third of Reach and all of it, so the spikes come out in different lengths. At 200 % the longest reach two ems out, far into the neighbouring letters. At 0 % nothing jumps.
- **Spread** — which way they jump (50 % to start with). At 0 % every point jumps straight out, at right angles to the outline; the higher the Spread, the further each one may lean to either side, up to 90° at 100 %, so the spikes fan out in all directions.
- **Width** — how wide each spike is where it leaves the letter (30 % to start with). At 0 % it is a thin needle; at 100 % the jumping point drags the whole of its two edges along, so the spike is a wide wedge that pulls part of the letter with it.
- The numbers show how many points jumped (**Spikes**) and how far the longest one went, in font units (**Longest**).
- **The seed decides where.** Which points jump, which way they lean, and how far each goes are picked by the tab's **Seed** (below): the same seed always gives the same spikes, and **Next variant** makes them jump somewhere else. When the Sound tab drives the Seed (for example **Beat** → **Seed**, or the **Flare** preset), they jump somewhere new on every beat.
- **Spikes may cross.** A spike can cut across its own letter or another spike. There the shapes are merged into one clean outline, as with folds above, so the font still exports. Every spike is made of straight lines only.
- **Try it:** tick **Use spikes**, set **Anchors** to 1 and **Reach** to 100 %, then press **Next variant** under Seed a few times: each time, one point of every letter shoots out somewhere else.

**Seed** — one number for all the effects on this tab: it picks Noise's folds, Wind's gusts, and which points Spikes moves (Ripple and Curl have no randomness). The same seed and settings always give the same letters; **Next variant** tries the next one. **Reset experimental** turns every effect off and restores its settings, but keeps your seed.

Every copy of a letter gets the same folds and spikes, so an exported font looks exactly like the canvas.

### Sound tab — letters that move with the sound

The third tab, next to **Experimental**. It plays an audio file or listens to the microphone and measures the sound as it goes: how loud it is, how much bass, middle, and treble it has, how bright or noisy it sounds, which note is playing, where the beats fall and how fast they come, and where the sound sits between left and right. It can also move the letters with the sound: you connect a reading, such as loudness, to a slider, such as Distortion's **Noise amplitude**, and while the music plays the letters roughen when it gets loud and calm down when it gets quiet. You can also connect a reading to a **seed**, so that the points of the letters jump to new places on every beat (see **Mappings** and **Seeds** below).

The sound only ever moves sliders and seeds, and only within their own range, so every shape you see is one you could also make by hand with the sliders and seed boxes — built from straight lines, like everything else in the app.

Your audio stays in your browser: a file is read on your computer and never uploaded, and the microphone is only used while you listen.

**Source** — where the sound comes from:

- **Off** — the default: nothing plays and nothing listens.
- **File** — an audio file from your computer.
  - **Choose file** — pick the file. Most common formats work (MP3, WAV, AAC, OGG, or FLAC, depending on your browser), up to 512 MB. Its name and length (minutes:seconds) appear beside the button; a long name is cut short, and pointing at it shows it in full.
  - **Play** / **Pause** — plays the file through your speakers or headphones. **Play** and **Position** stay greyed out until you have chosen a file.
  - **Loop** — starts the file again from the beginning when it ends. It is on at the start.
  - **Position** — drag to jump to another part of the file. The number shows where you are and the total length, for example "0:42 / 3:15".
- **Microphone** — the sound around you, for example music playing in the room, your voice, or clapping.
  - Choosing **Microphone** shows the **Start listening** button; the microphone turns on only when you click it. The first time, your browser asks whether this page may use the microphone: click **Allow**.
  - **Stop listening** turns the microphone off; **Start listening** turns it on again.
  - While it listens, **Listening** shows next to the button, and **Microphone on** shows in the status line at the bottom, so you can see it from every tab. On a narrow screen, such as a phone, it floats at the bottom right of the screen instead.
  - If the microphone stops by itself (it was unplugged, or the browser's permission was taken away), the status line says **No microphone**.
  - The microphone's sound is only measured, never played back, so it cannot howl through your speakers.
  - **Stop listening**, switching to **Off** or **File**, and closing the page all turn the microphone off.
- Switching to **Off** stops the file and the microphone. Switching back to **File** keeps the file you chose, paused.
- If a file plays or the microphone listens but nothing is heard for 3 seconds, the tab says **No sound detected.** Check the volume and that the microphone is not muted, or raise **Sensitivity** (below).

**Levels** — what the sound is like right now: 20 readings in six groups, each on one line with its name, a bar, and a number. Click the **ⓘ** next to a group's name for a short explanation. While nothing plays or listens, the bars are empty and the numbers show "—". Most numbers are percentages: a full bar is 100 %.

- **Loudness**
  - **Level** — how loud the sound is overall. The number is in decibels (dB): the bar is empty at −60 dB and full at 0 dB, the loudest a recording can be. It shows "—" when it is silent.
  - **Swell** — Level, slowed down: it takes about a third of a second to rise and a few seconds to sink, so it follows the big shape of the music — a quiet verse, a loud chorus — rather than every hit. Good for big, calm movements.
- **Bands** — **Low**, **Mid**, **High**: how much bass (below 250 Hz: bass drum, bass guitar), middle (250–2000 Hz: voices and most instruments), and treble (above 2000 Hz: cymbals, hiss, "s" sounds) there is. Each one is compared with its own loudest moment of the last few seconds, so the bars adapt to the music: a full bar means "as strong as this part of the sound has recently been", not "very loud".
- **Narrow bands** — finer slices, each compared with its own loudest moment in the same way (1 kHz is 1000 Hz):
  - **Sub** (20–60 Hz) — the deepest rumble, felt more than heard.
  - **Bass** (60–250 Hz) — bass drum and bass guitar.
  - **Low mid** (250–500 Hz) — the warm body of voices and instruments.
  - **High mid** (2–4 kHz) — the bite of voices, guitars, and snare drums.
  - **Presence** (4–6 kHz) — the clarity and edge of voices and instruments.
  - **Air** (above 6 kHz) — cymbals, hiss, and breath.
- **Tone**
  - **Brightness** — where the energy sits: dull, bass-heavy sound reads low; hiss and cymbals read high.
  - **Noisiness** — how much the sound is like noise rather than clear notes: a held note or chord reads near 0 %; hiss, cymbals, and drums read high.
  - **Pitch** — the note being played or sung. It is made for one note at a time, such as a voice or a melody. The number is in hertz (Hz): the higher the number, the higher the note (440 Hz is the A that orchestras tune to). The bar is empty at 55 Hz (the lowest A of a bass guitar) and full at 1760 Hz, five octaves higher; each octave takes a fifth of the bar. Between notes (for example during a drum hit) it keeps the last note; in silence it drops back and shows "—".
- **Rhythm**
  - **Beat** and **Kick** — bars that jump to full at once and fall back, as fast as **Smoothing** (below) sets. **Beat** jumps on every new sound that starts suddenly: a drum hit, a clap, a plucked note. **Kick** jumps on sudden bass: mostly the bass drum, the deep "boom" of most dance and pop music, and sometimes a sudden low bass note. Every Kick also makes Beat jump, even when other sound drowns out the drum. A hi-hat, for example, makes Beat jump but not Kick. They work the same with reduced motion turned on in your computer's settings.
  - **Change** — how much the sound is changing right now: near 0 % on a steady sound, such as a held note, a hum, or steady hiss, and high on every attack — drum hits, new notes, sudden changes. It is compared with the biggest change of the last few seconds.
  - **Pace** — how many beats came in the last two seconds, as beats a second: 8 a second fill the bar, 4 a second fill half. Every Beat counts, so fast hi-hats count too.
- **Stereo** — where the sound sits between the left and right speakers. This needs a stereo source, so it is mainly for files: a microphone that records a single channel (mono) always reads "C" for Balance and 0 % for Width.
  - **Balance** — the side the sound leans to: "C" when it is centred, "L 40" when it leans 40 % to the left, "R 40" when it leans 40 % to the right ("L 100": only the left speaker plays). Its bar grows from the middle towards that side. It is the only reading that goes both ways.
  - **Width** — how wide the sound is spread: 0 % when both speakers play the same (mono), around 100 % when the left and right are completely different.
- Very quiet sound counts as silence: the readings fall back to empty (Swell and Pace more slowly), Balance returns to the middle, and Beat and Kick do not jump, so background noise does not make them flicker.

**Mappings** — which sliders and seeds the sound moves, and how. Each mapping connects one reading to one slider or seed.

- **Drive letters** — the main switch. The sound moves the letters only while this is ticked **and** a file plays or the microphone listens. Untick it to keep watching the meters while the letters stay still. If your computer is set to reduce motion, it starts unticked and the tab says "Off because your system asks for reduced motion."; tick it if you want the letters to move anyway. If you turn on reduce motion while the page is open, it unticks itself.
- **Preset** and **Load** — set the letters up and fill in ready-made rows in one go; see **Presets** below.
- **Add mapping** — adds a row. The first one connects **Level** to **Distortion · Noise amplitude** at **+50%**, a good first try; later ones pick a target that no row uses yet — one that already has an effect, if there is one. You can have up to 8 rows; then the button is greyed out and the tab says "Up to 8 mappings."
- Each row has:
  - **Feature** — the reading that drives it: any of the 20 readings above, listed in the same six groups.
  - **Target** — what it moves. A slider is named after its group and its label, for example "Ripple · Petals". There are also three seeds: "Distortion · Seed", "Random anchors · Seed", and just "Seed" for the Experimental tab's seed. The list has two parts, **Geometry** and **Experimental**, in the same order as the tabs.
  - **Depth** — for a slider: how far it moves, from −100 % to +100 %. At +100 % the strongest sound takes the slider the whole length of its track; at +50 %, half of it. Negative values move it the other way, so louder sound turns the value down. 0 % does nothing. **Balance** goes both ways: with a positive Depth, sound on the right turns the value up and sound on the left turns it down.
  - **Rate** — for a seed, the same slider reads **Rate** instead, from 0 % to 100 %: how often the seed jumps (see **Seeds** below). 0 % does nothing.
  - A tick box that switches the row on or off without deleting it, and an **×** button that removes it.
- **How far a slider moves:** it starts from where you left it. If a slider sits a quarter of the way along and Depth is +50 %, full sound takes it to three quarters; silence leaves it where it is. It never goes past either end of its track, and it moves in the same steps as the slider itself. Two rows on the same slider add up.
- Some sliders change faster towards one end, like **Tolerance**. The sound still takes them evenly along the track, just as your hand would.
- **Settings switched on for you.** Many targets only have an effect while another setting is on: Ripple's sliders need **Use ripple**, **Grid size** needs **Snap to grid**, and so on. When you pick such a target (or **Add mapping** adds one), the app switches that setting on and says what it changed in a note under the row, for example "Turned on Ripple." or "Set Noise amplitude to 40.":
  - a Noise, Ripple, Curl, Wind, or Spikes slider turns its effect on;
  - the Experimental **Seed** acts while Noise, Wind, or Spikes is on (Ripple and Curl have no randomness); when all three are off, it turns on Noise;
  - **Grid size** turns on **Snap to grid**;
  - Distortion's **Noise frequency**, **Normal bias**, and **Seed** set **Noise amplitude** to 40 when it is 0 (at 0, Distortion is off);
  - Random anchors' **Density**, **Randomness**, and **Seed** turn on **Use random anchors**; the Seed also sets **Randomness** to 100 % when it is 0 %;
  - the Curve flattening sliders turn random anchors off (they replace flattening) and set what they need: **Tolerance** sets **Mode** to Adaptive, **Segments per curve** sets it to Fixed segments, and **Corner angle** turns on **Merge joined curves** — for example "Turned off Random anchors. Set Mode to Adaptive." (Corner angle shows little on its own; see Curve flattening.)
- Changing a row to another target, or removing it, never switches anything off again. The note stays until you change the row's target or remove the row. If you go through the **Target** list with the arrow keys, only the target you settle on switches anything on, when you press Enter or move on to another control; a pick with the mouse or a finger counts at once.
- If the setting is off again later — you switched it off yourself, or another row needed a different Mode (Tolerance needs Adaptive, Segments per curve needs Fixed segments) — a grey note under the row says why, for example "Turn on Ripple to hear this.", and an **Enable** button next to it switches the setting on again.
- **What can be driven:** every slider of the **Geometry** and **Experimental** tabs — Tolerance, Segments per curve, and Corner angle; Squaring Amount; Anchor spacing and Anchor reduction; Grid size; Noise amplitude, Noise frequency, and Normal bias; Random anchors Density and Randomness; and every slider of Noise, Ripple, Curl, Wind, and Spikes — and the three seeds. Switches and choices (such as **Mode** or **Allowed directions**) cannot be driven.
- Mappings are not saved: like your other settings, they last until you close the page.

**Seeds** — points that jump to new places. A seed picks one random pattern (see Distortion, Random anchors, and the Experimental tab). When the sound drives a seed, each jump moves it on by one — 1234 becomes 1235 — and because every seed is a completely different pattern, every point of the outline lands somewhere new at once (after loading **Flicker**, only a few points of each letter move, a different few each time). After 999 999 it starts again at 0.

- **Rate** — how often the seed jumps:
  - with **Beat** or **Kick**, it counts hits: at 100 % the seed moves on at every hit, at 50 % at every other hit, at 25 % at every fourth;
  - with any other reading, it jumps more often the higher the reading is: up to about 5 times a second at 100 % when the bar is full, half as often when the bar is half full. For Balance, either side counts.
  - The **ⓘ** next to **Rate** explains this too.
- **Never too fast:** all seeds together jump at most about 5 times a second, and seeds that jump at the same moment count as one jump, so the letters cannot flash. With fast drums some hits are then skipped; they are not saved up for later.
- **Your seed stays in its box.** Next to a driven seed's box, a small number in the colour of the live lines shows the seed the letters use right now (the live seed). The **Seed** in the Distortion and Random anchors statistics, and the status line at the bottom, show the live seed too. When the sound stops moving the letters — you pause, the file ends, or you untick **Drive letters** or the row — the letters go back to the seed in the box, and the next **Play** starts from it again. To keep a seed you like, press **Freeze**: it writes the live seed into the box.
- **Try it — anchors that jump on the beat:**
  1. Choose **File** → **Choose file**, pick a song with clear drums, and press **Play**.
  2. Click **Add mapping**.
  3. Set **Feature** to **Beat** and **Target** to **Distortion · Seed**. If **Noise amplitude** was 0, the note "Set Noise amplitude to 40." appears under the row: the outline is now rough, so there is something to move.
  4. The row's slider now reads **Rate**: set it to 100 %. The rough outline takes a new shape on every beat. For the bass drum only, choose **Kick**; for calmer jumps, lower the Rate.

**Presets** — ready-made starting points, the quickest way to start:

1. Choose **File** → **Choose file** and pick a song (or choose **Microphone**).
2. Under **Mappings**, pick a preset in the **Preset** list. Picking only selects it: nothing changes yet.
3. Press **Load**.
4. Press **Play** (or **Start listening**).

- **Load starts the letters afresh.** It first puts every setting in the **Geometry** and **Experimental** tabs back to how it was when you opened the app — your three seeds are kept — then sets the few sliders the preset starts from, and replaces your rows with the preset's. So a preset always looks the same, whatever you had set before. Your text, typography, colours, canvas, and the Sound settings themselves (source, Sensitivity, Smoothing) are not touched.
- **A note under Preset says what Load did,** for example "Loaded Bloom. Turned off Noise. Other Geometry and Experimental settings back to defaults (seeds kept)." It names the effects it switched off, so you know what went. The note goes away when you load again or pick another preset.
- Load does not ask first and cannot be undone, so if you like your current settings, note them down before you press it. Picking a target yourself, as described above, never puts anything back to its default: it only switches on what that target needs.
- After loading, change, add, or remove rows, or move any slider, as usual. The **ⓘ** next to **Preset** lists the presets too.
- The presets:
  - **Flicker** — on every beat a few points of each letter jump while the rest hold the letter in shape; louder sound and the bass drum throw them further. This uses a special Distortion mode (see Distortion).
  - **Scatter** — the points are placed afresh on every other beat: close and even when it is quiet, fewer and more uneven as it gets louder. Loading it turns on random anchors.
  - **Pixel** — the letters snap to a grid that gets coarser with the bass; hiss and cymbals remove points.
  - **Low poly** — loud passages flatten the curves into fewer, longer sides; noisy sound removes points.
  - **Block** — round strokes square off as the music swells, and a little more on each bass drum.
  - **Jitter** — hiss and cymbals make the outlines tremble; brighter sound makes the trembling finer.
  - **Facet** — curves break into a few straight sides as it gets louder and on each bass drum; higher notes smooth them again.
  - **Bloom** — ripples run through the letters and swell on each bass drum; the bass bends them into petals. Loading it turns on Ripple.
  - **Flare** — no spikes while it is quiet; as it gets louder, spikes shoot out of one or two points of each letter and jump somewhere new on every beat; bass drums add more. Loading it turns on Spikes.
  - **Gale** — loud sound drags the letters out like wind; busy passages make the gusts uneven. Loading it turns on Wind.

**While the sound moves the letters:**

- **Your sliders stay where you put them.** On each driven slider, a thin coloured line moves along the track to show where the sound has taken it right now (a driven seed shows its live seed beside its box instead; see **Seeds** above). When you pause, the file ends, you untick **Drive letters**, or you switch the source to **Off**, the letters go back exactly to your slider settings and seeds, and the lines and live seeds disappear.
- **Live · N fps** — shown in the Sound tab and in the status line at the bottom: how many new shapes a second the app can keep up with (fps means frames per second). The app draws the next shape as soon as the last one is ready, at most 30 a second, so heavy settings and long texts give fewer.
- **No flashing:** a slider never swings back and forth more than 3 times a second (counting only swings of a tenth of its track or more). When the music would make it do that (fast drums with a short **Smoothing**, for example), the slider waits a moment before it swings again. Seeds have the same kind of limit (see **Seeds** above).
- If that falls below about 8 a second, the tab says "Too slow to follow the sound: try fewer effects or a shorter text." Turning off some Experimental effects, using a shorter text, or choosing lighter settings helps.
- **Freeze** — copies what the letters look like right now into the sliders and seed boxes and pauses the sound (the file pauses, or the microphone stops listening). That moment stays on screen as ordinary settings that you can keep adjusting or export. Press **Play** or **Start listening** to carry on. Freeze is greyed out while the sound is not moving the letters. Pressed while the letters match your sliders (for example between two drum hits), it only pauses the sound.
- **Exports always use the sliders and seed boxes**, never the moving letters. To save a moment of the music, press **Freeze** first, then **Export…**. While the sound is moving the letters, the export dialog reminds you of this. **Fit text** and **Free** (in the Typography tab) also measure the letters as your sliders make them, as exports do.

**Analysis** — how the sound is measured:

- **Sensitivity** — boosts or cuts the input before measuring, for quiet or loud sources (−24 to +24 dB, default 0 dB). Raise it for a quiet room or a distant microphone, which also helps Beat and Kick catch quiet hits; lower it if the bars are always full.
- **Smoothing** — how slowly the readings fall back after a sound: short is jumpy, long is calm (20–1000 ms, default 150 ms). Most readings rise at once, and Beat and Kick fall back at this speed too; Swell and Pitch keep their own speed.
- **Reset sound** — puts Sensitivity and Smoothing back to 0 dB and 150 ms. It is greyed out when they already are.

**If something goes wrong**, a message appears under the source (pointing at it may show the browser's own technical detail):

| Message | What it means | What to do |
|---|---|---|
| This browser cannot analyse sound. | Your browser cannot measure sound. | Use a recent Chrome, Edge, Firefox, or Safari. |
| This browser cannot use the microphone. | Your browser cannot open a microphone here. | Try another browser, or use a file. |
| This file is not audio this browser can play. | The file is not audio, is damaged, or is in a format this browser does not know. | Try an MP3 or WAV file, or another browser. |
| This file has no length. | The file is empty. | Choose another file. |
| This file is too large (over 512 MB). | The file is too big to open. | Use a shorter or compressed file, such as an MP3. |
| Microphone access was refused. Allow it in the browser’s site settings, then try again. | You or the browser said no to the microphone. | Open the site settings (usually the icon at the left of the address bar), allow the microphone, then click **Start listening**. |
| No microphone found. | No microphone is connected, or it was unplugged while listening. | Connect one, then try again. |
| The microphone could not be opened; another app may be using it. | Another program, such as a video call, may be using it. | Close that program, then try again. |
| The microphone needs a secure page (https or localhost). | The page was opened from an address starting with `http://`. | Open the app's `https://` address. |

### Typography tab — size, spacing, and alignment

The **Typography**, **Glyphs**, and **Color** tabs are at the bottom left. These place the text on the canvas. They do not change the shape of the letters or the exported font file.

- **Size** — the letter size in pixels (how tall one em is on the canvas). It stays the same when you change the canvas size. You can drag the slider or type a number.
- **Fit text** — makes the text as large as possible while keeping a 25-pixel gap to the canvas edges.
- **Tracking** — extra space between letters. Negative values pull letters closer.
- **Line height** — space between lines. 1 is the font's own line spacing; 2 is double.
- **Slant** — leans the letters, like a quick italic. Positive leans right, negative leans left.
- **Align** — the three buttons with lines line up the lines of text on the left, in the centre, or on the right.
- **Position** — where the text sits on the canvas. Click one of the nine dots: a corner, the middle of an edge, or the very middle. The text moves there, keeping a 25-pixel gap to the edges, and its lines line up to match: dots on the left line up left, in the middle centred, on the right line up right. The chosen dot glows. Click **Free** to place the text yourself: it first goes back to the starting position, then you drag it on the big canvas (click Free again any time to send it back). It stops at the canvas edges, so it can never be dragged off the page. Dragging anywhere else on the canvas still moves the view.
- **Reset typography** puts these back to their starting values.

### Color tab — text and background colours

- **Presets** — twelve ready-made colour pairs; the two dots show the text colour and the background. **Charcoal** (dark text on light paper) is the default.
- **Random** picks a random pair that is still easy to read. **Swap** exchanges the text and background colours.
- **Text** and **Background** — click the colour bar to pick any colour, or type a hex code such as `#35f2b4`.
- **Transparent background** — exports leave the background out, so you can place the text on something else. The canvas then shows a checkerboard (made from your colours, so the text stays easy to read).
- Under them, **Contrast** tells you how readable the pair is; below 3 : 1 a yellow note warns that the text will be hard to read.

The colours are used by the canvas, the preview, and SVG and PNG exports. A font file has no colour.

---

## 9. Recipes

**Bold, faceted letters (like "4 / 3 / 2 lines per curve")**
Curve flattening → **Fixed segments**, **Merge joined curves** on, **Break merged curves at** = Corners & extremes, **Segments per curve** = 4 (subtle), 3, or 2 (bold).

**Faceted letters in Adaptive mode**
Curve flattening → **Adaptive**, **Merge joined curves** on, **Tolerance** 50 (subtle), 150, or 500 (very bold).

**Extreme low-resolution letters**
As above (either mode), then turn on **Merge through straight lines** and raise **Corner angle** to 45°–90°. Try **Break merged curves at** = Corners only for the most reduced shapes.

**Square O and round letters**
Squaring → **Square**, Applies to **Round contours**, then Anchors → **Anchor reduction** = 2. Type "OO oo 00" to check.

**Pixel / grid look**
Grid & angles → **Snap to grid** on, **Grid size** around 5 % of the font's Units/em (for example 50 in a 1000-unit font). Add **Angle lock** at **90°** for only horizontal and vertical edges.

**Carved or worn stone**
Fixed segments 3 with merging, then Distortion → **Noise amplitude** 10–30, **Noise frequency** 8–15, **Normal bias** 70 %. Try **Next variant** until you like the pattern.

**Random, hand-cut look**
Random anchors → **Use random anchors** on, **Density** 3–5, **Randomness** 100 %, **Keep sharp corners** on. Press **Shuffle** until you like it, then **Copy** the seed.

**Crumpled paper**
Experimental tab → **Use noise** on, **Amount** 70–100 %, **Facet size** 15–25 %. For bold, chunky folds, combine it with a large Curve flattening **Tolerance** (40 or more). Press **Next variant** until you like the folds.

**Polygonal ripples**
Experimental tab → **Use ripple** on, **Amount** 50 %, **Wavelength** 25–35 %, **Sides** 6 or 8. For hard, triangular shock waves try **Sides** 3 with a large Curve flattening **Tolerance**; for a wave sweeping in from a corner, set **Center X** and **Center Y** to 0 %.

**Faceted flowers**
Experimental tab → **Use ripple** on, **Amount** 0–30 %, **Petals** 40–60 %, **Sides** 5 (or 4 for a four-leaf look). For wild blossoms, raise **Petals** to 100–200 % and **Amount** to 200 % or more.

**Whirlpool letters**
Experimental tab → **Use curl** on, **Amount** 60–100 %, **Pin top and bottom** on for a twist inside the letter (off to spin the whole letter), **Rings** 4–6, **Sides** 8. Push **Amount** past 100 % for folded, shredded swirls.

**Blown away**
Experimental tab → **Use wind** on, **Strength** 30 %, **Gust size** 10–15 %, **Gustiness** 60–100 %. Raise **Tracking** in the Typography tab if the letters run into each other, and press **Next variant** for different gusts.

**Unreadable, shattered letters**
Experimental tab → **Use noise** at 300–500 %, or **Use ripple** at 200–400 %, or **Use wind** with **Gustiness** 150–200 %. Combine them for total chaos, and press **Next variant** until the shapes surprise you. Exporting a whole large font with every effect at its maximum can exceed the file's point limit; export only the characters in the text instead.

**Letters that pulse with the music**
Sound tab → **File** → **Choose file** → **Play**. Under **Mappings**, click **Add mapping** (Level → Distortion · Noise amplitude, +50 %): loud passages roughen the letters, quiet ones smooth them. For a stronger effect raise **Depth**, or start Distortion's **Noise amplitude** a little higher. Press **Freeze** at a moment you like, then export it.

**Petals that open on the bass**
Experimental tab → **Use ripple** on, **Amount** 0–30 %, **Petals** 0–20 %, **Sides** 5. Sound tab → **Add mapping**, then set **Feature** to **Low**, **Target** to **Ripple · Petals**, and **Depth** to +30 %. For a shiver on the cymbals as well, add **High** → **Noise · Amount** (this turns on Noise for you).

**Anchors that jump on the beat**
Sound tab → **File** → **Choose file** → **Play**. Click **Add mapping**, set **Feature** to **Beat**, **Target** to **Distortion · Seed** (if **Noise amplitude** was 0, it is set to 40 for you), and **Rate** to 100 %: the rough outline takes a new shape on every beat. For points that move along the letter itself, choose **Random anchors · Seed** instead (this turns on random anchors); for the bass drum only, choose **Kick**. Press **Freeze** when you like a shape.

**Back to the original**
Set Curve flattening to **Adaptive** with a small **Tolerance**, and turn off Squaring, Anchors, Grid & angles, Distortion, and the Experimental effects (each has a reset button). Or simply choose **Original** in the canvas toolbar to look at the untouched font.

---

## 10. Saving your work (Export)

Click **Export…** in the top-right corner. Nothing is downloaded until you press a download button.

Exports always use your slider settings and seeds. If the **Sound** tab is moving the letters, press **Freeze** first to export the moment you see.

### As an image (SVG or PNG)

Both save the canvas: its size, your text placed as on the canvas, and your colours.

1. Choose **SVG — main view** (shapes you can keep editing) or **PNG — main view** (a picture).
2. For a transparent background (only the letters are drawn), tick **Transparent background** in the Color tab first.
3. Optional: tick **Export the preview look** to save what the small preview shows instead — its blur, and its swapped colours if **Invert** is on. Set Blur and Invert in the preview first.
4. For SVG, **Coordinate precision** — how many decimals the numbers in the file keep; 2 is a good default. For PNG, the image size comes from **Canvas size** (width × height × the 1×–4× multiplier).
5. Click **Download SVG** or **Download PNG**.

SVG files open in Illustrator, Figma, Inkscape, and web browsers; the shapes contain only straight lines. A blurred SVG uses a blur effect that browsers and most design apps show; if an app ignores it, use PNG.

### As a font (OTF)

1. Choose **Font file — OpenType (.otf)**.
2. **Glyphs to include:** **Current glyph**, **Specimen characters** (only the characters in your text), or **All mapped characters** (every letter the font has).
3. Give it a **Family name** and **Style name** — use plain English letters. A new name avoids confusion with the original font.
4. Click **Build & verify**. The app builds the font and then checks it thoroughly. This can take a few seconds for large fonts; **Cancel** stops it.
5. When it says "Verified", click **Download .otf** and install the font like any other.

Good to know:

- If you change any setting after building, build again before downloading.
- The new font has **no kerning**, ligatures, or other advanced features of the original — only the reshaped letters and their widths.
- Letters are saved with the same weight, style (for example italic), slant, line spacing, and copyright and license details as the original font, so a Regular and a Bold you make install side by side like the originals.
- Very rarely a letter may be left out if its shape has details too fine for a font file to store; the app lists them. Less **Distortion** or **Anchor spacing** usually helps.
- With very dense settings (Anchor spacing near 1) a whole font can have too many points for one file; the app stops and suggests a larger Anchor spacing or exporting only the characters in your text.
- Variable fonts are saved in the version you see on screen.
- **Licensing:** a modified font is still based on someone else's design. Check the original font's license before sharing it — many open-source fonts require a new name for modified versions. If the original reserves its name, the export dialog tells you to choose a different family name.

---

## 11. Questions and answers

**My letters still look smooth even with few segments.**
Turn on **Merge joined curves** (Fixed segments mode). Without it, each small piece of a curve gets its own segments.

**Changing Corner angle does nothing.**
Turn on **Merge through straight lines** (under Merge joined curves). Without it, Corner angle only affects joints between two curves, which are almost always smooth already.

**I liked a random-anchor result. How do I get it back?**
Write down (or **Copy**) its seed. Later, load the same font, set the same Random anchors settings, and type the seed into the **Seed** box. Within one visit you can also click it under **Previous**. If the sound picked it, press **Freeze** first: that writes the live seed into the box.

**Why don't I see the skeleton points or green vertices?**
They only appear when letters are big enough. Zoom in on the canvas.

**Some controls are grey and do not move.**
They would have no effect right now. The note above them says why — for example, Curve flattening is greyed out while Random anchors are on, and the random Seed is greyed out at 0 % Randomness.

**Clicking a character in Glyphs put it in the wrong place.**
It goes where the text cursor last was. Click in the text box where you want it, then click the character.

**A yellow note says some contours "kept their previous shape".**
That setting would have made part of a letter collapse, cross over itself, or run into another part of the letter (such as its hole), so the app kept the last good version for that part. Try a gentler value.

**A letter shows as a dashed red box.**
The font does not contain that character, or (for Google Fonts) it is in another character subset. Load a different subset or font.

**Will my results change if I reload the page?**
Settings are not saved between visits. Within a session, the same settings and seed always give the same result. Export what you want to keep.

**The letters do not move with the music.**
In the Sound tab, check that the file is playing (or the microphone is listening), that **Drive letters** is ticked, and that there is at least one mapping that is ticked and has a **Depth** (or **Rate**) other than 0 %. If a grey note sits under the row, click **Enable** next to it — for example, "Turn on Noise to hear this." means the Noise effect is off. If the meters stay empty, the sound is too quiet: raise **Sensitivity**.

**The sliders and seeds do not move while the letters do.**
That is on purpose: your sliders and seed boxes keep your settings. The thin line on each driven slider shows where the sound has taken it, and the small number beside a driven seed's box is the live seed. When the sound stops, the letters go back to your settings. Press **Freeze** to copy the current look into the sliders and seed boxes.

**A setting switched itself on when I picked a target.**
That target only has an effect while that setting is on, so the app switched it on and said so under the row (for example "Turned on Ripple."). It stays on when you change the row's target or remove the row; switch it off yourself if you do not want it.

**My export does not look like the moving letters.**
Exports use the sliders, not the sound. Press **Freeze** at the moment you want, then export.

**Does anything get uploaded?**
No. Local fonts and audio files stay on your computer, and the microphone's sound is only measured in your browser. Google fonts are downloaded from Google; nothing is sent anywhere else.

---

## 12. Glossary

| Term | Meaning |
|---|---|
| **Glyph** | One drawn shape in a font — a letter, number, or symbol. |
| **Contour** | One closed outline. "O" has two: the outside and the hole. |
| **Counter** | The enclosed hole inside a letter, as in "o", "a", "B". |
| **Curve / segment** | A piece of outline between two points. Fonts store curves as Bézier curves. |
| **Anchor (on-curve point)** | A point that lies on the outline. |
| **Control point (off-curve point)** | A point that pulls the curve toward it without lying on it. |
| **Vertex** | A corner of the new straight-line shape. |
| **Polygon** | A shape made only of straight lines. |
| **Crease** | A straight line along which an Experimental effect folds the outline; the only place it adds a corner. |
| **Fold** | What an Experimental effect does beyond 100 %: parts of a letter land on top of other parts. Overlaps are merged into one straight-edged shape. |
| **Decibel (dB)** | A unit of loudness. In the Sound tab, 0 dB is the loudest a recording can be and lower (negative) numbers are quieter. |
| **Onset** | The moment a new sound starts, such as a drum hit; the **Beat** bar jumps to full on it. |
| **Mapping** | In the Sound tab, a connection from one sound reading (such as **Level**) to one slider or seed, whose value then follows the sound (the slider or seed box itself stays put; a thin line on the slider, or a small number beside the seed box, shows the live value). |
| **Depth** | How far a mapping moves its slider when the reading is at its strongest, as a share of the slider's track. |
| **Rate** | How often a mapping moves its seed on to the next one, from 0 to 100 %. |
| **fps (frames per second)** | How many new shapes a second the app can keep up with while the sound moves the letters. |
| **Em / Units per em** | The invisible design square of a font and its size in font units (often 1000 or 2048). |
| **Font unit (u)** | The measuring unit inside a font. All sizes in the controls use it. |
| **Baseline** | The line letters sit on. |
| **x-height / cap height** | The height of lowercase "x" / of capital letters. |
| **Ascender / descender** | Parts that rise above the x-height (h, d) or drop below the baseline (p, g). |
| **Advance width** | How far the text moves forward after a letter, including its side spacing. |
| **Kerning** | Small spacing adjustments between specific pairs, like "AV". |
| **Variable font** | A font file that contains a range of weights or widths. |
| **SVG** | A vector image format that keeps shapes sharp at any size. |
| **OTF (OpenType)** | A standard font file format you can install on a computer. |
