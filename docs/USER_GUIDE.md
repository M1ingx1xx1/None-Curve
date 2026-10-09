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

1. **Tools (top left)** — the **Import font** button, information about the loaded font, and the **Geometry** controls that shape the letters. Scroll to see every control.
2. **Result canvas (top right)** — the big preview. It shows the canvas (a page of fixed size) with the text you typed, rebuilt with your current settings. The page that gets exported sits in the middle with a soft shadow, as if it lay slightly above the background. Around it, the background is a little darker and has a light grid, so the page itself stays clean and looks exactly like the export. The grid also appears on the page while you drag the text or when you zoom in to 200 % or more, to help you line things up. The **Canvas size** bar at its bottom opens the size settings.
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
- The numbers in the shaping controls (vertices, curves, and so on) describe the selected letter — or, after you removed the highlight, the letter you selected last. The **Statistics** line at the top of the Geometry panel always says which letter that is, for example "Statistics: l U+006C".
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

These are in the **Geometry** panel (top left). The controls are applied in a fixed order, top to bottom, so later steps work on the result of earlier ones:

**Curve flattening → Squaring → Anchors → Grid & angles → Distortion**

All sizes are in **font units**. A font is designed on an invisible square called the **em**, usually 1000 or 2048 units wide (shown as "Units/em" in the font information). So "20 u" in a 1000-unit font is 2 % of the letter height. The settings do not change when you zoom.

Controls whose name does not say it all have a short explanation. To keep the panel tidy, explanations are folded away: click the small **ⓘ** next to a control's name to read it, and click again to fold it. To see all of them at once — handy the first time — tick **Show all explanations** at the top of the Geometry panel (it opens the explanations in the Typography and Color tabs too). Yellow warnings and numbers are always shown. If a setting would break a shape (for example, make a letter cross over itself), the app first tries a gentler version for that part of the letter — a little less squaring, a slightly simpler outline, stair steps for angle lock, or less distortion — and a grey note says so. Only if nothing works does that part keep its previous shape, with a yellow note explaining why.

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

### Random anchors (experimental) — a different look every time, but repeatable

At the very bottom of the tools panel. Normally the app places points on the curves at regular spacing (Curve flattening). With **Use random anchors** on, it places them at random spots on the letter's original outline instead — the points always sit on the real letter, only *where* they sit is random. The later controls (Squaring, Anchors, Grid & angles, Distortion) still apply on top.

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

### Typography tab — size, spacing, and alignment

The **Typography**, **Glyphs**, and **Color** tabs are at the bottom left. These place the text on the canvas. They do not change the shape of the letters or the exported font file.

- **Size** — the letter size, as a percentage of the canvas width (the explanation shows the size in pixels). Because it follows the width, the text keeps its proportions when you change the canvas size. You can drag the slider or type a number.
- **Fit text** — makes the text as large as possible while still fitting inside the padding.
- **Padding** — the gap kept between the text and the canvas edges, counted in capital-letter heights: 1 means the gap is as tall as a capital letter. Because it is tied to the letters, it grows when you make the text bigger. Set it to 0 to let the letters touch the edges.
- **Tracking** — extra space between letters. Negative values pull letters closer.
- **Line height** — space between lines. 1 is the font's own line spacing; 2 is double.
- **Slant** — leans the letters, like a quick italic. Positive leans right, negative leans left.
- **Align** — the three buttons with lines line up the lines of text on the left, in the centre, or on the right.
- **Position** — where the text sits on the canvas. Click one of the nine dots: a corner, the middle of an edge, or the very middle. The text moves there, keeping the **Padding** gap (one capital-letter height) to the edges, and its lines line up to match: dots on the left line up left, in the middle centred, on the right line up right. The chosen dot glows. Click **Free** to place the text yourself: it first goes back to the starting position, then you drag it on the big canvas (click Free again any time to send it back). It stops at the canvas edges, so it can never be dragged off the page. Dragging anywhere else on the canvas still moves the view.
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

**Back to the original**
Set Curve flattening to **Adaptive** with a small **Tolerance**, and turn off Squaring, Anchors, Grid & angles, and Distortion (each has a reset button). Or simply choose **Original** in the canvas toolbar to look at the untouched font.

---

## 10. Saving your work (Export)

Click **Export…** in the top-right corner. Nothing is downloaded until you press a download button.

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
- A few unusual letters may be left out if their shape cannot be stored safely; the app lists them.
- Variable fonts are saved in the version you see on screen.
- **Licensing:** a modified font is still based on someone else's design. Check the original font's license before sharing it — many open-source fonts require a new name for modified versions.

---

## 11. Questions and answers

**My letters still look smooth even with few segments.**
Turn on **Merge joined curves** (Fixed segments mode). Without it, each small piece of a curve gets its own segments.

**Changing Corner angle does nothing.**
Turn on **Merge through straight lines** (under Merge joined curves). Without it, Corner angle only affects joints between two curves, which are almost always smooth already.

**I liked a random-anchor result. How do I get it back?**
Write down (or **Copy**) its seed. Later, load the same font, set the same Random anchors settings, and type the seed into the **Seed** box. Within one visit you can also click it under **Previous**.

**Why don't I see the skeleton points or green vertices?**
They only appear when letters are big enough. Zoom in on the canvas.

**Some controls are grey and do not move.**
They would have no effect right now. The note above them says why — for example, Curve flattening is greyed out while Random anchors are on, and the random Seed is greyed out at 0 % Randomness.

**Clicking a character in Glyphs put it in the wrong place.**
It goes where the text cursor last was. Click in the text box where you want it, then click the character.

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
