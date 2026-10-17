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
- Record the moving letters as a **video** (MP4 or WebM), with the sound in it.

Everything happens inside your web browser. Your font and audio files are never uploaded anywhere.

---

## 2. What you need

- A computer with a recent web browser (Chrome, Edge, Firefox, or Safari). Phones and tablets are not supported: the tool is built for a large screen.
- Either a font file on your computer (`.ttf`, `.otf`, `.woff`, `.woff2`, or a `.ttc` / `.otc` font collection) **or** an internet connection to load a font from Google Fonts.
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
5. **Preview** — a small picture of exactly what an SVG export would save: all your text, filled, on the canvas, with its own **Blur** slider and **Invert** button.

At the very top there are two arrow buttons, **Undo** and **Redo** (see [Undo and redo](#undo-and-redo) below), and an **Export…** button. While a video is being recorded, a red light, the time recorded (for example "Recording 0:12"), and a square stop button appear beside them (see [Record a video](#record-a-video)). Along the bottom a status line tells you what is shown and which settings are active.

**Light or dark screen.** At the far right of the status line, two small buttons — a sun and a moon — switch the app between a light and a dark look. The app always opens in the same look as your computer (its light or dark mode); your choice lasts until you close the page and is not remembered. The canvas is not affected: its colours come from the **Color** tab.

**Starting over in one click.** Just left of the sun and moon, a button with a turning arrow (pointing at it says **Reset all settings**) puts every setting back to how the app first opens: the Geometry, Experimental, Typography, and Color tabs, the canvas size, and in the Sound tab the mappings (all removed) and the six **Response** sliders. Your font, the selected letter, and your text stay as they are, and so do the canvas view, the preview's Blur and Invert, and the export settings. It does not ask first, because one **Undo** brings everything back. The button is greyed out while every setting is already at its starting value.

**Changing the size of the areas.** The double lines in the picture are the thin grey lines between the areas; you can drag them:

- between the **top and bottom rows** — drag up or down to give the canvas or the bottom row more height;
- between the **tools and the canvas** — drag left or right;
- between the **Typography / Glyphs / Color tabs and the text input** — drag left or right;
- between the **text input and the preview** — drag left or right.

Whatever one side gains, the other side loses, so everything always fits in the window exactly — the page never needs scrolling. Each area keeps a minimum size. Double-click a line to put it back where it started. The app remembers your choices the next time you open it.

### Undo and redo

**Undo** takes back your last change and **Redo** puts it back again. Use the two arrow buttons at the top right, or the keyboard: on a Mac, ⌘Z undoes and ⇧⌘Z redoes; on Windows and Linux, Ctrl+Z undoes and Ctrl+Shift+Z or Ctrl+Y redoes. Pointing at a button shows its shortcut. The app keeps up to 100 steps.

- **What can be undone:** every setting in the Geometry, Experimental, Typography, and Color tabs, the canvas size, the text, and in the Sound tab the mappings and the six **Response** sliders (Sensitivity, Strength, Motion contrast, Release, Pitch reactive, and Melody tracking). The reset buttons count too, so Undo brings back what a reset (including **Reset sound** and **Reset all settings**) cleared.
- **How big one step is:** one drag of a slider is one step, however far you move it. Typing is one step until you pause for a moment. **Clear**, picking a sample text, and inserting a character from **Glyphs** are a step each. Some actions that change several things at once are a single step as well: loading a Sound preset, **Freeze**, loading a config file, and picking a mapping target together with the settings it switched on.
- **What is not undone:** the canvas view (Original / Flattened / Compare, the layer buttons, zoom, and moving around), which letter is selected, the preview's Blur and Invert, the export settings, loading a font, the Sound tab's **Drive letters** and source, and the video options (**Format**, **Length**, **Include audio**, and **Use the preview look**). Sound moving the letters is never recorded either: only your own changes are.
- **Inside a typing box** — the text box, or a box you type a number, colour code, or name into — the shortcuts undo your typing in that box only, as in any text field. The buttons at the top still undo whole steps. While a dialog (such as **Export…**) is open, the shortcuts do nothing.
- The steps are forgotten when you close the page: the next visit starts with nothing to undo.

### Coming back later

The app keeps your work in this browser by itself, a moment after each change, and brings it back the next time you open it on the same computer in the same browser.

- **Kept:** the text; every setting in the Geometry, Experimental, Typography, and Color tabs; the canvas size; the canvas view buttons (Original / Flattened / Compare and the layers, but not the zoom or where you moved to); the preview's Blur and Invert; the export's **Coordinate precision**; the Sound tab's mappings and its six **Response** sliders (Sensitivity, Strength, Motion contrast, Release, Pitch reactive, and Melody tracking); the selected letter (when the same font opens again); and the font itself.
- **The font:** a Google font is downloaded again by itself when the page opens (this needs an internet connection). A font from your computer cannot be reopened for you: the canvas says "Last font: *name*. Import it again to continue." Import the same file and carry on — your settings are already in place.
- **Not kept:** the Sound tab's **Drive letters** and source (file or microphone); the video options (**Format**, **Length**, **Include audio**, and **Use the preview look**), which last until you close the page; open dialogs; the light or dark look; and the undo steps. (As before, the app also remembers the size of the areas, the tabs you had open, whether the **Canvas size** settings are open, and **Show all explanations**.)
- **Work saved by an older version of the app:** Thorn's **Reach** used to be a share of the em (the letters' design square) and is now a share of the canvas (see Thorn in the Experimental tab). Older saved work is converted to the share that gives the thorns the same length with the text size and canvas size it was saved with, so they come back as they were. Thorns that were on stay on: however short they were, they come back at least as long as the slider's first step. Sound rows on Reach keep their **Depth**. Thorns may also grow from other points than they did before with the same **Seed**, because the app now picks them in a steadier way (see Thorn in the Experimental tab); press **Next variant** until you like them again. Crumple no longer has a **Detail** slider: a saved Detail value is ignored, Sound rows on **Crumple · Detail** are dropped, and Crumple folds the letters as Noise did before it was renamed, so the same **Seed** gives different folds than in the version that had Detail.
- **If the page closed while drawing your settings** — for example because a very heavy setting made the browser give up — the next visit opens with every setting back at its starting value, so it cannot get stuck again, and the canvas says "The last visit closed while drawing, so its settings were not restored." Your text, font, mappings, and **Response** sliders still come back.
- **Starting over:** most groups have a reset button (**Reset anchors**, **Reset grid & angles**, **Reset distortion**, **Reset random anchors**, **Reset experimental**, **Reset typography**), and **Charcoal** in the Color tab is the starting colour pair. The arrow button at the right end of the status line (**Reset all settings**) resets every tab at once and keeps your font and text (see *Starting over in one click* in [A tour of the screen](#3-a-tour-of-the-screen)). To start completely fresh, clear this site's data (cookies and site data) in your browser's settings and reload the page; this also forgets the area sizes and open tabs.
- **Good to know:** each browser keeps its own copy. If the app is open in two tabs, the one you changed last wins. Safari may clear the saved work of a site you have not opened for 7 days. To keep a result for sure, export it; to keep the settings themselves, or take them to another browser, save a [config file](#as-a-config-file-settings-only).

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

Click **Import font** at the top of the tools area. You get three choices: a font from your computer, a font from Google Fonts, or a **Config file** with saved settings (see [As a config file](#as-a-config-file-settings-only)).

### From your computer

- Choose **Local file** and pick a font file, **or** simply drag a font file onto the big canvas.
- Supported: `.ttf`, `.otf`, `.woff`, `.woff2`, and font "collections" (`.ttc`, `.otc`), up to 50 MB.
- **Font collections** hold several styles in one file — on a Mac, for example, Helvetica Neue, Avenir Next, and Futura. The app opens the style closest to Regular, and the style name in the font information becomes a menu of all the styles in the file: pick another one there. Switching styles this way keeps your text, the selected letter (if the new style has it), and the zoom. A few hidden styles that macOS keeps for itself (their names start with a dot) are not listed. Collections packed as `.woff` or `.woff2` cannot be opened.
- Loading any other font starts the canvas view afresh: it zooms to fit and selects a default letter.
- The file stays on your computer; it is only read by your browser. The next time you open the app, it names the file and asks you to import it again (see [Coming back later](#coming-back-later)).

### From Google Fonts

Choose **Google Fonts**. In the **Family** box you can:

- **Pick from the list** — 15 fonts are listed, grouped as Sans, Serif, Slab, and Mono (for example Google Sans, Inter, EB Garamond, Bodoni Moda, Arvo, JetBrains Mono).
- **Type a name** — any Google font, spelled exactly as on fonts.google.com (capital letters matter: `Open Sans`, not `open sans`). Then click **Use "…"**.
- **Paste a link** — copy the address of a font page from fonts.google.com, for example `https://fonts.google.com/specimen/Plaster`, and paste it. Links that already say a weight or italic (for example `…css2?family=Roboto:ital,wght@1,700`) are understood too.

After choosing a font, set:

- **Weight** — how bold it is (400 is regular, 700 is bold). This works for every font, including "variable" fonts that keep all their weights in one file.
- **Italic** — if the font has an italic version.
- **Character subset** — Google splits fonts by language (for example `latin`, `latin-ext`, `cyrillic`). Only one subset is loaded at a time, so letters from other languages may be missing.

Click **Load font**. Once it has downloaded, the font name appears in the tools area. The next time you open the app, the same font is downloaded again by itself.

### If something goes wrong

The tools area shows what happened and offers **Retry**:

| Message | What it means | What to do |
|---|---|---|
| Empty file / Unsupported format | The file is not a font, or is empty. | Use a `.ttf`, `.otf`, `.woff`, `.woff2`, `.ttc`, or `.otc` file. |
| Font parsing failed | The file is damaged. | Try another copy of the font. |
| Google Fonts API error | Google does not know that name. | Check the spelling and capital letters. |
| Network / CORS error | No internet, or a browser extension blocked the request. | Check your connection or ad blocker, then **Retry**. |
| Only fonts.google.com … URLs are accepted | The pasted link is not a Google Fonts link. | Paste a link from fonts.google.com. |

If a new font fails to load, the previous font stays on screen.

---

## 6. Typing text

- Type in the **Text** box (bottom right). Press Enter for a new line.
- The sample menu next to **Clear** offers ready-made texts: **Lorem ipsum** (placeholder text), **Pangrams** (sentences that use every letter), **Spacing** (classic test words such as "Hamburgefontsiv"), and **Alphabet** (all capitals, lowercase letters, digits, and common punctuation, one group per line). The first time you open the app it shows Lorem ipsum; after that, it opens with the text you had last time. Once you change the text, the menu shows the last sample with "(edited)"; pick it again to get the original back.
- **Clear** empties the box. Changed your mind? **Undo** brings the text back.
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
- Thorns (see Thorn in the Experimental tab) are not part of a letter's space: clicking a thorn where it reaches out of its letter is the same as clicking whatever lies behind it, such as another letter or, most often, the empty canvas. Click the letter itself. While Thorn is on, a letter is clicked by its own space and its original shape from the font, so other parts that effects drew far out of it, such as Slipstream's trails, do not select it either.
- Click an empty part of the canvas, or press Escape, to remove the highlight. Dragging the canvas around does not remove it.
- The numbers in the shaping controls (vertices, curves, and so on) describe the selected letter — or, after you removed the highlight, the letter you selected last. The **Statistics** line at the top of each tab always says which letter that is, for example "Statistics: l U+006C".
- The preview never shows the highlight, because it shows exactly what will be exported.
- To look closely, zoom in on the canvas.

### The preview: Blur, Invert, and width

The **Preview** (bottom right) shows the whole canvas exactly as an SVG export would save it — anything outside the canvas is cut off.

- It always shows the finished, filled letters and nothing else. It does not follow the big canvas's Original / Flattened / Compare and layer buttons, its zoom, the snap grid, or the dashed boxes for missing characters: those only help you on the big canvas and are never exported.
- Its outlines are rounded the same way as the SVG file (see **Coordinate precision** in [Saving your work](#10-saving-your-work-export)), so what you see here is what you get.
- With **Transparent background** (Color tab) on, the empty background shows as a checkerboard.
- If saving the text as an SVG would fail, the preview says "Export would fail: …" with the reason instead.
- While the Sound tab moves the letters, the preview moves with them. SVG, PNG, and font exports still use your sliders (see **Freeze**); a video records the moving letters (see [Record a video](#record-a-video)).

- **Blur** softens the preview, as if you looked at the text from far away or squinted. This shows the overall shape and rhythm of the letters without the details — a quick way to check whether a rough or faceted style still reads well.
- **Invert** swaps the text and background colours in the preview — dark letters on light become light on dark, and back. Useful to check how the text works both ways, for example for a sign or a dark poster.
- Blur and Invert only change this small view. To save them in a file, tick **Export the preview look** when exporting.
- **Making the preview wider:** drag the thin line on its left (see "Changing the size of the areas" in section 3).

### Canvas size

The text sits on a **canvas** of a fixed size in pixels, like a page or an artboard. Click the **Canvas size** bar under the big canvas to open or close its settings:

- **W** and **H** — the width and height in pixels. Drag the slider or type a number (it takes effect when you press Enter or click elsewhere).
- **1:1, 4:3, 16:9, 4:5, 3:2, 3:4** — common picture shapes. The width stays and the height follows. **Swap** turns a landscape canvas into a portrait one and back.
- **1×, 2×, 3×, 4×** — how many times larger a PNG export is. The layout stays the same; a higher number just gives a sharper, larger image (shown underneath, for example 2400 × 1600 px). A video uses the same size, unless that is larger than 4K (see [Record a video](#record-a-video)).

If the text is too big for the canvas, a red note appears on the big canvas ("The text runs past the canvas edge and will be cut off in the preview and in exports. Try Typography → Fit text."); the preview and exports cut the text off at the edge. **Typography → Fit text** makes it fit.

Thorns (see Thorn in the Experimental tab) do not count: they may reach far past the canvas edge without the red note. On the big canvas you see them carry on into the darker area around the canvas; the preview and SVG and PNG exports cut them off at the canvas edge.

While the Sound tab moves the letters, the text stays where your sliders put it, and the red note goes by the letters as your sliders make them. If the sound bends a letter further than your sliders do, that letter can reach past the canvas edge without the red note: the big canvas shows it in full, but the preview and a video cut it off at the edge.

---

## 8. The shaping controls

These are in the tools panel (top left), in two tabs. (The third tab, **Sound**, does not shape the letters itself: it moves the letters with the sound, as if it were moving the sliders and seeds of these two tabs (they themselves stay where you put them; a thin line on each slider, or a small number beside each seed, shows where the sound has taken it); see [Sound tab](#sound-tab--letters-that-move-with-the-sound) below.) The **Geometry** tab is applied in a fixed order, top to bottom, so later steps work on the result of earlier ones; the **Experimental** tab comes after all of it:

**Curve flattening → Squaring → Anchors → Grid & angles → Distortion → Experimental**

All sizes are in **font units**. A font is designed on an invisible square called the **em**, usually 1000 or 2048 units wide (shown as "Units/em" in the font information). So "20 u" in a 1000-unit font is 2 % of the letter height. The settings do not change when you zoom.

Every slider has a small number box next to its name that shows its value (in %, °, u, and so on). Drag the slider to try things out quickly; to set an exact value, click the box, type the number, and press Enter (or click somewhere else). A number beyond the slider's range is set to its nearest end, and Escape puts the old value back. The sliders move in small steps — 1 % for most of them, 1° for angles — and once you click a slider, each press of an arrow key moves it one step.

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
  - **Previous** lists the seeds you tried before during this visit (the list is not kept when you close the page); click one to go back to it.
  - To get a result again later, load the same font, use the same settings, and type the seed into the box.
  - At **Randomness** 0 % the points are evenly spaced, so the seed does nothing and is greyed out.
- **Reset random anchors** turns it off and restores the other settings, but keeps your seed.

The seed is also shown in the status line at the bottom and in the export dialog, so it is recorded with what you export.

### Experimental tab — effects you can stack

Next to the **Geometry** tab at the top of the tools panel. The effects here work on the finished result of the Geometry tab, and you can turn on as many as you like at once. **Crumple**, **Ripple**, **Whorl**, and **Slipstream** bend the letters along **straight creases**: they add corners but never curves. Up to 100 %, no combination of them can make a letter cross itself or push the hole of an **A**, **B**, or **e** out of the letter. A few parts are drawn onto the letters instead, also with straight lines only: **Slipstream**'s cuts and trails, and **Thorn**'s thorns, which may cross the letter (see below). The effects always run in the same order: **Crumple**, then **Ripple**, then **Whorl**, then **Slipstream**, then **Thorn**. (Earlier versions called them Noise, Ripple, Curl, Wind, and Spikes.)

**Beyond 100 % — folds.** Crumple, Ripple, Whorl, and Slipstream's Gustiness go past 100 % (Whorl in both directions). There the letters fold over themselves like paper crushed flat: strokes land on other strokes, holes fill in or open up, and the letters stop being readable. Wherever parts overlap they are merged into one clean shape, still made only of straight lines, so the font still exports. While an effect is past 100 %, **Thorn** is on, or **Slipstream** cuts the letters, the top of the tab shows how many places were merged (**Crossings merged**) and how many specks too small to show were dropped (**Slivers dropped**).

**When the settings get very heavy.** Every fold, crease, cut, and thorn adds corners to a letter, and several dense effects together could add hundreds of thousands — far too many to draw quickly or to save. So each letter has a limit: the effects may add about 6,000 corners to it. One effect on its own and the Sound presets stay within it. When a combination goes over, the letter is simplified: its smallest details are left out, step by step, until it fits. You get the same simplified letter on the canvas, in the preview, and in every export, and you may see these yellow notes (the first three at the top of the tab, the last one in the effect's own group):

- "Simplified: these settings make too many vertices or crossings, so the outline was reduced (tolerance N u)." — details smaller than about N font units were left out. When this is the selected letter, the status line also adds **(simplified)** after its vertex count.
- "Too complex to merge; lower the settings." — even simplified, the overlapping parts were too many to merge, so the letter is shown simplified but unmerged. It still looks filled, but lighter settings give a cleaner result.
- "Overlaps could not be merged; the outline is left as it is." — rare: merging went wrong for this letter, or its thorns reached too far to be merged, so its overlapping parts were left unmerged rather than broken.
- "This glyph is left without *effect*: too complex." (for Thorn: "…without roots or refraction…") — that one effect would have made far too many corners in this letter, so the letter is shown without it.

At the far ends of several sliders together, the letters turn into a few coarse, broad slabs. That is expected: there is no room left for detail. Lower one or two of the effects to bring the detail back.

**Crumple — crumpled paper**

- **Use crumple** — turns it on.
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

**Whorl — swirls**

- **Use whorl** — turns it on.
- **Amount** — how far the letters swirl around their middle, from −400 % to 400 %. Below 0 % the swirl turns clockwise instead. Around 60 % the letters get a clear twist; at 100 % the swirl turns as far as it can while every letter keeps its shape. How far that is depends on **Sides** and **Rings**: about a twelfth of a turn with 3 sides, more than a full turn with 12 sides and many rings. Beyond 100 % either way, the rings turn past each other and the letters fold onto themselves.
- **Pin top and bottom** — on (the default): the top and bottom of each letter stay where they are and the middle twists. Off: the middle stays where it is and the outside turns instead, so the top and bottom swing round too and the whole letter spins.
- **Rings** — how many rings the swirl is made of, from the middle of the letter out to its top and bottom (2–12). Fewer rings give bigger, chunkier facets; more rings give a finer swirl of many small straight pieces.
- **Sides** — the shape of the rings: 3 gives triangles, 4 squares, 8 octagons, up to 12. More sides let the swirl turn further before the letters fold.

**Slipstream — letters caught in a stream**

The letters are caught in a fast stream: thin slices of each letter slide past each other, the stream pulls the letters out, thin cuts run into them, and wispy trails stream off behind them.

- **Use slipstream** — turns it on.
- **Direction** — where the stream flows to: 0° to the right, 90° up, 180° to the left, 270° down.
- **Strength** — how much longer the letters get (15 % to start with). The side facing the stream stays where it is; the further downstream a part of the letter lies, the further it is pulled. At 100 % a part is pulled as far again as it lies from the side facing the stream, at 800 % eight times as far (but never more than 4 em), so letters reach far into their neighbours.
- **Slip** — how far the slices slide past each other, as a share of the em (15 % to start with, up to 60 %). The letter is cut across the stream into slices that slide along it, like a deck of cards pushed sideways: a few big steps, with smaller ones in between. Sliding never folds a letter, however far it goes.
- **Gust size** — the width of the slices, and of the bands the gusts pull, as a share of the em. With a level stream (0° or 180°) every letter on a line shares the same bands, so the steps and streaks run straight through the text.
- **Gustiness** — how different the bands are when the letters are pulled out. At 0 % every band is pulled equally and the letters are simply stretched; at 100 % some bands barely move while others are dragged far, leaving ragged, straight-edged streaks; above 100 % (up to 200 %) some gusts blow backwards, tearing the letters apart.
- **Cuts** — how many thin, wedge-shaped slits are cut into each letter along the stream (2 to start with, up to 8). Each one is widest where it enters and narrows to a sharp point inside a stroke; about one in four goes right through the letter.
- **Trails** — how many thin streaks trail off each letter downstream (2 to start with, up to 8). They grow out of the letter's outer edge on the side away from the stream, and a higher **Strength** makes them longer. A trail never runs into the letter or into another trail, so where there is no room a letter gets fewer.
- The numbers show how far the outline moved at most and how many corners were added, and, while there are cuts or trails, how many the selected letter got (**Cuts**, **Trails**).

**Thorn — thorns that shoot out**

A few points (anchors) on the outside of each letter jump straight out into the canvas as long, straight thorns and pull the letter along with them: strokes lean and get thinner, and holes bend towards the thorn. Only the outer outline of a letter grows thorns: the holes of letters like **o**, **e**, and **B** never do (though they may bend). Thorn runs last, on the letters as the other effects left them, but it chooses its points on the letter as it was before them and before **Distortion** (see **Thorns stay put** below).

- **Use thorn** — turns it on.
- **Anchors** — how many points of each letter jump, from 1 to 12 (3 to start with).
- **Reach** — how far they jump, as a share of the canvas (10 % to start with; the box reads, for example, "10" followed by "% canvas"). 100 % is the canvas's diagonal, from one corner to the opposite one, so at 100 % a thorn can cross the whole canvas. Each point goes its own distance, somewhere between about a third of Reach and all of it, so the thorns come out in different lengths. At 0 % nothing jumps.
  - The slider is fine at the left and coarse at the right, so short thorns are easy to set exactly: the middle of the track is only 12.5 %, and the right half covers the rest up to 100 %. At the far left, each step (or each press of an arrow key) adds 0.01 %, so even the first step grows tiny thorns; only 0 grows none. The box shows the reach to two decimals, and you can type an exact one there, for example 0.35.
  - Because Reach is measured on the canvas, the thorns keep the same share of the canvas when you change the text **Size** or the canvas size (**W** and **H**): with smaller text or a larger canvas they reach further past the letters. While Thorn is on, such a change makes the app work the letters out again. The PNG multiplier (1×–4×) changes nothing.
  - The **ⓘ** next to Reach says how many ems 100 % is at your current text size and canvas: about 30 em on the starting canvas (1200 × 800 pixels with 48-pixel text). It never goes beyond 256 em, however small the text.
  - Only the tips get longer: **Root**, **Width**, and **Flute width** are still measured on the letters, so they do not change with the canvas.
  - The status line at the bottom and the export dialog show it with its length in ems, for example "reach 10% canvas (about 3.0 em)".
- **Root** — how much of the letter around each point the thorn pulls along (50 % to start with). The thorn grows out of a wide base that narrows to a sharp tip, and the strokes and holes nearby lean and bend towards it. At 0 % the thorns are simply stuck on, and the letter around them stays as it was.
- **Spread** — which way they jump (50 % to start with). At 0 % every point jumps straight out, at right angles to the outline; the higher the Spread, the further each one may lean to either side, up to 90° at 100 %, so the thorns fan out in all directions.
- **Width** — how wide each thorn's tip is where it leaves its base (30 % to start with). At 0 % it is a thin needle; at 100 % the tip is as wide as the base where it starts to narrow.
- **Refraction** — shows the letters as if through ribbed (fluted) glass (0 %, off, to start with). The letters are cut into upright strips, each magnified a little and moved up or down, so strokes and thorns look broken and shifted. The glass covers only the width of the letter itself, plus one strip on either side: where a thorn reaches out to the left or right beyond it, that part of the thorn stays sharp and straight. A thorn that points up or down stays behind the glass along its whole length.
- **Flute width** — how wide each strip of the glass is, as a share of the em (10 % to start with). It is greyed out while **Refraction** is 0 %.
- The numbers show how many points jumped (**Thorns**), how many of them pulled the letter along (**Roots**), and how far the longest one went, in font units (**Longest**).
- **The seed decides where.** Which points jump, which way they lean, how far each goes, and how the glass strips move are picked by the tab's **Seed** (below): the same seed always gives the same thorns, and **Next variant** makes them jump somewhere else. When the Sound tab drives the Seed (for example **Beat** → **Seed**, or the **Flare** preset), they jump somewhere new with the beat, a few letters at a time (see **Thorns take turns** in the Sound tab).
- **Thorns stay put when other settings move.** Thorn picks its points, and which way each thorn points, on the letter as the Geometry tab shapes it before **Distortion**, then follows each point as Distortion and the other effects on this tab bend the letter. So when you move a **Distortion** slider or the **Amount** of **Crumple** or **Ripple** a little, or try another Distortion seed, nearly every thorn stays on its point and keeps pointing the same way while the letter bends around it. The other sliders of Crumple and Ripple, and those of **Whorl** and **Slipstream**, change how these effects bend the letter, so they can still move or turn the thorns. The tab's **Seed** picks new points; so can a change to a Geometry setting before Distortion (such as **Curve flattening**, **Squaring**, Anchor spacing, or **Grid & angles**), which changes the points themselves. Thorn's own **Anchors** slider only adds or removes thorns and leaves the others where they are. Because of this, the same seed gives different thorns than in older versions of the app.
- **Thorns may cross.** A thorn can cut across its own letter or another thorn. There the shapes are merged into one clean outline, as with folds above, so the font still exports. Every thorn is made of straight lines only.
- **Thorns do not move the text.** Where the text sits (**Position** and **Free** in the Typography tab), **Fit text**, and the red note about text running past the canvas edge all go by the letters without their thorns, just as if Thorn were off, also with **Slant**. So thorns may run out of the canvas: on the big canvas they carry on into the darker area around it, and the preview and SVG and PNG exports cut them off at the canvas edge. To select a letter, or drag the text with **Free**, click or drag the letter itself, not a thorn.
- **Very long thorns in a font file.** A font file stores each letter within a square of limited size (16 em across in a font with 2048 units per em, 32.8 em in one with 1000; see [As a font (OTF)](#as-a-font-otf)). Thorn tips that reach further are cut off at its edge in the exported font; the canvas, SVG, and PNG are not affected.
- **Try it:** tick **Use thorn**, set **Anchors** to 1 and **Reach** to 20 %, then press **Next variant** under Seed a few times: each time, one point of every letter shoots out somewhere else and drags the letter with it. Then raise **Refraction** to see the letters through fluted glass.

**Seed** — one number for all the effects on this tab: it picks Crumple's folds; Slipstream's gusts, slips, cuts, and trails; and which points Thorn moves and how its glass strips shift (Ripple and Whorl have no randomness). The same seed and settings always give the same letters; **Next variant** tries the next one. **Reset experimental** turns every effect off and restores its settings, but keeps your seed.

Every copy of a letter gets the same folds, cuts, trails, and thorns, so an exported font looks exactly like the canvas, apart from very long thorns, which a font file cuts short (see Thorn above).

### Sound tab — letters that move with the sound

The third tab, next to **Experimental**. It plays an audio file or listens to the microphone and measures the sound as it goes: how loud it is, how much bass, middle, and treble it has, how bright it sounds, which note is playing, where the beats fall and how busy the sound is, and where the sound sits between left and right. It can also move the letters with the sound: you connect a reading, such as loudness, to a slider, such as Distortion's **Noise amplitude**, and while the music plays the letters roughen when it gets loud and calm down when it gets quiet. You can also connect a reading to a **seed**, so that the points of the letters jump to new places on every beat (see **Mappings** and **Seeds** below). The **Response** sliders set how strongly the letters answer, and **Record** saves the moving letters as a video (see [Record a video](#record-a-video)).

The sound only ever moves sliders and seeds, and only within their own range, so every letter you see is one you could also make by hand with the sliders and seed boxes — built from straight lines, like everything else in the app. (With **Motion contrast** or **Pitch reactive**, letters can react by different amounts at the same moment, and with Thorn on, the letters' thorns take turns, so two letters may sit at different slider values; each one is still a shape the sliders can make.)

Your audio stays in your browser: a file is read on your computer and never uploaded, and the microphone is only used while you listen.

**Source** — where the sound comes from:

- **File** — an audio file from your computer. This is where the tab starts.
  - **Choose file** — pick the file. Most common formats work (MP3, WAV, AAC, OGG, or FLAC, depending on your browser), up to 512 MB. Its name and length (minutes:seconds) appear beside the button; a long name is cut short, and pointing at it shows it in full.
  - **Play** / **Pause** — plays the file through your speakers or headphones. **Play** and **Position** stay greyed out until you have chosen a file.
  - **Loop** — starts the file again from the beginning when it ends. It is on at the start.
  - **Position** — drag to jump to another part of the file. The number shows where you are and the total length, for example "0:42 / 3:15".
- **Microphone** — the sound around you, for example music playing in the room, your voice, or clapping.
  - Choosing **Microphone** pauses the file and shows the **Start listening** button; the microphone turns on only when you click it. The first time, your browser asks whether this page may use the microphone: click **Allow**.
  - **Stop listening** turns the microphone off; **Start listening** turns it on again.
  - While it listens, **Listening** shows next to the button, and **Microphone on** shows in the status line at the bottom, so you can see it from every tab.
  - If the microphone stops by itself (it was unplugged, or the browser's permission was taken away), listening ends, the tab says **The microphone stopped.** and the status line says **No microphone**. The status line says the same if no microphone is found when you start listening.
  - The microphone's sound is only measured, never played back, so it cannot howl through your speakers.
  - **Stop listening**, switching back to **File**, and closing the page all turn the microphone off.
- There is no "off" choice: to stop, press **Pause** (for a file) or **Stop listening** (for the microphone). Switching back to **File** keeps the file you chose, paused.
- If a file plays or the microphone listens but nothing is heard for 3 seconds, the tab says **No sound detected.** Check the volume and that the microphone is not muted, or raise **Sensitivity** (below).

**Levels** — what the sound is like right now: 11 readings in five groups, each on one line with its name, a bar, and a number. Click the **ⓘ** next to a group's name for a short explanation. While nothing plays or listens, the bars are empty and the numbers show "—". Most numbers are percentages: a full bar is 100 %.

- **Loudness**
  - **Level** — how loud the sound is overall. The number is in decibels (dB): the bar is empty at −60 dB and full at 0 dB, the loudest a recording can be. It shows "—" when it is silent.
  - **Swell** — Level, slowed down: it takes about a third of a second to rise and a few seconds to sink, so it follows the big shape of the music — a quiet verse, a loud chorus — rather than every hit. Good for big, calm movements.
- **Bands** — **Bass**, **Mids**, **Treble**: how much bass (below 250 Hz: bass drum, bass guitar), middle (250–2000 Hz: voices and most instruments), and treble (above 2000 Hz: cymbals, hiss, "s" sounds) there is. Each one is compared with its own loudest moment of the last few seconds, so the bars adapt to the music: a full bar means "as strong as this part of the sound has recently been", not "very loud".
- **Tone**
  - **Brightness** — where the energy sits: dull, bass-heavy sound reads low; hiss and cymbals read high.
  - **Pitch** — the note being played or sung. It is made for one note at a time, such as a voice or a melody. The number is in hertz (Hz): the higher the number, the higher the note (440 Hz is the A that orchestras tune to). The bar is empty at 55 Hz (the lowest A of a bass guitar) and full at 1760 Hz, five octaves higher; each octave takes a fifth of the bar. Between notes (for example during a drum hit) it keeps the last note; in silence it drops back and shows "—".
  - **Melody** — a bar that jumps each time the tune moves to a new note and falls back as fast as **Release** (below) sets. The bigger the step to the new note and the clearer the note, the higher it jumps. Like Pitch, it is made for one note at a time, such as a voice or a melody. A held note does not count, and neither does the slide into the first note after a pause or the small wobble of a singer's voice (vibrato). The new note has to last a moment, so some notes of a very quick run can be missed, and a strong wobble can now and then count as a new note.
- **Rhythm**
  - **Beat** — a bar that jumps to full at once and falls back, as fast as **Release** (below) sets. It jumps on every new sound that starts suddenly: a drum hit, a clap, a plucked note. It listens for the bass drum separately too, so the deep "boom" of most dance and pop music makes it jump even when other sound drowns the drum out. A steady sound does not count, even a buzzy, droning bass note: Beat only jumps when the sound in some range of notes suddenly gets louder. Because of that, a bass drum much quieter than a loud bass note playing at the same time may be missed. It works the same with reduced motion turned on in your computer's settings.
  - **Activity** — how busy the sound is right now. It jumps on every sudden change — drum hits, new notes — and stays up while beats come quickly: 8 beats a second fill the bar, 4 a second fill half. On a steady sound, such as a held note, a hum, or steady hiss, it stays near 0 %.
- **Stereo** — where the sound sits between the left and right speakers. This needs a stereo source, so it is mainly for files: a microphone that records a single channel (mono) always reads "C".
  - **Pan** — the side the sound leans to: "C" when it is centred, "L 40" when it leans 40 % to the left, "R 40" when it leans 40 % to the right ("L 100": only the left speaker plays). Its bar grows from the middle towards that side. It is the only reading that goes both ways.
- Very quiet sound counts as silence: the readings fall back to empty (Swell and Activity more slowly), Pan returns to the middle, and Beat does not jump, so background noise does not make it flicker.

**Mappings** — which sliders and seeds the sound moves, and how. Each mapping connects one reading to one slider or seed.

- **Drive letters** — the main on/off switch. The sound moves the letters only while it is on **and** a file plays or the microphone listens (and a font is loaded: without one, the meters still work, but nothing moves). Switch it off to keep watching the meters while the letters stay still. If your computer is set to reduce motion, it starts off and the tab says "Off because your system asks for reduced motion."; switch it on if you want the letters to move anyway. If you turn on reduce motion while the page is open, it switches itself off. If **Strength** (under **Response**, below) is at 0 %, the letters do not move either, and a note under the switch says "Strength is 0%: the letters hold still."
- **Preset** and **Load** — set the letters up and fill in ready-made rows in one go; see **Presets** below.
- **Add mapping** — adds a row. The first one connects **Level** to **Distortion · Noise amplitude** at **+50%**, a good first try; later ones pick a target that no row uses yet — one that already has an effect, if there is one. You can have up to 8 rows; then the button is greyed out and the tab says "Up to 8 mappings."
- Each row has:
  - **Feature** — the reading that drives it: any of the 11 readings above, listed in the same five groups.
  - **Target** — what it moves. A slider is named after its group and its label, for example "Ripple · Petals". There are also three seeds: "Distortion · Seed", "Random anchors · Seed", and just "Seed" for the Experimental tab's seed. The list has two parts, **Geometry** and **Experimental**, in the same order as the tabs.
  - **Depth** — for a slider: how far it moves, from −100 % to +100 %. At +100 % the strongest sound takes the slider the whole length of its track; at +50 %, half of it. Negative values move it the other way, so louder sound turns the value down. 0 % does nothing. **Pan** goes both ways: with a positive Depth, sound on the right turns the value up and sound on the left turns it down.
  - **Rate** — for a seed, the same slider reads **Rate** instead, from 0 % to 100 %: how often the seed jumps (see **Seeds** below). 0 % does nothing.
  - A tick box that switches the row on or off without deleting it, and an **×** button that removes it.
- **How far a slider moves:** it starts from where you left it. If a slider sits a quarter of the way along and Depth is +50 %, full sound takes it to three quarters; silence leaves it where it is. It never goes past either end of its track, and it moves in the same steps as the slider itself. Two rows on the same slider add up.
- Some sliders change faster towards one end, like **Tolerance** and Thorn's **Reach**. The sound still takes them evenly along the track, just as your hand would.
- **Settings switched on for you.** Many targets only have an effect while another setting is on: Ripple's sliders need **Use ripple**, **Grid size** needs **Snap to grid**, and so on. When you pick such a target (or **Add mapping** adds one), the app switches that setting on and says what it changed in a note under the row, for example "Turned on Ripple." or "Set Noise amplitude to 40.":
  - a Crumple, Ripple, Whorl, Slipstream, or Thorn slider turns its effect on; **Flute width** also sets **Refraction** to 50 % when it is 0 % (the glass strips only show with some refraction);
  - the Experimental **Seed** acts while Crumple, Slipstream, or Thorn is on (Ripple and Whorl have no randomness); when all three are off, it turns on Crumple;
  - **Grid size** turns on **Snap to grid**;
  - Distortion's **Noise frequency**, **Normal bias**, and **Seed** set **Noise amplitude** to 40 when it is 0 (at 0, Distortion is off);
  - Random anchors' **Density**, **Randomness**, and **Seed** turn on **Use random anchors**; the Seed also sets **Randomness** to 100 % when it is 0 %;
  - the Curve flattening sliders turn random anchors off (they replace flattening) and set what they need: **Tolerance** sets **Mode** to Adaptive, **Segments per curve** sets it to Fixed segments, and **Corner angle** turns on **Merge joined curves** — for example "Turned off Random anchors. Set Mode to Adaptive." (Corner angle shows little on its own; see Curve flattening.)
- Changing a row to another target, or removing it, never switches anything off again. The note stays until you change the row's target or remove the row. If you go through the **Target** list with the arrow keys, only the target you settle on switches anything on, when you press Enter or move on to another control; a pick with the mouse counts at once.
- If the setting is off again later — you switched it off yourself, or another row needed a different Mode (Tolerance needs Adaptive, Segments per curve needs Fixed segments) — a grey note under the row says why, for example "Turn on Ripple to hear this.", and an **Enable** button next to it switches the setting on again.
- **What can be driven:** every slider of the **Geometry** and **Experimental** tabs — Tolerance, Segments per curve, and Corner angle; Squaring Amount; Anchor spacing and Anchor reduction; Grid size; Noise amplitude, Noise frequency, and Normal bias; Random anchors Density and Randomness; and every slider of Crumple, Ripple, Whorl, Slipstream, and Thorn — and the three seeds: 42 in all. Switches and choices (such as **Mode** or **Allowed directions**) cannot be driven.
- Mappings are kept with your other settings and come back the next time you open the app (see [Coming back later](#coming-back-later)); **Drive letters** is not kept. Adding, changing, or removing a row can be undone like any other change.

**Seeds** — points that jump to new places. A seed picks one random pattern (see Distortion, Random anchors, and the Experimental tab). When the sound drives a seed, each jump moves it on by one — 1234 becomes 1235 — and because every seed is a completely different pattern, every point of the outline lands somewhere new at once (after loading **Flicker**, only a few points of each letter move, a different few each time; while Thorn is on, the Experimental **Seed** and the Random anchors seed reach the letters a few at a time, see **Thorns take turns** below). After 999 999 it starts again at 0.

- **Rate** — how often the seed jumps:
  - with **Beat**, it counts hits: at 100 % the seed moves on at every hit, at 50 % at every other hit, at 25 % at every fourth;
  - with any other reading, it jumps more often the higher the reading is: up to about 5 times a second at 100 % when the bar is full, half as often when the bar is half full. For Pan, either side counts.
  - The **ⓘ** next to **Rate** explains this too.
- **Never too fast:** seed jumps share one limit with the sliders the sound moves, so the letters cannot flash (see **No flashing** below). Seeds that jump at the same moment count as one jump. On its own, a seed can jump up to about 5 times a second; while driven sliders are swinging back and forth too, the seeds jump less often. With fast drums some hits are then skipped; they are not saved up for later.
- **Your seed stays in its box.** Next to a driven seed's box, a small number in the colour of the live lines shows the seed the letters use right now (the live seed). The **Seed** in the Distortion and Random anchors statistics, and the status line at the bottom, show the live seed too. When the sound stops moving the letters — you pause, the file ends, or you switch off **Drive letters** or untick the row — the letters go back to the seed in the box, and the next **Play** starts from it again. To keep a seed you like, press **Freeze**: it writes the live seed into the box.
- **Try it — anchors that jump on the beat:**
  1. Choose **File** → **Choose file**, pick a song with clear drums, and press **Play**.
  2. Click **Add mapping**.
  3. Set **Feature** to **Beat** and **Target** to **Distortion · Seed**. If **Noise amplitude** was 0, the note "Set Noise amplitude to 40." appears under the row: the outline is now rough, so there is something to move.
  4. The row's slider now reads **Rate**: set it to 100 %. The rough outline takes a new shape on every beat. For calmer jumps, lower the Rate.

**Presets** — ready-made starting points, the quickest way to start:

1. Choose **File** → **Choose file** and pick a song (or choose **Microphone**).
2. Under **Mappings**, pick a preset in the **Preset** list. Picking only selects it: nothing changes yet.
3. Press **Load**.
4. Press **Play** (or **Start listening**).

- **Load starts the letters afresh.** It first puts every setting in the **Geometry** and **Experimental** tabs back to its starting value — your three seeds are kept — then sets the few sliders the preset starts from, and replaces your rows with the preset's. So a preset always looks the same, whatever you had set before. Your text, typography, colours, canvas, the sound source, and the six **Response** sliders are not touched.
- **A note under Preset says what Load did,** for example "Loaded Bloom. Turned off Crumple. Other Geometry and Experimental settings back to defaults (seeds kept)." It names the effects it switched off, so you know what went. The note goes away when you load again or pick another preset.
- Load does not ask first, but it is a single undo step: press **Undo** (⌘Z on a Mac, Ctrl+Z elsewhere) right after it to get your earlier settings and rows back. The note under **Preset** then goes away. Picking a target yourself, as described above, never puts anything back to its default: it only switches on what that target needs.
- After loading, change, add, or remove rows, or move any slider, as usual. The **ⓘ** next to **Preset** lists the presets too.
- The presets:
  - **Flicker** — on every beat a few points of each letter jump while the rest hold the letter in shape; louder sound and each beat throw them further. This uses a special Distortion mode (see Distortion).
  - **Scatter** — the points are placed afresh on every other beat: close and even when it is quiet, fewer and more uneven as it gets louder. Loading it turns on random anchors.
  - **Pixel** — the letters snap to a grid that gets coarser with the bass; hiss and cymbals remove points.
  - **Low poly** — loud passages flatten the curves into fewer, longer sides; bright sound removes points.
  - **Block** — round strokes square off as the music swells, and a little more on each beat.
  - **Jitter** — hiss and cymbals make the outlines tremble; brighter sound makes the trembling finer.
  - **Facet** — curves break into a few straight sides as it gets louder and on each beat; higher notes smooth them again.
  - **Bloom** — ripples run through the letters and swell on each beat; the bass bends them into petals. Loading it turns on Ripple.
  - **Flare** — no thorns while it is quiet; as it gets louder, thorns shoot out of a few points of each letter; with the beat they jump somewhere new and briefly multiply, a few letters at a time (see **Thorns take turns** below). Loading it turns on Thorn and sets **Reach** to 0 %; loudness (**Level**) drives Reach with a Depth of +50 %, so at the loudest the thorns reach up to an eighth of the canvas (about 4 em on the starting canvas).
  - **Gale** — loud sound slides slices of the letters past each other; beats cut thin slits along the stream, and busy passages draw trails. Nothing moves while it is quiet. Loading it turns on Slipstream.

**While the sound moves the letters:**

- **Your sliders stay where you put them.** On each driven slider, a thin coloured line moves along the track to show where the sound has taken it right now (a driven seed shows its live seed beside its box instead; see **Seeds** above). When you pause, the file ends, you stop listening, or you switch off **Drive letters**, the letters go back exactly to your slider settings and seeds, and the lines and live seeds disappear.
- **The text stays in place.** Where the text sits on the canvas is worked out from your sliders, not from the moving letters, so the sound never pushes the text around, whatever the effects, seeds, presets, or **Response** settings. If you change a slider, the text, or the typography while the sound plays, the text may shift once, a moment after you stop, to where those new settings put it. **Freeze** copies the moving values into the sliders, so the text may shift once then too. A letter that the sound bends further than your sliders do can reach past the canvas edge: the big canvas shows it in full, but the preview and a video cut it off there (see [Canvas size](#canvas-size)).
- **Letters can react by different amounts.** With **Motion contrast** or **Pitch reactive** (under **Response**, below) above 0 %, some letters move less than the others and some move more, so the same letter can look different in two places of the text. The line on a slider shows the shared value: where the sound takes the letters that react by the usual amount. Seeds jump the same way for every letter (with Thorn on, the Experimental and Random anchors seeds take turns instead; see the next point). At 0 % (where both start), all letters move together. While Thorn is on, these two leave the settings that take turns alone (see the next point): those are the same for every letter of a group. They still change the others, such as Distortion and the **Amount** of Crumple and Ripple.
- **Thorns take turns.** While Thorn is on, the thorns no longer all change at once. The letters are split into five groups, each spread across the text, and at most every quarter of a second the next group takes on the sound's latest settings. So the thorns of at most about a fifth of the letters change at a time, and each letter's thorns change at most about once every 1¼ seconds, however long or short the text is. A beat on the **Seed** or on Thorn's **Anchors** therefore ripples through the text over about 1¼ seconds instead of making every letter jump together.
  - **Which settings take turns** while Thorn is on: all of Thorn's sliders, the Experimental **Seed** (so Crumple's folds and Slipstream's gusts also change a few letters at a time), every Geometry setting that comes before Distortion (Curve flattening, Squaring, Anchors, Grid & angles, and Random anchors), and the sliders of Crumple, Ripple, Whorl, and Slipstream, except the two below.
  - **Which stay smooth** and change every letter together: Distortion's sliders and its seed, and the **Amount** of Crumple and of Ripple. The thorns stay on their points while these move (see **Thorns stay put** under Thorn).
  - A slider you move yourself, one the sound is not driving, still changes every letter at once. When the sound starts moving the letters, when you turn Thorn on, or when you change the text or the font, every letter starts on the latest settings together. With Thorn off, nothing takes turns.
- **Live · N fps** — shown in the Sound tab and in the status line at the bottom: how many new shapes a second the app can keep up with (fps means frames per second). The app draws the next shape as soon as the last one is ready, at most 30 a second, so heavy settings and long texts give fewer. Motion contrast and Pitch reactive give the app up to three versions of each letter to work out, so they lower the number too. It counts new shapes, not how often the app listens to the sound (that happens at the screen's own pace, and only while the tab is in view).
- **No flashing:** every driven slider and seed shares one limit, so that together they make the letters flash at most 3 times a second. A flash is a big change and the change back, so that is about 5 big changes a second. A big change is a slider turning back by a tenth of its track or more (several sliders turning back at the same moment count together once their moves add up to a tenth), or a seed jump (see **Seeds** above). When the music would go faster (fast drums with a short **Release**, for example), the sliders wait a moment before they turn back again, and seed jumps are skipped. The limit watches every letter on screen: with Motion contrast or Pitch reactive, the letters that move furthest count, and a letter switching between moving less and moving more counts as a change too. A change that reaches the screen in a few quick steps, as when the melody moves to a new note, counts once. A group of letters taking its turn (see **Thorns take turns**) counts as a big change too when its thorns change a lot; when the limit is reached, the turn waits a moment.
- If that falls below about 8 a second, the tab says "Too slow to follow the sound: try fewer effects or a shorter text." (with Motion contrast or Pitch reactive on: "Too slow to follow the sound: try fewer effects, a shorter text, or less Motion contrast and Pitch reactive."). Turning off some Experimental effects, using a shorter text, choosing lighter settings, or lowering those two sliders helps.
- **Freeze** — copies what the letters look like right now into the sliders and seed boxes and pauses the sound (the file pauses, or the microphone stops listening). That moment stays on screen as ordinary settings that you can keep adjusting or export. Press **Play** or **Start listening** to carry on. Freeze is greyed out while the sound is not moving the letters, and while a video is recording ("Freeze is off while recording."). Pressed while the shared values (the lines on the sliders, and the live seeds) match your sliders and seeds (for example between two drum hits), it only pauses the sound. **Undo** puts the sliders and seeds back as they were before Freeze (the sound stays paused).
  - With Motion contrast, Pitch reactive, or Thorn's turns, Freeze writes the shared values (the ones the lines on the sliders show). Every letter then takes them, so the letters that moved more or less than the others, or whose thorns had not had their turn yet, look like the rest again.
- **SVG, PNG, and font exports always use the sliders and seed boxes**, never the moving letters. To save a moment of the music, press **Freeze** first, then **Export…**. While the sound is moving the letters, the export dialog reminds you of this. To keep the movement itself, record a video: it shows the letters exactly as they move, each with its own amount (see [Record a video](#record-a-video)). **Fit text** and **Free** (in the Typography tab) also measure the letters as your sliders make them, as exports do.

**Response** — how the sound is measured and how strongly the letters answer it. Six sliders, each with an **ⓘ** that explains it. At their starting values the letters move just as the mappings set them.

- **Sensitivity** — boosts or cuts the input before measuring, for quiet or loud sources (−24 to +24 dB, default 0 dB). Raise it for a quiet room or a distant microphone, which also helps Beat catch quiet hits; lower it if the bars are always full.
- **Strength** — how far all the mappings move the letters, from 0 % to 400 % (default 100 %). At 50 % they move half as far, at 200 % twice as far; a slider still stops at the end of its track. It also scales every seed's **Rate** (which never goes past 100 %). At 0 % the letters hold still. Larger moves are held back more often by the no-flashing limit (see **No flashing** above).
- **Motion contrast** — lets each letter react by its own amount (0–100 %, default 0 %). At 0 % every letter moves the same. Above 0 %, about one letter in six moves less than the rest, about one in six moves more, and the others move by the shared amount; the higher the value, the bigger the difference (at 100 %, the letters that move more go several times as far as the shared amount, and those that move less go only a fraction of it). Which letters lead drifts slowly, every few seconds. **Strength** still sets the overall amount. While Thorn is on, it leaves the settings that take turns alone (see **Thorns take turns** above). It can lower the frame rate.
- **Release** — how slowly the readings fall back after a sound: short is jumpy, long is calm (20–1000 ms, default 150 ms). Most readings rise at once; Beat and Melody fall back at this speed; Swell and Pitch keep their own speed. (Earlier versions called it **Smoothing**.)
- **Pitch reactive** — lets the note decide which letters move most (0–200 %, default 0 %): the low notes of the tune move the letters on the left more, its high notes those on the right, so a tune sweeps across the whole text, whether it is sung low or high. The app learns the tune's range from the last few seconds of notes: it starts with an octave around the first clear note, stretches almost at once (in about 0.15 seconds) when a higher or lower note comes, and slowly narrows towards the latest note over about 8 seconds; after 8 seconds without a note it starts afresh. The range is never narrower than an octave, so a steady voice does not throw the letters from side to side, and notes at the very bottom or top of the **Pitch** meter (within a semitone of 55 Hz or 1760 Hz) are ignored, because chords and drums tend to read there. Because the range stretches with each new note, the first time a tune climbs, each new highest note sits at the right edge; once the app has heard the whole tune, each note gets its own place. It needs a clear single note, such as a voice or one instrument. The higher the value, the bigger the difference; at high values a quick jump of an octave is now and then held back by the flash limit (see **No flashing** above). While Thorn is on, it leaves the settings that take turns alone, as Motion contrast does. It can lower the frame rate.
- **Melody tracking** — adds movement each time the tune moves to a new note, even while the loudness stays the same (0–200 %, default 0 %). It gives every slider row a push from the **Melody** reading (see **Levels** above): the higher the value, the bigger the push. Rows on **Pan** or on **Melody** itself, and seeds, get no push. To move a slider with the melody alone, pick **Melody** as a row's **Feature** instead.
- **Reset sound** — puts all six back to their starting values: 0 dB, 100 %, 0 %, 150 ms, 0 %, and 0 %. It is greyed out when they already are.
- All six are kept with your work and can be undone like any other setting (see [Coming back later](#coming-back-later)). Loading a preset does not change them.

**If something goes wrong**, a message appears under the source (pointing at it may show the browser's own technical detail):

| Message | What it means | What to do |
|---|---|---|
| This browser cannot analyse sound. | Your browser cannot measure sound. | Use a recent Chrome, Edge, Firefox, or Safari. |
| This browser cannot use the microphone. | Your browser cannot open a microphone here, or opening it failed for a reason the browser did not explain. | Try another browser, or use a file. |
| This file is not audio this browser can play. | The file is not audio, is damaged, or is in a format this browser does not know. | Try an MP3 or WAV file, or another browser. |
| This file has no length. | The file is empty. | Choose another file. |
| This file is too large (over 512 MB). | The file is too big to open. | Use a shorter or compressed file, such as an MP3. |
| Microphone access was refused. Allow it in the browser’s site settings, then try again. | You or the browser said no to the microphone. | Open the site settings (usually the icon at the left of the address bar), allow the microphone, then click **Start listening**. |
| No microphone found. | No microphone is connected. | Connect one, then try again. |
| The microphone could not be opened; another app may be using it. | The microphone is there but would not open: another program, such as a video call, may be using it. | Close that program, then try again. |
| The microphone opened, but this browser could not analyse it. | The microphone works, but the browser could not pass its sound on to be measured. | Try again; if it keeps happening, try another browser or another microphone. |
| The microphone stopped. | The microphone stopped while listening: it was unplugged, or the browser's permission was taken away. | Plug it in again or allow it again, then click **Start listening**. |
| The microphone needs a secure page (https or localhost). | The page was opened from an address starting with `http://`. | Open the app's `https://` address. |

#### Record a video

The **Record** group, at the bottom of the Sound tab, saves the canvas as a video while the sound moves the letters, in real time and with the sound in it. Unlike the other exports, a video keeps the movement: every letter exactly as it moves, including letters that react by their own amounts and thorns taking turns, with the text held in place as on the canvas. It records what the canvas shows, so a change you make during a take is in the video too. Like a PNG, it shows only the canvas: anything past its edge is cut off. (A **take** is one recording, from **Record** until it ends.)

1. Choose the sound — **File** → **Choose file**, or **Microphone** — and set up the letters and mappings as usual.
2. Set the options below.
3. Press **Record**. If the file is paused, Record starts playing it from the current **Position**; with the microphone, it starts listening (the first time, the browser asks for permission). Recording begins as soon as the sound runs.
4. Press **Stop**, or let the chosen **Length** end the take. The video is saved to your computer like any other export (usually into your Downloads folder). If Record started the file or the microphone, it pauses the file or stops listening again.

- **Record** / **Stop** — beside it, the time recorded and, for a set length, how long the take will be (for example "0:03 / 0:10"), and **Live · N fps** while the sound moves the letters. When Record cannot start, it is greyed out and the reason shows underneath: "Load a font to record.", "Choose an audio file first.", "Opening the sound…", or "This browser cannot record video."
- **Format** — **MP4** (the starting choice; it plays almost everywhere) or **WebM**. A browser that cannot write MP4 saves WebM instead and says "MP4 isn't supported in this browser: saved as WebM." A format the browser cannot write at all is greyed out and marked "(not supported in this browser)".
- **Length** — how long a take runs: **Until stopped** (the starting choice), **5 s**, **10 s**, **15 s**, **30 s**, **60 s**, or **Whole file**. **Whole file** plays the audio file from its start to its end, with **Loop** off for the take (it comes back on afterwards if it was on). It needs a chosen audio file, so it is greyed out for the microphone or before you choose a file; if it was already chosen, a note says "Whole file needs an audio file: this take runs until stopped." Every take stops after 10 minutes at the latest ("Stopped at the 10-minute limit."), because the browser holds the video in its memory until it is saved.
- **Include audio** — puts the sound into the video, lined up with the letters (on at the start). With the microphone, its sound goes into the file, but it is still never played through your speakers. Recording does not change what you hear.
- **Use the preview look** — off (the start): the canvas in its **Color** settings, as a PNG export shows it. On: the look of the small preview at the bottom right, with its **Blur** and, if **Invert** is on, its swapped colours.
- **The size line** under the options says what the next take will be, for example "1200 × 800 px · up to 30 fps · MP4". The size is the PNG size: the canvas's **W** × **H** times its 1×–4× multiplier (see [Canvas size](#canvas-size)). A video larger than 4K (longer than 3840 px, or more pixels than 3840 × 2160) is scaled down to fit, and the line adds "(scaled down to the 4K limit)". A video cannot be transparent: with **Transparent background** on, the background colour is painted, and a note says "Videos have no transparency: the background colour is painted."
- **Frames:** the video gets a new frame each time the canvas shows a new shape, at most 30 a second — the same number as **Live · N fps**. While the letters stand still, the video holds the picture (with at least one frame a second, so players keep time). If the app cannot keep up, the group says "Too slow for a smooth video: try fewer effects or a shorter text."
- If nothing would move — **Drive letters** is off, **Strength** is 0 %, or no row has a Depth — a note says "Sound is not moving the letters: the video will be still." You can still record.
- **In the header:** while a take runs, the top of the screen shows "Starting to record…", then a red light with "Recording 0:12", then "Saving the video…", with a square stop button that stays in reach whichever tab is open in the tools. When the take has ended, the header says how it went until you close the note with its **×**.
- **From the export dialog:** **Export…** → **Video — live sound** shows the same options (changing them there changes them here). Its **Record** button closes the dialog and starts the take at once; stop it in the header. If you open the dialog again during a take, it has its own **Stop**. See [As a video](#as-a-video).
- **What ends a take** (what was recorded so far is always saved):
  - **Stop** — in the group, in the header, or in the export dialog;
  - the chosen **Length**, or the end of the file with **Whole file**;
  - the sound stopping — you press **Pause** or **Stop listening**, the file ends with **Loop** off, the microphone stops, or you switch between **File** and **Microphone**: "The sound stopped, so the recording ended.";
  - hiding the tab — switching to another tab or minimising the window: "Recording stopped because the tab was hidden." (a hidden page is not drawn, so the video would freeze);
  - changing the canvas size or its multiplier: "Recording stopped because the canvas size changed.";
  - the 10-minute limit.
  - Closing the page during a take asks you first.
- **When it is saved,** the group and the header say so, for example "Saved Roboto-Regular-video.mp4: 0:05, 1200 × 800 px." The file is named after the font's family and style, then "video" — or "video-preview" with **Use the preview look** — for example `Roboto-Regular-video.mp4` or `Roboto-Regular-video-preview.webm`.
- **Good to know:**
  - Some players show no total length for a WebM file, or let you jump around in it only after it has played once. The video itself is complete; web browsers and players such as VLC play it.
  - Long takes at a large size make large files: up to about 1 GB for 10 minutes at the 4K limit.
  - The options last until you close the page. They are not saved with your work and are not undone.

If a take goes wrong, the group and the header say why:

| Message | What it means | What to do |
|---|---|---|
| This browser cannot record video. | Your browser cannot record the canvas as a video. | Use a recent Chrome, Edge, Firefox, or Safari. |
| The sound did not start, so nothing was recorded. | The file did not play, or the microphone did not open. | Check the message under the source (see the table above), then press **Record** again. |
| The sound stopped before recording began, so nothing was recorded. | The sound started but stopped again before recording began. | Press **Record** again. |
| The video did not start, so nothing was recorded. | The sound ran, but the canvas gave no picture for 30 seconds. | Keep the tab in view, try lighter settings, and press **Record** again. |
| The sound could not be recorded: the video is silent. | The video was saved, but without its sound. | Record again; if it keeps happening, try another browser, or turn off **Include audio**. |
| Blur isn't available for video in this browser: recorded without it. | **Use the preview look** was on with a blur, but this browser cannot blur a video. | Use another browser for a blurred video, or save stills with **Export the preview look** (PNG). |
| Recording failed: … | The browser's video recorder stopped with an error (its own description follows). "Saved what was recorded: …" means the part before the error was saved; "Nothing was recorded." means nothing was. | Try again, or try the other **Format**. |

### Typography tab — size, spacing, and alignment

The **Typography**, **Glyphs**, and **Color** tabs are at the bottom left. These place the text on the canvas. They do not change the shape of the letters or the exported font file.

- **Size** — the letter size in pixels (how tall one em is on the canvas). It stays the same when you change the canvas size. You can drag the slider or type a number.
- **Fit text** — makes the text as large as possible while keeping a 25-pixel gap to the canvas edges. Thorns do not count: they may still reach past the edges (see Thorn in the Experimental tab).
- **Tracking** — extra space between letters. Negative values pull letters closer.
- **Line height** — space between lines. 1 is the font's own line spacing; 2 is double.
- **Slant** — leans the letters, like a quick italic. Positive leans right, negative leans left.
- **Align** — the three buttons with lines line up the lines of text on the left, in the centre, or on the right.
- **Position** — where the text sits on the canvas. Click one of the nine dots: a corner, the middle of an edge, or the very middle. The text moves there, keeping a 25-pixel gap to the edges, and its lines line up to match: dots on the left line up left, in the middle centred, on the right line up right. The chosen dot glows. Click **Free** to place the text yourself: it first goes back to the starting position, then you drag it on the big canvas (click Free again any time to send it back). It stops at the canvas edges, so it can never be dragged off the page. Dragging anywhere else on the canvas still moves the view. With Thorn on, the gap, the edges, and where you can grab the text go by the letters without their thorns: drag a letter, not a thorn. While the Sound tab moves the letters, the text stays where your sliders put it: the sound never moves it.
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
Experimental tab → **Use crumple** on, **Amount** 70–100 %, **Facet size** 15–25 %. For bold, chunky folds, combine it with a large Curve flattening **Tolerance** (40 or more). Press **Next variant** until you like the folds.

**Polygonal ripples**
Experimental tab → **Use ripple** on, **Amount** 50 %, **Wavelength** 25–35 %, **Sides** 6 or 8. For hard, triangular shock waves try **Sides** 3 with a large Curve flattening **Tolerance**; for a wave sweeping in from a corner, set **Center X** and **Center Y** to 0 %.

**Faceted flowers**
Experimental tab → **Use ripple** on, **Amount** 0–30 %, **Petals** 40–60 %, **Sides** 5 (or 4 for a four-leaf look). For wild blossoms, raise **Petals** to 100–200 % and **Amount** to 200 % or more.

**Whirlpool letters**
Experimental tab → **Use whorl** on, **Amount** 60–100 %, **Pin top and bottom** on for a twist inside the letter (off to spin the whole letter), **Rings** 4–6, **Sides** 8. Push **Amount** past 100 % for folded, shredded swirls.

**Blown away**
Experimental tab → **Use slipstream** on, **Strength** 30 %, **Slip** 0, **Cuts** 0, **Trails** 2–4, **Gust size** 10–15 %, **Gustiness** 60–100 %. Raise **Tracking** in the Typography tab if the letters run into each other, and press **Next variant** for different gusts.

**Sliced letters**
Experimental tab → **Use slipstream** on, **Strength** 0 %, **Slip** 20–40 %, **Cuts** 2–4, **Trails** 0. The letters break into slices that slide past each other, with thin slits along the stream. Change **Direction** to 90° for slices that slide up and down.

**Thorny letters behind glass**
Experimental tab → **Use thorn** on, **Anchors** 2–3, **Reach** 3–10 %, **Root** 50–80 %, then raise **Refraction** to 50 % with **Flute width** 8–15 %. Press **Next variant** until the thorns land where you like them.

**Unreadable, shattered letters**
Experimental tab → **Use crumple** at 300–500 %, or **Use ripple** at 200–400 %, or **Use slipstream** with **Gustiness** 150–200 %. Combine them for total chaos, and press **Next variant** until the shapes surprise you. With several of them near their maximum the letters are simplified into coarse slabs (see "When the settings get very heavy" in the Experimental tab). Exporting a whole large font with every effect at its maximum can exceed the file's point limit; export only the characters in the text instead.

**Letters that pulse with the music**
Sound tab → **File** → **Choose file** → **Play**. Under **Mappings**, click **Add mapping** (Level → Distortion · Noise amplitude, +50 %): loud passages roughen the letters, quiet ones smooth them. For a stronger effect raise **Depth**, or start Distortion's **Noise amplitude** a little higher. Press **Freeze** at a moment you like, then export it.

**Petals that open on the bass**
Experimental tab → **Use ripple** on, **Amount** 0–30 %, **Petals** 0–20 %, **Sides** 5. Sound tab → **Add mapping**, then set **Feature** to **Bass**, **Target** to **Ripple · Petals**, and **Depth** to +10 %. For a shiver on the cymbals as well, add **Treble** → **Crumple · Amount** (this turns on Crumple for you).

**Anchors that jump on the beat**
Sound tab → **File** → **Choose file** → **Play**. Click **Add mapping**, set **Feature** to **Beat**, **Target** to **Distortion · Seed** (if **Noise amplitude** was 0, it is set to 40 for you), and **Rate** to 100 %: the rough outline takes a new shape on every beat. For points that move along the letter itself, choose **Random anchors · Seed** instead (this turns on random anchors). Press **Freeze** when you like a shape.

**Back to the original**
Set Curve flattening to **Adaptive** with a small **Tolerance**, and turn off Squaring, Anchors, Grid & angles, Distortion, and the Experimental effects (each has a reset button). Or simply choose **Original** in the canvas toolbar to look at the untouched font.

---

## 10. Saving your work (Export)

Click **Export…** in the top-right corner. Nothing is downloaded until you press a download button (a video is saved when its take ends).

SVG, PNG, and font exports always use your slider settings and seeds. If the **Sound** tab is moving the letters, press **Freeze** first to export the moment you see. A video is different: it records the letters as they move with the sound (see [As a video](#as-a-video)).

### As an image (SVG or PNG)

Both save the canvas: its size, your text placed as on the canvas, and your colours.

1. Choose **SVG — main view** (shapes you can keep editing) or **PNG — main view** (a picture).
2. For a transparent background (only the letters are drawn), tick **Transparent background** in the Color tab first.
3. Optional: tick **Export the preview look** to save what the small preview shows instead — its blur, and its swapped colours if **Invert** is on. Set Blur and Invert in the preview first.
4. For SVG, **Coordinate precision** — how many decimals the numbers in the file keep; 2 is a good default. The preview shows the letters at this precision too, and the app keeps your choice for next time. For PNG, the image size comes from **Canvas size** (width × height × the 1×–4× multiplier).
5. Click **Download SVG** or **Download PNG**. If some letters are not ready yet at the current settings, the dialog says **Computing outlines…** and the download starts as soon as they are; **Cancel** stops it.

SVG files open in Illustrator, Figma, Inkscape, and web browsers; the shapes contain only straight lines. A blurred SVG uses a blur effect that browsers and most design apps show; if an app ignores it, use PNG.

### As a font (OTF)

1. Choose **Font file — OpenType (.otf)**.
2. **Glyphs to include:** **Current glyph**, **Specimen characters** (only the characters in your text), or **All mapped characters** (every letter the font has).
3. Give it a **Family name** and **Style name** — use plain English letters. A new name avoids confusion with the original font. Below the names, the dialog says about how many outline points the font will have. A yellow note warns you if that is more than a font file can hold (1,000,000), or if many letters still have to be worked out at these settings, so that the build may take minutes.
4. Click **Build & verify**. The app builds the font in the background and then checks it thoroughly, showing how far it has got (for example "Processing outlines 120 / 300", then writing and checking the file). Letters already drawn on the canvas are reused, so only the others need working out. **Cancel** stops the build at once. If the build makes no progress for a whole minute, it is stopped and the dialog says "The export stopped responding."
5. When it says "Verified", click **Download .otf** and install the font like any other.

Good to know:

- If you change any setting after building, build again before downloading.
- The new font keeps the original's **kerning** — the fine spacing between pairs such as "AV" — for the letters it contains, so text sets as it does on the canvas. Ligatures, the placing of accents on letters, kerning that depends on the neighbouring letters or on the language, and the original's other advanced features are not included. **What the font file does not include** in the dialog lists them all.
- Letters are saved with the same weight, style (for example italic), slant, line spacing, and copyright and license details as the original font, so a Regular and a Bold you make install side by side like the originals.
- Lines are spaced as on the canvas, on Mac and Windows alike. If letters reach far above or below their usual height (for example with Slipstream), a few older apps may space the lines further apart.
- **Letters that reach very far are trimmed.** A font file stores each letter within a square 32,766 font units across — 16 em in a font with 2048 units per em, 32.8 em in one with 1000 — placed around the letter. Parts of an outline that reach further, such as long Thorn tips, are cut off with straight cuts at the square's edge, so the letter is still saved. The dialog lists these letters under "Trimmed to fit". This only changes the font file: the canvas, SVG, and PNG show them as before.
- Very rarely a letter cannot be stored in a font file at all — for example, its shape has details finer than one font unit, or it takes up more than 32,767 font units of width (from its start to where the next letter begins). The dialog then says "Left out of the font file:" and names each such letter with the reason. For details that are too fine, less **Distortion** or **Anchor spacing** usually helps.
- With very dense settings (Anchor spacing near 1, or strong Experimental effects) a whole font can have too many points for one file. The dialog warns you before you build, and suggests a larger Anchor spacing, weaker Experimental effects, or exporting only the characters in your text.
- Variable fonts are saved in the version you see on screen, with their kerning rounded to whole font units.
- **Licensing:** a modified font is still based on someone else's design. Check the original font's license before sharing it — many open-source fonts require a new name for modified versions. If the original reserves its name, the export dialog tells you to choose a different family name.

### As a video

1. Choose **Video — live sound**. It needs a font and a sound: an audio file chosen in the Sound tab, or the microphone.
2. Set **Format**, **Length**, **Include audio**, and **Use the preview look**. These are the same options as in the Sound tab's **Record** group: changing them here changes them there. The line under them shows the video's size, for example "1200 × 800 px · up to 30 fps · MP4".
3. Click **Record**. The dialog closes and the take starts at once: a paused file starts playing, or the microphone starts listening. The top of the screen shows, for example, "Recording 0:02" and a square stop button.
4. Click the stop button, or wait for the chosen **Length**. The video is saved when the take ends, and the header says what was saved.

What each option does, what ends a take, and how the file is named are explained in [Record a video](#record-a-video).

### As a config file (settings only)

A config file keeps your settings, not your letters: load it later, in another browser, or on another computer, and the app is set up as it was. It is a small `.json` file.

1. Choose **Config — settings (.json)**. This also works before you load a font.
2. The dialog says which font the file asks for. Click **Download config**. The file is named after the font, for example `none-curve-Roboto-config.json`.

It holds the same things the app keeps between visits (see [Coming back later](#coming-back-later)): every setting, the canvas size, the text, the canvas view buttons, the preview's Blur and Invert, the **Coordinate precision**, the Sound tab's mappings and **Response** sliders, the selected letter, and the font's name. It never holds the font itself, the sound, or the video options.

**To load it:** click **Import font** → **Config file** and pick the file, or drag it onto the canvas.

- Your settings, text, Sound mappings, and Response sliders change in one go, and one **Undo** brings back what you had before. The canvas view buttons, the preview's Blur and Invert, and the Coordinate precision change too, but Undo leaves them as they are (they are never undone).
- A **Google font** in the file is downloaded again (unless it is already open). A **font from your computer** cannot be opened for you: the note under the menu names the file — import it and the letters appear with the loaded settings.
- A file that is not a config file (any other `.json`, or a damaged one) is refused: the note says "Config not imported" and nothing changes. A file saved by an older version of the app is converted, as saved work is; one from a newer version loads what this version knows, and the note says so.
- Close the note with its × button; it also goes away when you load another font.

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
No. Your text, settings, Sound mappings, and **Response** sliders are kept in this browser and come back when the page opens again, and the same settings and seed always give the same result. A Google font is downloaded again by itself; a font from your computer has to be imported again. See [Coming back later](#coming-back-later). To keep a result for sure, export it.

**I changed something by mistake.**
Press **Undo** (the arrow at the top right, or ⌘Z on a Mac, Ctrl+Z elsewhere). See [Undo and redo](#undo-and-redo).

**How do I start over from scratch?**
Use the reset buttons of the groups you changed, or, to start completely fresh, clear this site's data in your browser's settings and reload the page. See [Coming back later](#coming-back-later).

**A letter is missing, and the text box says some glyphs "failed to process".**
The app gives up on a letter that takes longer than 60 seconds to work out. That letter is left out of the canvas and of exports; a font export lists it with the reason "Took longer than 60 s; try lighter settings". Lower the heaviest settings (usually Experimental effects or a small **Anchor spacing**).

**A red message on the canvas says "The geometry worker … Reload the page to try again."**
The letters are worked out in the background by a part of the app called the geometry worker. If it could not start, or kept failing or stopped responding several times in a row, the letters cannot be drawn any more: reload the page. If a heavy setting was the cause, lower it after reloading. "The geometry worker could not open this font" means the font file could not be read for drawing; try another copy of the font.

**The letters do not move with the music.**
In the Sound tab, check that a font is loaded, that the file is playing (or the microphone is listening), that **Drive letters** is switched on, that **Strength** (under **Response**) is above 0 % (at 0 % a note under Drive letters says "Strength is 0%: the letters hold still."), and that there is at least one mapping that is ticked and has a **Depth** (or **Rate**) other than 0 %. If a grey note sits under the row, click **Enable** next to it — for example, "Turn on Crumple to hear this." means the Crumple effect is off. If the meters stay empty, the sound is too quiet: raise **Sensitivity**. The app listens only while its tab is in view: when you switch to another tab, minimise the window, or hide it behind another window, the letters stop following the sound, and they pick it up again when you come back.

**The sliders and seeds do not move while the letters do.**
That is on purpose: your sliders and seed boxes keep your settings. The thin line on each driven slider shows where the sound has taken it, and the small number beside a driven seed's box is the live seed. When the sound stops, the letters go back to your settings. Press **Freeze** to copy the current look into the sliders and seed boxes.

**A setting switched itself on when I picked a target.**
That target only has an effect while that setting is on, so the app switched it on and said so under the row (for example "Turned on Ripple."). It stays on when you change the row's target or remove the row; switch it off yourself if you do not want it.

**My export does not look like the moving letters.**
SVG, PNG, and font exports use the sliders, not the sound. Press **Freeze** at the moment you want, then export. With **Motion contrast**, **Pitch reactive**, or Thorn's turns, Freeze gives every letter the shared values, so the frozen letters look more alike than the moving ones did. To keep the movement itself, record a video: **Video — live sound** in the export dialog, or **Record** in the Sound tab (see [Record a video](#record-a-video)).

**The video is choppy.**
A video gets as many frames a second as the app draws while the sound moves the letters — the **Live · N fps** number, at most 30. Heavy settings, a long text, **Motion contrast**, and **Pitch reactive** lower it; below about 8 a second the Record group says "Too slow for a smooth video: try fewer effects or a shorter text." Turn off some Experimental effects, use a shorter text, or lower Motion contrast and Pitch reactive, then record again. While the letters stand still, the video holds the picture: that is not a fault.

**Why did I get a WebM file instead of MP4?**
Not every browser can write MP4. When yours cannot, the app saves WebM instead and says "MP4 isn't supported in this browser: saved as WebM."; in the **Format** list, MP4 is then marked "(not supported in this browser)". WebM plays in web browsers and in players such as VLC. If you need MP4, record in another browser (for example a recent Chrome or Edge), or convert the file with a video converter. Some players show no total length for a WebM file; the video itself is complete.

**Sound and picture are slightly out of step in the video.**
The letters always follow the sound a moment late, because each new shape takes time to work out. The app delays the sound in the video by the same amount, measured when the take starts, but it can still be off by about one frame, and by more if the frame rate changes a lot during the take. Let the sound move the letters for a few seconds before you press **Record**, so the app can measure the delay, and use lighter settings so the frame rate stays steady. A video editor can shift the sound if you need it exact.

**The recording stopped when I switched tabs.**
A browser stops drawing a page you cannot see, so the video would freeze. The app therefore ends the take when its tab is hidden — you switch to another tab or minimise the window — saves what it recorded, and says "Recording stopped because the tab was hidden." Keep the app's tab open and in view until the take ends.

**The thorns got longer or shorter when I changed the text size or the canvas.**
Thorn's **Reach** is a share of the canvas, not of the letters, so the thorns keep the same share of the canvas: smaller text or a larger canvas makes them longer next to the letters. Lower or raise **Reach** to get the length you want; the **ⓘ** next to it says how many ems 100 % is right now.

**My thorns are cut off at the canvas edge.**
Thorns may reach past the canvas. The big canvas shows them in full, but the preview and SVG and PNG exports cut them off at the canvas edge, like anything outside it; no red note appears for thorns. Lower **Reach**, or press **Next variant** until they point into the canvas. A font file has no canvas: there, only very long thorns are trimmed (see [As a font (OTF)](#as-a-font-otf)).

**While the music plays, only a few letters' thorns change at a time.**
That is on purpose. With Thorn on, the letters take turns, so new thorns ripple through the text instead of every letter jumping at once: at most about a fifth of the letters every quarter of a second, and each letter at most about once every 1¼ seconds (see **Thorns take turns** in the Sound tab). To give every letter the latest thorns at once, press **Freeze**.

**A letter is cut off at the canvas edge while the music plays.**
While the sound moves the letters, the text holds its place, worked out from your sliders, so it never shakes. A letter that the sound bends further than your sliders do can then reach past the canvas edge: the big canvas shows it in full, but the preview and a video cut it off there. Leave more room around the text (a smaller **Size**, or a **Position** away from that edge), or lower the **Depth** of the rows that bend the letters most.

**My thorns sit somewhere else than in work I saved earlier.**
This version of the app picks the thorns' points in a steadier way, so they stay put when other settings move (see **Thorns stay put** under Thorn). As a result, the same **Seed** gives different thorns than older versions did. Press **Next variant** until you like them again.

**Does anything get uploaded?**
No. Local fonts and audio files stay on your computer, and the microphone's sound is only measured in your browser. Videos are made in your browser and saved straight to your computer. Google fonts are downloaded from Google; nothing is sent anywhere else.

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
| **fps (frames per second)** | How many new shapes a second the app can keep up with while the sound moves the letters. A video gets the same number of frames a second. |
| **Strength** | In the Sound tab's **Response** group: how far all the mappings move the letters, from 0 % (they hold still) to 400 %; at 100 % they move just as the mappings set them. |
| **Motion contrast** | In the **Response** group: lets each letter react by its own amount, so some letters move less and some more than the shared amount the slider lines show. |
| **Pitch reactive** | In the **Response** group: lets the note decide which letters move most — the low notes of the recent tune move the letters on the left most, its high notes those on the right, whatever the tune's range. |
| **Thorns take turns** | In the Sound tab, while Thorn is on: the letters are split into five groups that take on the sound's latest thorn settings one after another, so only a few letters' thorns change at a time. |
| **Melody** | A Sound reading that jumps each time the tune moves to a new note. **Melody tracking** in the Response group uses it to give the slider mappings a push. |
| **Release** | How slowly the Sound readings fall back after a sound (earlier versions called it Smoothing). |
| **Take** | One video recording, from **Record** until it ends. |
| **MP4** | A video file format that plays almost everywhere. |
| **WebM** | An open video file format that web browsers and many players play; saved when the browser cannot write MP4. |
| **Em / Units per em** | The invisible design square of a font and its size in font units (often 1000 or 2048). |
| **Font unit (u)** | The measuring unit inside a font. All sizes in the controls use it. |
| **Baseline** | The line letters sit on. |
| **x-height / cap height** | The height of lowercase "x" / of capital letters. |
| **Ascender / descender** | Parts that rise above the x-height (h, d) or drop below the baseline (p, g). |
| **Advance width** | How far the text moves forward after a letter, including its side spacing. |
| **Kerning** | Small spacing adjustments between specific pairs, like "AV". |
| **Variable font** | A font file that contains a range of weights or widths. |
| **Font collection** | One file (`.ttc` or `.otc`) that holds several fonts, usually the styles of one family. |
| **SVG** | A vector image format that keeps shapes sharp at any size. |
| **OTF (OpenType)** | A standard font file format you can install on a computer. |
