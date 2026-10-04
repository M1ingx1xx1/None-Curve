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

Everything happens inside your web browser. Your font files are never uploaded anywhere.

---

## 2. What you need

- A recent web browser (Chrome, Edge, Firefox, or Safari) on a computer. A phone works, but a larger screen is much more comfortable.
- Either a font file on your computer (`.ttf`, `.otf`, `.woff`, or `.woff2`) **or** an internet connection to load a font from Google Fonts.
- The app's web address — for example `https://m1ingx1xx1.github.io/None-Curve/` — or ask whoever set up the project for it.

---

## 3. A tour of the screen

The screen is split into four areas, like a window with four panes:

```text
┌────────────────────────┬──────────────────────────────────────┐
│ ① Tools                │ ② Result canvas                      │
│   Import font          │   your text, rebuilt live            │
│   Font information     │                                      │
│   Shaping controls     │                                      │
├────────────────────────┼──────────────────────┬───────────────┤
│ ③ Glyphs               │ ④ Text input         │ ⑤ Glyph       │
│   every letter in      │   type here          │   preview     │
│   the font             │                      │               │
└────────────────────────┴──────────────────────┴───────────────┘
```

1. **Tools (top left)** — the **Import font** button, information about the loaded font, and all the shaping controls. Scroll this area to see every control.
2. **Result canvas (top right)** — the big preview. It always shows the text you typed, rebuilt with your current settings.
3. **Glyphs (bottom left)** — every letter, number, and symbol in the font. Click one to look at it closely.
4. **Text input (bottom right, left half)** — type the text you want to see on the canvas.
5. **Glyph preview (bottom right, right half)** — a close-up of the one letter you selected.

At the very top there is an **Export…** button, and along the bottom a status line tells you what is shown and which settings are active.

> On a phone the areas are stacked: tools, canvas, text input, glyph preview, then the glyph list. The shaping controls are folded away — tap **Parameters** in the canvas toolbar to open them.

---

## 4. Quick start (five minutes)

1. Click **Import font** (top left) → **Google Fonts** → choose **Inter** → **Load font**.
2. In the text input, type a word, for example `Hello`.
3. In the tools area, find **Curve flattening**, choose **Fixed segments**, and set **Segments per curve** to `2`.
4. Turn on **Merge joined curves**. The letters become clearly faceted.
5. Click **Export…** at the top → **SVG — specimen text** → **Download SVG**.

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

- **Pick from the list** — 25 popular fonts are listed.
- **Type a name** — any Google font, spelled exactly as on fonts.google.com (capital letters matter: `Open Sans`, not `open sans`). Then click **Use "…"**.
- **Paste a link** — copy the address of a font page from fonts.google.com, for example `https://fonts.google.com/specimen/Plaster`, and paste it. Links that already say a weight or italic (for example `…css2?family=Roboto:ital,wght@1,700`) are understood too.

After choosing a font, set:

- **Weight** — how bold it is (400 is regular, 700 is bold). Some fonts are "variable": they appear with one default weight, and the weight menu is turned off.
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
- **Sample…** offers ready-made texts: a pangram, round letters (good for testing squaring), and spacing pairs.
- **Clear** empties the box.
- Below the box you see how many characters you typed and whether the font's own **kerning** (fine spacing between pairs like "AV") is applied.
- If a character is not in the font, it appears on the canvas as a **dashed red box** and is listed under the text box. The rest of the line still shows.
- Up to 1000 characters are shown.

---

## 7. Looking at the result

### The canvas toolbar

**Outline view** — what shape is drawn:

- **Original** — the font exactly as designed, with its curves. Use it to compare.
- **Flattened** — the result of all your settings (the default).
- **Compare** — the result in grey with the original curves drawn on top as a blue dashed line.

**Layers** — extra information you can switch on and off:

- **Fill** — solid letters. Turn it off to see only the outlines.
- **Skeleton** — the points that define the original curves: blue squares sit on the curve, hollow orange circles are the "control points" that pull the curve, and thin lines connect them.
- **Vertices** — green dots at every corner of the new straight-line shape.
- **Metrics** — horizontal guide lines: ascender (top of tall letters like "h"), cap height (top of capitals), x-height (top of "x"), baseline (where letters sit), and descender (bottom of "p" and "g").

> Skeleton points and vertices appear only when letters are large enough to read them. If the canvas says "Zoom in to see skeleton points and vertices", zoom in.

**Zoom** — `−` and `+` zoom out and in, **Fit** shows all the text again. You can also scroll the mouse wheel over the canvas to zoom, and drag to move around.

### Looking at one letter

- Click a letter in the **Glyphs** list (bottom left), or click a letter on the canvas.
- It appears in the **glyph preview** (bottom right). The preview uses the same view and layers as the canvas, but has its own zoom — scroll or drag inside it, and click **Fit** to reset.
- The search box above the glyph list accepts a character (`A`), a code (`U+0041`), a glyph number (`#12`), or part of a glyph name. **Characters** shows letters you can type; **All glyphs** also shows extra shapes the font contains.
- The numbers in the shaping controls (vertices, curves, and so on) describe the selected letter.

---

## 8. The shaping controls

The controls are applied in a fixed order, top to bottom, so later steps work on the result of earlier ones:

**Curve flattening → Squaring → Anchors → Grid & angles → Distortion**

All sizes are in **font units**. A font is designed on an invisible square called the **em**, usually 1000 or 2048 units wide (shown as "Units/em" in the font information). So "20 u" in a 1000-unit font is 2 % of the letter height. The settings do not change when you zoom.

Every control has a short explanation under it. If a setting would break a shape (for example, make a letter cross over itself), that part of the letter keeps its previous shape and a yellow note tells you why.

### Curve flattening — how curves become straight lines

Choose one **Mode**:

- **Adaptive** — keeps the shape close to the original. **Tolerance** is how far the straight lines may stray from the curve. Small values (0.1–2) look almost identical to the original; large values (20–100) look visibly angular.
- **Fixed segments** — every curve is replaced by the same number of straight lines. **Segments per curve** sets that number (1–32). Fewer lines give a cruder, more faceted look.

**Merge joined curves** (only with Fixed segments) — the key to a strong faceted look. A curve you see as one arc is usually stored in the font as several small curves. Without merging, "2 segments per curve" applies to each small piece, so letters still look smooth. With merging, the whole visible arc counts as one curve. Try **Segments per curve** 4, then 3, then 2 to go from subtle to bold.

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
- When both are on, snapping happens first, so angle lock may move some points slightly off the grid.
- **Reset grid & angles** turns both off.

### Distortion — a rough, hand-made or carved edge

Moves the points of the outline in a controlled, repeatable way.

- **Noise amplitude** — how far points may move. 0 is off. Small values (5–20) give a subtle hand-cut feel; large values look worn or eroded.
- **Noise frequency** — how often the edge wobbles. Low = slow, gentle waves; high = quick, jittery roughness.
- **Normal bias** — the direction of movement. 0 % slides points along the edge; 100 % pushes the edge in and out.
- **Seed** — a number that picks one particular random pattern. The same seed always gives exactly the same result, so you can come back to a version you liked. **Next variant** tries the next pattern.
- **Reset distortion** turns it off.

Distortion can make text harder to read — use it with care.

---

## 9. Recipes

**Bold, faceted letters (like "4 / 3 / 2 lines per curve")**
Curve flattening → **Fixed segments**, **Merge joined curves** on, **Break merged curves at** = Corners & extremes, **Segments per curve** = 4 (subtle), 3, or 2 (bold).

**Extreme low-resolution letters**
As above, then turn on **Merge through straight lines** and raise **Corner angle** to 45°–90°. Try **Break merged curves at** = Corners only for the most reduced shapes.

**Square O and round letters**
Squaring → **Square**, Applies to **Round contours**, then Anchors → **Anchor reduction** = 2. Type "OO oo 00" (Sample… → Round letters) to check.

**Pixel / grid look**
Grid & angles → **Snap to grid** on, **Grid size** around 5 % of the font's Units/em (for example 50 in a 1000-unit font). Add **Angle lock** at **90°** for only horizontal and vertical edges.

**Carved or worn stone**
Fixed segments 3 with merging, then Distortion → **Noise amplitude** 10–30, **Noise frequency** 8–15, **Normal bias** 70 %. Try **Next variant** until you like the pattern.

**Back to the original**
Set Curve flattening to **Adaptive** with a small **Tolerance**, and turn off Squaring, Anchors, Grid & angles, and Distortion (each has a reset button). Or simply choose **Original** in the canvas toolbar to look at the untouched font.

---

## 10. Saving your work (Export)

Click **Export…** at the top (or at the bottom of the tools area). Nothing is downloaded until you press a download button.

### As an image (SVG)

1. Choose **SVG — current glyph** (the letter in the glyph preview) or **SVG — specimen text** (everything you typed).
2. **Coordinate precision** — how many decimals the numbers in the file keep. 2 is a good default. If the app says a shape would break at this precision, choose a higher one.
3. Click **Download SVG**.

SVG files open in Illustrator, Figma, Inkscape, and web browsers. The shapes contain only straight lines.

### As a font (OTF)

1. Choose **Font file — OpenType (.otf)**.
2. **Glyphs to include:** **Current glyph**, **Specimen characters** (only the characters in your text), or **All mapped characters** (every letter the font has).
3. Give it a **Family name** and **Style name** — use plain English letters. A new name avoids confusion with the original font.
4. Click **Build & verify**. The app builds the font and then checks it thoroughly. This can take a few seconds for large fonts; **Cancel** stops it.
5. When it says "Verified", click **Download .otf** and install the font like any other.

Good to know:

- If you change any setting after building, build again before downloading.
- The new font has **no kerning**, ligatures, or other advanced features of the original — only the reshaped letters and their widths.
- A few unusual letters may be left out if their shape cannot be stored safely; the app lists them.
- Variable fonts are saved in the version you see on screen.
- **Licensing:** a modified font is still based on someone else's design. Check the original font's license before sharing it — many open-source fonts require a new name for modified versions.

---

## 11. Questions and answers

**My letters still look smooth even with few segments.**
Turn on **Merge joined curves** (Fixed segments mode). Without it, each small piece of a curve gets its own segments.

**Changing Corner angle does nothing.**
Turn on **Merge through straight lines** (Fixed segments → Merge joined curves). Without it, Corner angle only affects joints between two curves, which are almost always smooth already.

**Why don't I see the skeleton points or green vertices?**
They only appear when letters are big enough. Zoom in, or look at the glyph preview.

**A yellow note says some contours "kept their previous shape".**
That setting would have made part of a letter collapse or cross over itself, so the app kept the last good version for that part. Try a gentler value.

**A letter shows as a dashed red box.**
The font does not contain that character, or (for Google Fonts) it is in another character subset. Load a different subset or font.

**The weight menu is grey for some Google fonts.**
That font is "variable"; it loads in its default weight.

**Will my results change if I reload the page?**
Settings are not saved between visits. Within a session, the same settings and seed always give the same result. Export what you want to keep.

**Does anything get uploaded?**
No. Local fonts stay on your computer. Google fonts are downloaded from Google; nothing is sent anywhere else.

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
