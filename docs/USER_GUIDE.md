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
- Save the moving letters as a **video** (MP4 or WebM), with the sound in it: any stretch of an audio file, or a live recording from the microphone.

Everything happens inside your web browser. Your font and audio files are never uploaded anywhere.

---

## 2. What you need

- A computer with a recent web browser (Chrome, Edge, Firefox, or Safari). Phones and tablets are not supported: the tool is built for a large screen.
- Either a font file on your computer (`.ttf`, `.otf`, `.woff`, `.woff2`, or a `.ttc` / `.otc` font collection) **or** an internet connection to load a font from Google Fonts. Instead of a font you can also bring a drawing saved as `.svg`, such as an icon or a logo (see [An SVG drawing instead of a font](#an-svg-drawing-instead-of-a-font)).
- Optional, for the **Sound** tab: an audio file (such as an MP3) or a microphone.
- The app's web address — for example `https://m1ingx1xx1.github.io/None-Curve/` — or ask whoever set up the project for it.

---

## 3. A tour of the screen

The screen is split into two columns and five areas:

```text
┌────────────────────────╥─────────────────────────────────────────────────────┐
│ ① Tools                ║ ② Result canvas                                     │
│   Import               ║   your text, rebuilt live                           │
│   Font information     ║                                                     │
│   Shaping controls     ║                                                     │
╞════════════════════════╣                                                     │
│ ③ Typography,          ╠══════════════════════════╦══════════════════════════╡
│   Glyphs & Color tabs  ║ ④ Text input             ║ ⑤ Preview                │
│   (fold down to        ║   type here              ║   small copy of ②,       │
│   their tabs)          ║                          ║   with Blur & Invert     │
└────────────────────────╨──────────────────────────╨──────────────────────────┘
```

1. **Tools (top left)** — the **Import** button, information about the loaded font, and three tabs: **Geometry** and **Experimental** hold the controls that shape the letters, and **Sound** listens to an audio file or the microphone and can move the letters with it. Scroll to see every control; the tab names stay at the top while you scroll.
2. **Result canvas (top right)** — the big preview. It shows the canvas (a page of fixed size) with the text you typed, rebuilt with your current settings. The page that gets exported sits in the middle with a soft shadow, as if it lay slightly above the background. Around it, the background is a little darker and has a light grid, so the page itself stays clean and looks exactly like the export. The grid also appears on the page while you drag the text or when you zoom in to 200 % or more, to help you line things up. After you change a setting, the letters update in the background one after another — the app stays responsive meanwhile, and the status bar at the bottom of the window says "Updating…" until all of them are done. The **Canvas size** bar at its bottom opens the size settings.
3. **Typography, Glyphs, and Color (bottom left)** — three tabs. **Typography** sets the size, spacing, slant, alignment, and position of the text. **Glyphs** lists every letter, number, and symbol in the font: click one to type it into the text box — handy for symbols that are hard to type, like `©`, `→`, or accented letters. **Color** sets the text and background colours. The arrow at the right end of these tabs folds the area down to just its tabs, so the shaping controls above get the whole left column; click a tab or the arrow again to open it. The app remembers whether it is folded.
4. **Text input** — type the text you want to see on the canvas.
5. **Preview** — a small picture of exactly what an SVG export would save: all your text on the canvas (filled, or as outlines when **Fill** is off), with its own **Blur** slider and **Invert** button.

At the very top there is an **Export…** button. While a video is being recorded, a red light, the time recorded (for example "Recording 0:12"), and a square stop button appear beside it (see [Record a video](#record-a-video)). Undo and redo have no buttons: they work from the keyboard (see [Undo and redo](#undo-and-redo) below). Along the bottom a status line tells you what is shown and which settings are active.

**Light or dark screen.** At the far right of the status line, two small buttons — a sun and a moon — switch the app between a light and a dark look. The app always opens in the same look as your computer (its light or dark mode); your choice lasts until you close the page and is not remembered. The canvas is not affected: its colours come from the **Color** tab.

**Starting over in one click.** Just left of the sun and moon, a button with a turning arrow (pointing at it says **Reset all**) puts the app back to how it looks when you first open it:

- the font closes, so no letter is selected; the app also forgets it, so it does not come back the next time you open the page (a font still loading is dropped);
- the text becomes the sample text again (Lorem ipsum);
- every setting goes back to its starting value: the Geometry, Experimental, Typography, and Color tabs and the canvas size;
- the canvas view starts again: **Flattened**, with only **Fill** of the layers on, the whole canvas in view;
- in the Sound tab the mappings are removed, the seven sound knobs (**Sensitivity**, **Release**, and the four **Response** knobs) go back, **Return to plain** turns off with **Hold** at 200 ms, and **Drive letters** is on again (off if your computer is set to reduce motion); a playing sound file pauses and the microphone stops listening, but a loaded sound file stays loaded;
- the preview's **Blur** and **Invert** turn off, **Coordinate precision** goes back to 2, and the notes about a loaded config file or your last visit go away.

What stays: the light or dark look, the size of the areas, and the tabs you had open. **It cannot be undone**, and it does not ask first: afterwards there is nothing to undo or redo. If you might want your work back, export it or save a [config file](#as-a-config-file-settings-only) first. The button is greyed out when there is nothing to reset (pointing at it then says "Everything is as the editor first opens").

**Changing the size of the areas.** The double lines in the picture are the thin grey lines between the areas; you can drag them:

- between the **tools and the canvas** — drag left or right;
- between the **shaping controls and the Typography / Glyphs / Color tabs** — drag up or down to give either more height;
- between the **canvas and the text input** — drag up or down;
- between the **text input and the preview** — drag left or right.

Whatever one side gains, the other side loses, so everything always fits in the window exactly — the page never needs scrolling. Each area keeps a minimum size. Double-click a line to put it back where it started. The app remembers your choices the next time you open it.

### Undo and redo

Undo takes back your last change and redo puts it back again. There are no buttons for them; use the keyboard: on a Mac, ⌘Z undoes and ⇧⌘Z redoes; on Windows and Linux, Ctrl+Z undoes and Ctrl+Shift+Z or Ctrl+Y redoes. The app keeps up to 100 steps.

- **What can be undone:** every setting in the Geometry, Experimental, Typography, and Color tabs, the canvas size, the text, and in the Sound tab the mappings and the seven sound knobs (Sensitivity, Release, Strength, Motion contrast, Pitch reactive, Melody tracking, and Glide). The reset buttons of the groups count too, so undo brings back what a reset (including **Reset sound**) cleared. **Reset all** is the exception: it cannot be undone (see *Starting over in one click* in [A tour of the screen](#3-a-tour-of-the-screen)).
- **How big one step is:** one drag of a slider is one step, however far you move it. Typing is one step until you pause for a moment. **Clear**, picking a sample text, and inserting a character from **Glyphs** are a step each. Some actions that change several things at once are a single step as well: loading a Sound preset, **Freeze**, loading a config file, and picking a mapping target together with the settings it switched on.
- **What is not undone:** the canvas view (Original / Flattened / Compare, the layer buttons, zoom, and moving around), which letter is selected, the preview's Blur and Invert, the export settings, loading a font, the Sound tab's **Drive letters** and source, and the video options (**Format**, **Length**, **Frame rate**, **Include audio**, and **Use the preview look**). Sound moving the letters is never recorded either: only your own changes are.
- **Inside a typing box** — the text box, or a box you type a number, colour code, or name into — the shortcuts undo your typing in that box only, as in any text field. To undo whole steps instead, first click outside the box (on an empty part of a panel). While a dialog (such as **Export…**) is open, the shortcuts do nothing.
- The steps are forgotten when you close the page, so the next visit starts with nothing to undo, and when you press **Reset all**.

### Coming back later

The app keeps your work in this browser by itself, a moment after each change, and brings it back the next time you open it on the same computer in the same browser.

- **Kept:** the text; every setting in the Geometry, Experimental, Typography, and Color tabs; the canvas size; the canvas view buttons (Original / Flattened / Compare and the layers, but not the zoom or where you moved to); the preview's Blur and Invert; the export's **Coordinate precision**; the Sound tab's mappings and its seven sound knobs (Sensitivity, Release, Strength, Motion contrast, Pitch reactive, Melody tracking, and Glide); **Return to plain** and its **Hold**; the selected letter (when the same font opens again); and the font itself.
- **The font:** a Google font is downloaded again by itself when the page opens (this needs an internet connection). A font from your computer cannot be reopened for you: the canvas says "Last font: *name*. Import it again to continue." Import the same file and carry on — your settings are already in place.
- **Not kept:** the Sound tab's **Drive letters** and source (file or microphone); the video options (**Format**, **Length**, **Frame rate**, **Include audio**, and **Use the preview look**), which last until you close the page, and the video's **Time range**; open dialogs; the light or dark look; and the undo steps. (As before, the app also remembers the size of the areas, the tabs you had open, whether the **Canvas size** settings are open, and **Show all explanations**.)
- **Work saved by an older version of the app:** Thorn's **Reach** used to be a share of the em (the letters' design square) and is now a share of the canvas (see Thorn in the Experimental tab). Older saved work is converted to the share that gives the thorns the same length with the text size and canvas size it was saved with, so they come back as they were. Thorns that were on stay on: however short they were, they come back at least as long as the slider's first step. Sound rows on Reach keep their **Depth**. Thorns may also grow from other points than they did before with the same **Seed**, because the app now picks them in a steadier way (see Thorn in the Experimental tab); press **Next variant** until you like them again. Crumple no longer has a **Detail** slider: a saved Detail value is ignored, Sound rows on **Crumple · Detail** are dropped, and Crumple folds the letters as Noise did before it was renamed, so the same **Seed** gives different folds than in the version that had Detail.
- **If the page closed while drawing your settings** — for example because a very heavy setting made the browser give up — the next visit opens with every setting back at its starting value, so it cannot get stuck again, and the canvas says "The last visit closed while drawing, so its settings were not restored." Your text, font, mappings, and **Response** sliders still come back.
- **If the browser cannot keep anything:** when this browser's storage for the site is full or blocked (some private windows block it), the status line shows "Settings not saved". The app keeps working, but nothing listed above comes back next time. Free some space, or allow this site to store data, to have your work kept again.
- **Starting over:** most groups have a reset button (**Reset anchors**, **Reset grid & angles**, **Reset distortion**, **Reset random anchors**, **Reset experimental**, **Reset typography**; **Reset experimental** clears its tab to the lowest settings instead of the starting ones), and **Charcoal** in the Color tab is the starting colour pair. The arrow button at the right end of the status line (**Reset all**) closes the font and puts the text and every setting back to how the app first opens; it cannot be undone (see *Starting over in one click* in [A tour of the screen](#3-a-tour-of-the-screen)). To also forget the area sizes and open tabs, clear this site's data (cookies and site data) in your browser's settings and reload the page.
- **Good to know:** each browser keeps its own copy. If the app is open in two tabs, the one you changed last wins. Safari may clear the saved work of a site you have not opened for 7 days. To keep a result for sure, export it; to keep the settings themselves, or take them to another browser, save a [config file](#as-a-config-file-settings-only).

---

## 4. Quick start (five minutes)

1. Click **Import** (top left) → **Google Fonts** → choose **Inter** → **Load font**.
2. In the text input, type a word, for example `Hello`.
3. In the tools area, find **Curve flattening**, choose **Fixed segments**, and set **Segments per curve** to `2`.
4. Turn on **Merge joined curves**. The letters become clearly faceted.
5. Click **Export…** at the top → **SVG — main view** → **Download SVG**.

That's the whole workflow. The rest of this guide explains each step in more detail.

---

## 5. Loading a font

Click **Import** at the top of the tools area. You get three choices: a font from your computer, a font from Google Fonts, or a **Config file** with saved settings (see [As a config file](#as-a-config-file-settings-only)).

### From your computer

- Choose **Local file** and pick a font file, **or** simply drag a font file onto the big canvas.
- Supported: `.ttf`, `.otf`, `.woff`, `.woff2`, and font "collections" (`.ttc`, `.otc`), up to 50 MB.
- **Font collections** hold several styles in one file — on a Mac, for example, Helvetica Neue, Avenir Next, and Futura. The app opens the style closest to Regular, and the style name in the font information becomes a menu of all the styles in the file: pick another one there. Switching styles this way keeps your text, the selected letter (if the new style has it), and the zoom. A few hidden styles that macOS keeps for itself (their names start with a dot) are not listed. Collections packed as `.woff` or `.woff2` cannot be opened.
- Loading any other font starts the canvas view afresh: it zooms to fit and selects a default letter.
- The file stays on your computer; it is only read by your browser. The next time you open the app, it names the file and asks you to import it again (see [Coming back later](#coming-back-later)).

### An SVG drawing instead of a font

A drawing is made of outlines and anchor points just like a letter, so None-Curve can rebuild it the same way.

- Choose **Local file** and pick an `.svg` file, **or** drag it onto the canvas. Icons and logos work best.
- The drawing appears on its own on the canvas, as if it were a single letter. Every control works on it: curve flattening, squaring, anchors, grid, distortion, the **Experimental** effects, and **Sound**.
- The text box turns grey while a drawing is open, because there is nothing to type with. Your text is kept: it comes back as soon as you load a font again.
- Colours in the file are ignored: every filled shape becomes part of the drawing, in the text colour from the **Color** tab. Holes (the middle of an "O"-like shape) stay holes.
- **Export** offers SVG, PNG, video, and the config file. A font file cannot be made from a drawing, so that choice is hidden.
- **Lines with no fill do not count.** Many line icons (Feather, Lucide, and similar) are drawn only with strokes. Turn the strokes into shapes first in your design app — Illustrator: *Object → Path → Outline Stroke*; Inkscape: *Path → Stroke to Path*; Figma: *Outline stroke* — then import the file again. Text inside an SVG must be converted to outlines the same way.
- Very large files (over 10 MB, or extremely detailed drawings) are refused with a message saying so: simplify the drawing first.

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
| SVG could not be used | The SVG drawing is damaged, too large, or has only lines or text and no filled shapes. The message says which. | Follow the message: convert strokes or text to outlines, or simplify the drawing. |
| Google Fonts API error | Google does not know that name. | Check the spelling and capital letters. |
| Network / CORS error | No internet, or a browser extension blocked the request. | Check your connection or ad blocker, then **Retry**. |
| Only fonts.google.com … URLs are accepted | The pasted link is not a Google Fonts link. | Paste a link from fonts.google.com. |

If a new font fails to load, the previous font stays on screen.

---

## 6. Typing text

- Type in the **Text** box (bottom right). Press Enter for a new line.
- The sample menu next to **Clear** offers ready-made texts: **Lorem ipsum** (placeholder text), **Pangrams** (sentences that use every letter), **Spacing** (classic test words such as "Hamburgefontsiv"), and **Alphabet** (all capitals, lowercase letters, digits, and common punctuation, one group per line). The first time you open the app it shows Lorem ipsum; after that, it opens with the text you had last time. Once you change the text, the menu shows the last sample with "(edited)"; pick it again to get the original back.
- **Clear** empties the box. Changed your mind? Undo (⌘Z on a Mac, Ctrl+Z elsewhere) brings the text back.
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

- **Fill** — solid letters. Turn it off to see only the outlines. This also changes what you export: with Fill off, the preview, the SVG, the PNG, and the video show the letters as thin outlines with nothing inside. A font file always has solid letters.
- **Skeleton** — the points that define the original curves: blue squares sit on the curve, hollow orange circles are the "control points" that pull the curve, and thin lines connect them.
- **Vertices** — green dots at every corner of the new straight-line shape.
- **Metrics** — horizontal guide lines: ascender (top of tall letters like "h"), cap height (top of capitals), x-height (top of "x"), baseline (where letters sit), and descender (bottom of "p" and "g").

> Skeleton points and vertices appear only when letters are large enough to read them. If the canvas says "Zoom in to see skeleton points and vertices", zoom in.

**Zoom** — `−` and `+` zoom out and in, **Fit** shows all the text again. You can also scroll the mouse wheel over the canvas to zoom, and drag to move around.

### Looking at one letter

- Click a letter on the canvas to select it (clicking anywhere in the letter's own space is enough). It changes colour wherever it appears. The colour is worked out from your text and background colours so that it stands out and is still easy to read — for black text on cream paper it is a vermilion red. Pointing at a letter colours it the same way. Inserting a character from the Glyphs list selects it too.
- Thorns (see Thorn in the Experimental tab) are not part of a letter's space: clicking a thorn where it reaches out of its letter is the same as clicking whatever lies behind it, such as another letter or, most often, the empty canvas. Click the letter itself. While Thorn is on, a letter is clicked by its own space and its original shape from the font, so other parts that effects drew far out of it, such as Slipstream's trails, do not select it either.
- **With the keyboard:** click the canvas (or reach it with Tab), then hold Shift and press the right or left arrow key to select the next or previous letter of your text. Spaces, letters missing from the font, and other copies of the letter already selected are skipped. If nothing is selected, Enter selects the first letter. A screen reader says which letter is selected. The arrow keys without Shift still move the canvas around.
- Click an empty part of the canvas, or press Escape, to remove the highlight. Dragging the canvas around does not remove it.
- The numbers in the shaping controls (vertices, curves, and so on) describe the selected letter — or, after you removed the highlight, the letter you selected last. The **Statistics** line at the top of each tab always says which letter that is, for example "Statistics: l U+006C".
- The preview never shows the highlight, because it shows exactly what will be exported.
- To look closely, zoom in on the canvas.

### The preview: Blur, Invert, and width

The **Preview** (bottom right) shows the whole canvas exactly as an SVG export would save it — anything outside the canvas is cut off.

- It always shows the finished letters and nothing else: solid, or as outlines when **Fill** is off, just as they will be exported. Apart from Fill, it does not follow the big canvas's Original / Flattened / Compare and layer buttons, its zoom, the snap grid, or the dashed boxes for missing characters: those only help you on the big canvas and are never exported.
- Its outlines are rounded the same way as the SVG file (see **Coordinate precision** in [Saving your work](#10-saving-your-work-export)), so what you see here is what you get.
- With **Transparent background** (Color tab) on, the empty background shows as a checkerboard.
- If saving the text as an SVG would fail, the preview says "Export would fail: …" with the reason instead. While the sound moves the letters this is not checked, since exports use your sliders and not the moving letters; it is checked again once the sound stops.
- While the Sound tab moves the letters, the preview moves with them. SVG, PNG, and font exports still use your sliders (see **Freeze**); a video records the moving letters (see [Record a video](#record-a-video)).

- **Blur** softens the preview, as if you looked at the text from far away or squinted. This shows the overall shape and rhythm of the letters without the details — a quick way to check whether a rough or faceted style still reads well.
- **Invert** swaps the text and background colours in the preview — dark letters on light become light on dark, and back. Useful to check how the text works both ways, for example for a sign or a dark poster.
- Blur and Invert only change this small view. To save them in a file, tick **Export the preview look** when exporting.
- **Making the preview wider:** drag the thin line on its left (see "Changing the size of the areas" in section 3).

### Canvas size

The text sits on a **canvas** of a fixed size in pixels, like a page or an artboard. Click the **Canvas size** bar under the big canvas to open or close its settings:

- **W** and **H** — the width and height in pixels, from 100 to 10000. Drag the slider or type a number (it takes effect when you press Enter or click elsewhere).
- **1:1, 4:3, 16:9, 4:5, 3:2, 3:4** — common picture shapes. The width stays and the height follows. **Swap** turns a landscape canvas into a portrait one and back.
- **1×, 2×, 3×, 4×** — how many times larger a PNG export is. The layout stays the same; a higher number just gives a sharper, larger image (shown underneath, for example 2400 × 1600 px). A browser cannot draw an image of any size, so a very large one (longer than 16,384 pixels on a side, as with a 10000-pixel canvas at 2×) is made smaller to fit, keeping its shape; the line underneath then says “scaled down to what a browser can draw”. A video uses the same size, unless that is larger than 4K (see [Record a video](#record-a-video)).

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

Next to the **Geometry** tab at the top of the tools panel. The effects here work on the finished result of the Geometry tab, and you can turn on as many as you like at once. **Crumple**, **Ripple**, **Whorl**, and **Slipstream** bend the letters along **straight creases**: they add corners but never curves. Up to 100 %, no combination of them can make a letter cross itself or push the hole of an **A**, **B**, or **e** out of the letter. A few parts are drawn onto the letters instead, also with straight lines only: **Slipstream**'s cuts and trails, and **Thorn**'s thorns, which may cross the letter (see below). The effects always run in the same order: **Crumple**, then **Ripple**, then **Whorl**, then **Slipstream**, then **Thorn**, then **Dissolve**. (Earlier versions called them Noise, Ripple, Curl, Wind, and Spikes.)

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
- **Facet size** — the size of the folds, as a share of the em (the font's design square). Small facets give many small folds; large facets give a few big ones that can bend whole strokes. Below 8 % the folds stop getting smaller and get gentler instead, so they still read as corners; at 0 % the letter is left as it is.
- **Turn** — which way the folds go. Raising **Amount** pushes every fold further the same way; Turn points them another way while the creases stay where they are. At 180° the letters are crumpled the opposite way. (**Next variant** under Seed instead gives a completely new sheet of paper.)
- The numbers show how far the outline moved at most (**Max move**) and how many corners the folds added (**Creases**).

**Ripple — polygonal waves**

- **Use ripple** — turns it on.
- **Amount** — how far the waves push the outline in and out. Around 50 % the letters stay readable; 100 % squeezes strokes between the rings into thin slivers and tears the letters into sharp, broken shapes; above that, up to 400 %, the rings pass through each other and the letters fold into spiky, star-like shapes.
- **Reverse** — swaps out and in: the rings that were pushed out are pulled in, and the other way round. With **Petals**, the petal tips move from the corners to the middle of each side, and the corners are pulled in instead. Off to start with.
- **Wavelength** — the distance from one wave to the next, as a share of the em (up to 200 %). Short waves give many fine zigzags; long waves bend whole strokes or swell the whole letter. Below 8 % the waves stop getting shorter and get gentler instead; at 0 % there are no waves, and only **Petals** still shapes the letter.
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
- **Gust size** — the width of the slices, and of the bands the gusts pull, as a share of the em. With a level stream (0° or 180°) every letter on a line shares the same bands, so the steps and streaks run straight through the text. Below 6 % the bands stop getting narrower and **Gustiness** and **Slip** fade instead; at 0 % the stream blows steadily, with no gusts and no slip.
- **Gustiness** — how different the bands are when the letters are pulled out. At 0 % every band is pulled equally and the letters are simply stretched; at 100 % some bands barely move while others are dragged far, leaving ragged, straight-edged streaks; above 100 % (up to 200 %) some gusts blow backwards, tearing the letters apart.
- **Cuts** — how many thin, wedge-shaped slits are cut into each letter along the stream (2 to start with, up to 8). Each one is widest where it enters and narrows to a sharp point inside a stroke; about one in four goes right through the letter.
- **Trails** — how many thin streaks trail off each letter downstream (2 to start with, up to 8). They grow out of the letter's outer edge on the side away from the stream, and a higher **Strength** makes them longer. A trail never runs into the letter or into another trail, so where there is no room a letter gets fewer.
- The numbers show how far the outline moved at most and how many corners were added, and, while there are cuts or trails, how many the selected letter got (**Cuts**, **Trails**).

**Thorn — thorns that shoot out**

A few points (anchors) on the outside of each letter jump straight out into the canvas as long, straight thorns and pull the letter along with them: strokes lean and get thinner, and holes bend towards the thorn. Only the outer outline of a letter grows thorns: the holes of letters like **o**, **e**, and **B** never do (though they may bend). Thorn runs after the bending effects, on the letters as they left them, but it chooses its points on the letter as it was before them and before **Distortion** (see **Thorns stay put** below).

- **Use thorn** — turns it on.
- **Burst** — makes the letters explode instead (off to start with). No points jump; instead many short, straight spikes grow all round each letter, also into its holes (those stay inside the hole), and the outline between the spikes is eaten into the strokes in a few straight cuts, so the letters look thin and broken. With Burst on, **Anchors** counts the spikes, **Dent** sets how deep the cuts go, and **Root** is greyed out.
- **Anchors** — how many points of each letter jump, from 0 to 12 (3 to start with). With **Burst** on, it is how many spikes each letter grows instead, from 0 to 80 (40 to start with), spread evenly round the letter; the two numbers are kept apart, so turning Burst off and on again keeps both. At 0 nothing grows and Thorn leaves the letter as it is.
- **Reach** — how far they jump, as a share of the canvas (10 % to start with; the box reads, for example, "10" followed by "% canvas"). 100 % is the canvas's diagonal, from one corner to the opposite one, so at 100 % a thorn can cross the whole canvas. Each point goes its own distance, somewhere between about a third of Reach and all of it, so the thorns come out in different lengths. At 0 % nothing jumps.
  - The slider is fine at the left and coarse at the right, so short thorns are easy to set exactly: the middle of the track is only 12.5 %, and the right half covers the rest up to 100 %. At the far left, each step (or each press of an arrow key) adds 0.01 %, so even the first step grows tiny thorns; only 0 grows none. The box shows the reach to two decimals, and you can type an exact one there, for example 0.35.
  - Because Reach is measured on the canvas, the thorns keep the same share of the canvas when you change the text **Size** or the canvas size (**W** and **H**): with smaller text or a larger canvas they reach further past the letters. While Thorn is on, such a change makes the app work the letters out again. The PNG multiplier (1×–4×) changes nothing.
  - The **ⓘ** next to Reach says how many ems 100 % is at your current text size and canvas: about 30 em on the starting canvas (1200 × 800 pixels with 48-pixel text). It never goes beyond 256 em, however small the text.
  - Only the tips get longer: **Root**, **Width**, and **Flute width** are still measured on the letters, so they do not change with the canvas.
  - The status line at the bottom and the export dialog show it with its length in ems, for example "reach 10% canvas (about 3.0 em)".
  - With **Burst** on, Reach sets how long the spikes are: the longest is about a third (30 %) of the Reach length, and most are much shorter. At the start (10 % on the starting canvas) the longest is about 0.9 em.
- **Reverse** — the thorns shoot into the letter instead of out of it, from the same points and at the same angles, and keep going for their whole length. Where a thorn runs through a stroke, it cuts a thin white slit; where it crosses a hole or comes out on the far side of the letter, it shows as an ink spike. Off to start with. With **Burst** on, the spikes point into the letter instead, and the outline between them bulges out rather than being eaten in.
- **Dent** — with **Burst** on: how deep the outline between the spikes is eaten into the strokes (80 % to start with). At 100 % the deepest cuts go a little over halfway through a stroke; at 0 % the outline between the spikes stays as it was. It is greyed out while Burst is off.
- **Root** — how much of the letter around each point the thorn pulls along (50 % to start with). The thorn grows out of a wide base that narrows to a sharp tip, and the strokes and holes nearby lean and bend towards it. At 0 % the thorns are simply stuck on, and the letter around them stays as it was. Not used with **Burst** on.
- **Spread** — which way they jump (50 % to start with). At 0 % every point jumps straight out, at right angles to the outline; the higher the Spread, the further each one may lean to either side, up to 90° at 100 %, so the thorns fan out in all directions.
- **Width** — how wide each thorn's tip is where it leaves its base (30 % to start with). At 0 % it is a thin needle; at 100 % the tip is as wide as the base where it starts to narrow.
- **Refraction** — shows the letters as if through ribbed (fluted) glass (0 %, off, to start with). The letters are cut into upright strips, each magnified a little and moved up or down, so strokes and thorns look broken and shifted. The glass covers only the width of the letter itself, plus one strip on either side: where a thorn reaches out to the left or right beyond it, that part of the thorn stays sharp and straight. A thorn that points up or down stays behind the glass along its whole length.
- **Flute width** — how wide each strip of the glass is, as a share of the em (10 % to start with). It is greyed out while **Refraction** is 0 %. Below 4 % the strips stop getting narrower and the glass gets weaker instead; at 0 % there is no glass.
- The numbers show how many points jumped (**Thorns**), how many of them pulled the letter along (**Roots**), and how far the longest one went, in font units (**Longest**). With **Burst** on, they show how many spikes grew (**Spikes**) and the longest one, without Roots.
- **The seed decides where.** Which points jump, which way they lean, how far each goes, and how the glass strips move are picked by the tab's **Seed** (below): the same seed always gives the same thorns, and **Next variant** makes them jump somewhere else. When the Sound tab drives the Seed (for example **Beat** → **Seed**, or the **Flare** preset), they jump somewhere new with the beat, a few letters at a time (see **Thorns take turns** in the Sound tab).
- **Thorns stay put when other settings move.** Thorn picks its points, and which way each thorn points, on the letter as the Geometry tab shapes it before **Distortion**, then follows each point as Distortion and the other effects on this tab bend the letter. So when you move a **Distortion** slider or the **Amount** of **Crumple** or **Ripple** a little, or try another Distortion seed, nearly every thorn stays on its point and keeps pointing the same way while the letter bends around it. The other sliders of Crumple and Ripple, and those of **Whorl** and **Slipstream**, change how these effects bend the letter, so they can still move or turn the thorns. The tab's **Seed** picks new points; so can a change to a Geometry setting before Distortion (such as **Curve flattening**, **Squaring**, Anchor spacing, or **Grid & angles**), which changes the points themselves. Thorn's own **Anchors** slider only adds or removes thorns and leaves the others where they are. Because of this, the same seed gives different thorns than in older versions of the app.
- **Thorns may cross.** A thorn can cut across its own letter or another thorn. There the shapes are merged into one clean outline, as with folds above, so the font still exports. Every thorn is made of straight lines only.
- **Thorns do not move the text.** Where the text sits (**Position** and **Free** in the Typography tab), **Fit text**, and the red note about text running past the canvas edge all go by the letters without their thorns, just as if Thorn were off, also with **Slant**. So thorns may run out of the canvas: on the big canvas they carry on into the darker area around it, and the preview and SVG and PNG exports cut them off at the canvas edge. To select a letter, or drag the text with **Free**, click or drag the letter itself, not a thorn.
- **Very long thorns in a font file.** A font file stores each letter within a square of limited size (16 em across in a font with 2048 units per em, 32.8 em in one with 1000; see [As a font (OTF)](#as-a-font-otf)). Thorn tips that reach further are cut off at its edge in the exported font; the canvas, SVG, and PNG are not affected.
- **Try it:** tick **Use thorn**, set **Anchors** to 1 and **Reach** to 20 %, then press **Next variant** under Seed a few times: each time, one point of every letter shoots out somewhere else and drags the letter with it. Then raise **Refraction** to see the letters through fluted glass.

**Dissolve — letters like worn photocopied ink**

Rebuilds each letter as ink that has been photocopied too often: the strokes stay dense but break into islands and rings of ink with holes in them, the edges go ragged, and loose specks lie just outside. Every island, ring, hole, and speck is a polygon of a few long, straight edges with sharp corners, so even zoomed in nothing looks round. Dissolve runs last, after all the other effects, on the letters exactly as they left them (thorns included).

- **Use dissolve** — turns it on.
- **Amount** — how much ink is eaten away (50 % to start with). At 0 % the letter stays nearly solid with a ragged edge; at 100 % only thin squiggles and rings are left.
- **Grain** — how big the islands and rings are, as a share of the stroke width (40 % to start with, from 15 % to 100 %). Small grain gives fine, busy ink; large grain gives a few coarse blobs.
- **Spread** — how far the ragged edge reaches past the original outline, in half-strokes (80 % to start with, up to 150 %). At 100 % it reaches half a stroke out.
- **Specks** — how many loose specks lie just outside the strokes (40 % to start with). At 0 % there are none.
- **Curl** — the shape of the ink (60 % to start with). At 0 % it clumps into plain blobs; towards 100 % it wanders into loops and rings.
- **Facets** — how long the straight edges are (30 % to start with). At 0 % the edges are short but still meet at clear corners; at 100 % they are long and the ink looks like chunky shards, and small rings close up.
- The numbers show how many pieces of ink the selected letter has (**Islands**), how many holes they have (**Holes**), and how long a facet is, in font units (**Facet**).
- **The seed decides the pattern.** The tab's **Seed** (below) picks where the ink breaks: the same seed always gives the same ink, and **Next variant** gives another pattern.
- **Heavy settings.** A very fine Grain with long thorns or all effects at their maximum can make too many corners. Then the letter is dissolved more coarsely, and you may see a yellow note: "This glyph is too large for the grain: it is dissolved more coarsely." or "Longer facets on this glyph: these settings make too many vertices." Raise **Grain** or **Facets**, or lower other effects, to bring the detail back.
- **Try it:** tick **Use dissolve**, then raise **Amount** to 80 % and **Curl** to 100 % for ink that has almost worn away, or lower **Grain** to 20 % for fine, dusty speckles. Press **Next variant** under Seed to see another pattern.

**Seed** — one number for all the effects on this tab: it picks Crumple's folds; Slipstream's gusts, slips, cuts, and trails; which points Thorn moves and how its glass strips shift; and where Dissolve breaks the ink (Ripple and Whorl have no randomness). The same seed and settings always give the same letters; **Next variant** tries the next one. **Reset experimental** clears the whole tab: it turns every effect off, turns off every switch (**Reverse**, **Burst**, **Pin top and bottom**), and sets every slider to 0, angles included. Ripple's **Center** goes to the middle of the letter instead, and the few sliders where 0 would not mean "nothing" go to their smallest setting: **Sides** 3, **Rings** 2, and Dissolve's **Grain** 15 %. Your seed stays, and **Undo** brings the settings back. The button is greyed out while everything is already cleared.

Every copy of a letter gets the same folds, cuts, trails, thorns, and ink, so an exported font looks exactly like the canvas, apart from very long thorns, which a font file cuts short (see Thorn above).

### Sound tab — letters that move with the sound

The third tab, next to **Experimental**. It plays an audio file or listens to the microphone and measures the sound as it goes: how loud it is, how much bass, middle, and treble it has, how bright it sounds, which note is playing, where the beats fall and how busy the sound is, and where the sound sits between left and right. It can also move the letters with the sound: you connect a reading, such as loudness, to a slider, such as Distortion's **Noise amplitude**, and while the music plays the letters roughen when it gets loud and calm down when it gets quiet. You can also connect a reading to a **seed**, so that the points of the letters jump to new places on every beat (see **Modulation** and **Seeds** below). The **Response** knobs set how strongly the letters answer, and **Record** saves the moving letters as a video (see [Record a video](#record-a-video)).

The sound only ever moves sliders and seeds, and only within their own range, so every letter you see is one you could also make by hand with the sliders and seed boxes — built from straight lines, like everything else in the app. (With **Motion contrast** or **Pitch reactive**, letters can react by different amounts at the same moment, and with Thorn on, the letters' thorns take turns, so two letters may sit at different slider values; each one is still a shape the sliders can make.)

Your audio stays in your browser: a file is read on your computer and never uploaded, and the microphone is only used while you listen.

The tab is laid out like the front panel of a synthesizer, in five boxes from top to bottom: **Transport** (the sound, **Drive letters**, presets, and **Freeze**), **Input** (how the sound is measured, and its meters), **Response** (how strongly the letters answer), **Modulation** (which reading moves which slider), and **Record**.

**Knobs.** Most of the tab's settings are knobs. A ring of short lines around each knob lights up to its value, and the number under it shows the value. A knob that goes both ways, such as **Sensitivity** or a row's **Depth**, lights up from the top: green above 0, orange below 0 (Sensitivity stays green).

- **Turn it:** press on the knob and drag up (more) or down (less). Hold Shift while you drag for fine steps.
- **With the keyboard:** click the knob (or reach it with Tab), then use the arrow keys for one step, Page Up and Page Down for a tenth of the way, and Home and End for the two ends.
- **Type a number:** click the number under the knob, or press Enter while the knob is selected. Type the value and press Enter (or click elsewhere) to set it; Escape keeps the old value.
- **Back to the start:** double-click the knob. A row's **Depth** or **Rate** goes back to +50 %, where **Add mapping** puts it.
- A drag counts as one change, so one undo puts back where it started, as with a slider.

**Transport** — where the sound comes from, at the top of the tab. Its first line has **File** / **Microphone** and the **Drive letters** switch (see **Modulation** below); the line under the sound has **Preset** and **Load** (see **Presets** below), then **Freeze** and **Live · N fps** (see **While the sound moves the letters** below).

**Return to plain** — the large switch on its own strip under the first line of **Transport**, with **Hold** at its right end. Click the switch or its name to turn it on or off.
- **Off:** the sound moves the letters as described below, from the look you set in the other tabs.
- **On:** the letters rest on their plain shapes: the look of the Geometry tab, with every effect of the Experimental tab off. On each beat, the effects you switched on in the Experimental tab come back all at once, then the letters return to plain. So the plain letters are the ground and every beat flashes your design onto them, in time with the music. It works even with no mapping at all; your mappings still act on top while the design shows.
- **Hold** (the small knob beside it, 0–3000 ms, 200 ms to start): how long each beat shows the effects before the letters return. Anything below 80 ms, 0 included, shows them for the shortest flash, 80 ms. **Glide** (under **Response**) smooths the way there and back: the effects grow in and fade out through real in-between shapes instead of snapping on and off.
- Every letter changes together, Thorn's included. Very fast beats can be merged so the screen never flickers more than three times a second (see **No flashing** below).
- The strip lights up while it is on. **Reset sound** leaves it alone; **Start over** turns it off. **Freeze** writes what is on screen, so between beats it writes the effects as off.

- **File** — an audio file from your computer. This is where the tab starts.
  - **Choose file** — pick the file. Most common formats work (MP3, WAV, AAC, OGG, or FLAC, depending on your browser), up to 512 MB. Once a file is chosen, the button shrinks to its arrow icon (pointing at it says "Choose file"), and the file's name appears beside it; a long name is cut short, and pointing at it shows it in full.
  - **Play** / **Pause** — the triangle button at the left plays the file through your speakers or headphones; while it plays, it shows two bars and pauses it. **Play** and **Position** stay greyed out until you have chosen a file.
  - **Loop** — starts the file again from the beginning when it ends. It is on at the start.
  - **Position** — the long slider under the file: drag it to jump to another part of the file. The time beside the file's name shows where you are and the total length, for example "0:42 / 3:15".
  - **Smooth playback** — after you choose a file, the app works through the whole file in the background: first it works out how the letters should move, then it prepares their shapes, starting where the playhead is and reaching about 30 seconds ahead and 10 seconds back. This happens on its own and needs nothing from you, even while the file is paused, so the first play is smooth once the shapes around where you start are ready. A thin bar under **Position** shows how far it has got, like the loaded part of an online video: the light shade is where the moves are worked out, the dark shade is where the shapes are ready. Jumping back a few seconds stays smooth, and the shapes near a spot you left are kept for a while. When you change a setting, the app prepares the file again: changing a colour or typography mapping keeps all or most of the dark shade, while changing a shape setting (Geometry, an effect, or a mapping that moves one) clears it and fills it in again. While you drag a slider, and while the page is in the background, the preparing pauses. Where the shapes are not ready yet, the letters follow the sound directly for a moment. On a very heavy canvas (hundreds of letters with many effects) the computer may not get the shapes ready in time; the app then follows the sound directly and tries again a little later, so playback is never slower than without it. Files longer than 6 minutes, and the microphone, are always followed directly and show no bar.
- **Microphone** — the sound around you, for example music playing in the room, your voice, or clapping.
  - Choosing **Microphone** pauses the file and shows the **Start listening** button; the microphone turns on only when you click it. The first time, your browser asks whether this page may use the microphone: click **Allow**.
  - **Stop listening** turns the microphone off; **Start listening** turns it on again.
  - While it listens, **Listening** shows next to the button, and **Microphone on** shows in the status line at the bottom, so you can see it from every tab.
  - If the microphone stops by itself (it was unplugged, or the browser's permission was taken away), listening ends, the tab says **The microphone stopped.** and the status line says **No microphone**. The status line says the same if no microphone is found when you start listening.
  - The microphone's sound is only measured, never played back, so it cannot howl through your speakers.
  - **Stop listening**, switching back to **File**, and closing the page all turn the microphone off.
- There is no "off" choice: to stop, press **Pause** (for a file) or **Stop listening** (for the microphone). Switching back to **File** keeps the file you chose, paused.
- If a file plays or the microphone listens but nothing is heard for 3 seconds, the tab says **No sound detected.** Check the volume and that the microphone is not muted, or raise **Sensitivity** (below).

**Input** — how the sound is measured, and what it is like right now. On the left are the **Sensitivity** and **Release** knobs (see **Sound settings** below). On the right are 11 small meters, one for each reading, like the lights of a mixing desk: a column of lights that fills from the bottom, green with the top lights orange. Under each one is a short name: **LVL** Level, **SWL** Swell, **BASS**, **MIDS**, **TREB** Treble, **BRT** Brightness, **PTCH** Pitch, **MEL** Melody, **BEAT**, **ACT** Activity, and **PAN**. Under the meters, a line shows one reading's name and number: Level's, or the one of the meter you point at (its short name lights up). With the keyboard, press Tab to reach the meters, then the left and right arrow keys to go from one to the next. Pointing at a meter also shows its full name. Click the **ⓘ** at the end of that line for a short explanation of every reading. While nothing plays or listens, the meters are dark and the number shows "—". Most numbers are percentages: a full meter is 100 %.

The readings come in five groups (the same groups as in a row's **Feature** list):

- **Loudness**
  - **Level** — how loud the sound is overall. The number is in decibels (dB): the meter is empty at −60 dB and full at 0 dB, the loudest a recording can be. It shows "—" when it is silent.
  - **Swell** — Level, slowed down: it takes about a third of a second to rise and a few seconds to sink, so it follows the big shape of the music — a quiet verse, a loud chorus — rather than every hit. Good for big, calm movements.
- **Bands** — **Bass**, **Mids**, **Treble**: how much bass (below 250 Hz: bass drum, bass guitar), middle (250–2000 Hz: voices and most instruments), and treble (above 2000 Hz: cymbals, hiss, "s" sounds) there is. Each one is compared with its own loudest moment of the last few seconds, so the meters adapt to the music: a full meter means "as strong as this part of the sound has recently been", not "very loud".
- **Tone**
  - **Brightness** — where the energy sits: dull, bass-heavy sound reads low; hiss and cymbals read high.
  - **Pitch** — the note being played or sung. It is made for one note at a time, such as a voice or a melody. The number is in hertz (Hz): the higher the number, the higher the note (440 Hz is the A that orchestras tune to). The meter is empty at 55 Hz (the lowest A of a bass guitar) and full at 1760 Hz, five octaves higher; each octave takes a fifth of the meter. Between notes (for example during a drum hit) it keeps the last note; in silence it drops back and shows "—".
  - **Melody** — a meter that jumps each time the tune moves to a new note and falls back as fast as **Release** (below) sets. The bigger the step to the new note and the clearer the note, the higher it jumps. Like Pitch, it is made for one note at a time, such as a voice or a melody. A held note does not count, and neither does the slide into the first note after a pause or the small wobble of a singer's voice (vibrato). The new note has to last a moment, so some notes of a very quick run can be missed, and a strong wobble can now and then count as a new note.
- **Rhythm**
  - **Beat** — a meter that jumps to full at once and falls back, as fast as **Release** (below) sets. It jumps on every new sound that starts suddenly: a drum hit, a clap, a plucked note. It listens for the bass drum separately too, so the deep "boom" of most dance and pop music makes it jump even when other sound drowns the drum out. A steady sound does not count, even a buzzy, droning bass note: Beat only jumps when the sound in some range of notes suddenly gets louder. Because of that, a bass drum much quieter than a loud bass note playing at the same time may be missed. It works the same with reduced motion turned on in your computer's settings.
  - **Activity** — how busy the sound is right now. It jumps on every sudden change — drum hits, new notes — and stays up while beats come quickly: 8 beats a second fill the meter, 4 a second fill half. On a steady sound, such as a held note, a hum, or steady hiss, it stays near 0 %.
- **Stereo** — where the sound sits between the left and right speakers. This needs a stereo source, so it is mainly for files: a microphone that records a single channel (mono) always reads "C".
  - **Pan** — the side the sound leans to: "C" when it is centred, "L 40" when it leans 40 % to the left, "R 40" when it leans 40 % to the right ("L 100": only the left speaker plays). Its meter lights up from the middle: upwards when it leans right, downwards when it leans left. It is the only reading that goes both ways.
- Very quiet sound counts as silence: the readings fall back to empty (Swell and Activity more slowly), Pan returns to the middle, and Beat does not jump, so background noise does not make it flicker.

**Modulation** — which sliders and seeds the sound moves, and how. Each mapping is one row, connecting one reading to one slider or seed.

- **Drive letters** (at the top right of **Transport**) — the main on/off switch. The sound moves the letters only while it is on **and** a file plays or the microphone listens (and a font is loaded: without one, the meters still work, but nothing moves). Switch it off to keep watching the meters while the letters stay still. If your computer is set to reduce motion, it starts off and the tab says "Off because your system asks for reduced motion."; switch it on if you want the letters to move anyway. If you turn on reduce motion while the page is open, it switches itself off. If **Strength** (under **Response**, below) is at 0 %, the letters do not move either, and a note under the switch says "Strength is 0%: the letters hold still."
- **Preset** and **Load** (in **Transport**) — set the letters up and fill in ready-made rows in one go; see **Presets** below.
- **Add mapping** — adds a row. The first one connects **Level** to **Distortion · Noise amplitude** at **+50%**, a good first try; later ones pick a target that no row uses yet — one that already has an effect, if there is one. You can have up to 8 rows; then the button is greyed out and the tab says "Up to 8 mappings."
- **Drag a meter onto a control** — the quickest way to add a row. Press on one of the 11 meters in **Input**, drag it, and let go over any control the sound can move: a slider or seed in the **Geometry** or **Experimental** tab, an effect's checkbox, a **Typography** slider, a colour in the **Color** tab, or a variable axis under the font's name. While you drag, a small label with the reading's name follows the pointer, and every control you can drop on gets a green dashed outline; the one under the pointer gets a solid outline, and the label adds its name. A colour shows two drop areas over its swatch, **Hue** and **Lightness**. At the same time a panel listing every control you can drop on opens on the right, over the canvas, sorted like the target list (Geometry, Experimental by effect, the effect switches, Typography, Color, and the font's axes): let go over a name there to map it without leaving the Sound tab. A dot after a name means this reading already moves it. To reach another tab, hold the pointer over its name for a moment (less than half a second) and it opens; near the top or bottom of a panel, the panel scrolls. Press Escape, or let go anywhere else, to cancel.
  - When you let go, a new row connects that reading to that control at **+50%** (a checkbox row starts in **Toggle**, since checkboxes only flip), and a short message under the control says what was added — and what was switched on for it, as with **Add mapping** (see **Settings switched on for you** below). You stay on the tab where you let go; the slider's live marker appears as soon as sound plays. The new row is outlined and marked **New** in the Sound tab until you use it.
  - If that reading already moves that control, nothing is added: the message says so, and the existing row is outlined instead. If that row was switched off, it is switched back on (one undo turns it off again). With 8 rows, nothing is added either, and the message says so.
  - **With the keyboard:** press Tab to reach the meters, choose one with the left and right arrow keys, then press Enter (or Space). Tab, Shift+Tab, or the arrow keys then go through every control you can map, opening its tab and outlining it; a screen reader reads each name. Press Enter to map the reading to it, or Escape to cancel; clicking anywhere also cancels. Focus then moves to that control, or back to the meter after Escape or for a variable axis (it has nothing to type in).
  - One undo (Ctrl+Z, or ⌘Z on a Mac) removes the row and whatever it switched on.
- Each row has, from left to right:
  - a small square light that switches the row on (lit) or off without deleting it; a row that is off is dimmed.
  - **Feature** — the reading that drives it: any of the 11 readings above, listed in the same five groups.
  - **Target** — what it moves (on a narrow panel the arrow between Feature and Target is left out). A long name is cut short; pointing at it shows it in full. A slider is named after its group and its label, for example "Ripple · Petals". There are also three seeds: "Distortion · Seed", "Random anchors · Seed", and just "Seed" for the Experimental tab's seed. The list has parts: **Geometry** and **Experimental**, in the same order as the tabs, then **Switches**, **Typography**, **Color**, and, with a variable font, **Variable axes** (see **More things sound can move** below).
  - **Depth** — the small knob, with its value under it. For a slider: how far it moves, from −100 % to +100 %. At +100 % the strongest sound takes the slider the whole length of its track; at +50 %, half of it. Negative values move it the other way, so louder sound turns the value down. 0 % does nothing. **Pan** goes both ways: with a positive Depth, sound on the right turns the value up and sound on the left turns it down.
  - **Rate** — for a seed, the same knob is **Rate** instead, from 0 % to 100 %: how often the seed jumps (see **Seeds** below). 0 % does nothing.
  - the arrow button at the right end, which opens the row's details underneath; click it again to close them. One row's details are open at a time. They hold the row's **shaping** (see **Shaping a row** below), **Remove**, which removes the row, and, for a seed, **Rate** with its **ⓘ**.
- **How far a slider moves:** it starts from where you left it. If a slider sits a quarter of the way along and Depth is +50 %, full sound takes it to three quarters; silence leaves it where it is. It never goes past either end of its track, and it moves in the same steps as the slider itself. Two rows on the same slider add up.
- Some sliders change faster towards one end, like **Tolerance** and Thorn's **Reach**. The sound still takes them evenly along the track, just as your hand would.
- **Settings switched on for you.** Many targets only have an effect while another setting is on: Ripple's sliders need **Use ripple**, **Grid size** needs **Snap to grid**, and so on. When you pick such a target (or **Add mapping** adds one), the app switches that setting on and says what it changed in a note under the row, for example "Turned on Ripple." or "Set Noise amplitude to 40.":
  - a Crumple, Ripple, Whorl, Slipstream, Thorn, or Dissolve slider turns its effect on; **Flute width** also sets **Refraction** to 50 % when it is 0 % (the glass strips only show with some refraction); Thorn's **Anchors** and **Root** turn **Burst** off, and its Burst anchors and **Dent** turn Burst on;
  - the Experimental **Seed** acts while Crumple, Slipstream, Thorn, or Dissolve is on (Ripple and Whorl have no randomness); when all four are off, it turns on Crumple;
  - **Grid size** turns on **Snap to grid**;
  - Distortion's **Noise frequency**, **Normal bias**, and **Seed** set **Noise amplitude** to 40 when it is 0 (at 0, Distortion is off);
  - Random anchors' **Density**, **Randomness**, and **Seed** turn on **Use random anchors**; the Seed also sets **Randomness** to 100 % when it is 0 %;
  - the Curve flattening sliders turn random anchors off (they replace flattening) and set what they need: **Tolerance** sets **Mode** to Adaptive, **Segments per curve** sets it to Fixed segments, and **Corner angle** turns on **Merge joined curves** — for example "Turned off Random anchors. Set Mode to Adaptive." (Corner angle shows little on its own; see Curve flattening.)
- Changing a row to another target, or removing it, never switches anything off again. The note stays until you change the row's target or remove the row. If you go through the **Target** list with the arrow keys, only the target you settle on switches anything on, when you press Enter or move on to another control; a pick with the mouse counts at once.
- If the setting is off again later — you switched it off yourself, or another row needed a different Mode (Tolerance needs Adaptive, Segments per curve needs Fixed segments) — a grey note under the row says why, for example "Turn on Ripple to hear this.", and an **Enable** button next to it switches the setting on again.
- **What can be driven:** every slider of the **Geometry** and **Experimental** tabs — Tolerance, Segments per curve, and Corner angle; Squaring Amount; Anchor spacing and Anchor reduction; Grid size; Noise amplitude, Noise frequency, and Normal bias; Random anchors Density and Randomness; and every slider of Crumple, Ripple, Whorl, Slipstream, and Thorn (with Burst's own Anchors and Dent) — and the three seeds: 44 in all. Choices (such as **Mode** or **Allowed directions**) cannot be driven.
- **More things sound can move:**
  - **Switches** — the effects' **Use …** checkboxes, Ripple's **Reverse**, and Thorn's **Burst** and **Reverse**. Sound flips them: with **Trigger**, each rise of the sound turns the switch the other way for a moment (as long as **Smooth**); with **Toggle**, each rise turns it the other way until the next rise. A switch row has no Depth knob (a row that is on flips its switch), no **Range**, and no **Curve**, and **Follow** is not offered. Next to a checkbox Sound is flipping, a small square shows what the letters use right now: filled for on, empty for off. Burst and Reverse only work while their effect is on; **Enable** switches it on.
  - **Typography** — **Size**, **Tracking**, **Line height**, and **Slant**, over the same ranges as their sliders. The live line shows on those sliders too.
  - **Color** — the **Hue** and **Lightness** of the text colour and of the background colour. Hue moves along the colour wheel from 0° to 360° and stops at either end (it does not wrap round: a red near 0° moved further down stays red); Lightness goes from black to white; how strong the colour is stays as you set it. A grey has no hue, so Hue does nothing on it (pick a colour first). The background's targets need a background: **Enable** turns **Transparent background** off. A small square beside the colour shows the live colour.
  - **Variable axes** — with a variable font, each of its axes (such as **Weight** or **Width**) is a target too, from the font's own value across the axis. The live value shows beside the axis in the font's details. If you load a font without that axis, the row stays and says so; it starts working again when you load a font that has it.
  - None of these change anything until you map them: without them, the letters move exactly as before.

- Mappings are kept with your other settings and come back the next time you open the app (see [Coming back later](#coming-back-later)); **Drive letters** is not kept. Adding, changing, or removing a row can be undone like any other change.

**Shaping a row** — the row's details also change *how* it answers the sound. Left as they are, the row works exactly as described above; the **ⓘ** next to **Mode** sums them up.

- **Mode** — three buttons:
  - **Follow** (the usual): the target moves along with the reading, all the time.
  - **Trigger**: each time the reading climbs past **Gate**, the target jumps by the full Depth and then slides back, in the time set by **Smooth** (a quick blink when Smooth is 0). One jump per climb: the reading has to drop a little below Gate before it can trigger again, so a sound hovering at the Gate does not trigger over and over. Even with Gate at 0, the reading has to climb past 10 % to trigger and drop under 5 % to be ready again. With **Beat**, every hit triggers.
  - **Toggle**: each climb past Gate flips the target — to its slider value plus Depth, then back to the slider value at the next climb, and so on. Smooth makes each flip glide instead of snap.
  - On a seed, Trigger and Toggle both move the seed on once per climb (Rate still applies: at 50 %, every other climb).
  - Changing a row's Mode or reading starts it afresh, as if it had just been added.
  - On a seed, only the knobs that change something are shown: in Trigger and Toggle only **Gate** (Curve and Smooth do nothing there), and with **Beat** none of Gate, Curve and Smooth, because every hit counts. With **Beat** in Trigger or Toggle, a slider row has no Gate either.
- **Gate** — a small knob, 0–95 %. A reading below it counts as silence, so quiet background noise does not move anything. Above the Gate the row starts again from nothing, so it does not jump the moment the gate opens. For Trigger and Toggle it is the line the reading has to climb past.
- **Curve** — a small knob, from **Log** through **Lin** (straight, the usual) to **Exp**. Exp keeps the target still while the sound is quiet and moves it mostly when it gets loud; Log moves it a lot even at quiet sounds. Double-click it to go back to Lin.
- **Smooth** — a small knob, 0–2000 ms. Makes this row slower and softer, on top of **Release** for every row. In Trigger it is how long the jump takes to slide back; in Toggle, how long a flip takes.
- **Range** — a track with two square handles (sliders only, not seeds): the part of the target's track this row may use. With 20–70 %, the sound moves the slider only between a fifth and seven tenths of its track. If you left the slider outside that part, the sound never drags it in; it can only move it towards that part. Two rows on one slider share one part of the track, from the lower of their two starts to the higher of their two ends: rows at 0–20 % and 80–100 % together get the whole track, and a row left at the full track cancels the other row's Range. When that happens, a note under the Range says so.
- Shaping is kept, undone, and loaded with the rest of the row; settings saved by an older version of the app simply start with every row as before. Pausing (or stopping listening, or switching off **Drive letters**) and jumping to another place in the file start every Smooth, Trigger and Toggle afresh: toggled rows go back to the slider value.
- **Try it — a flash on every loud hit:** add a row **Level → Distortion · Noise amplitude**, open its details, choose **Trigger**, set **Gate** to about 60 % and **Smooth** to about 300 ms. Now the outline roughens only on the loudest moments and calms down in between.

**Seeds** — points that jump to new places. A seed picks one random pattern (see Distortion, Random anchors, and the Experimental tab). When the sound drives a seed, each jump moves it on by one — 1234 becomes 1235 — and because every seed is a completely different pattern, every point of the outline lands somewhere new at once (after loading **Flicker**, only a few points of each letter move, a different few each time; while Thorn is on, the Experimental **Seed** and the Random anchors seed reach the letters a few at a time, see **Thorns take turns** below). After 999 999 it starts again at 0.

- **Rate** — how often the seed jumps:
  - with **Beat**, it counts hits: at 100 % the seed moves on at every hit, at 50 % at every other hit, at 25 % at every fourth;
  - with any other reading, it jumps more often the higher the reading is: up to about 5 times a second at 100 % when the meter is full, half as often when the meter is half full. For Pan, either side counts.
  - The **ⓘ** next to **Rate**, in the row's details, explains this too.
- **Never too fast:** seed jumps share one limit with the sliders the sound moves, so the letters cannot flash (see **No flashing** below). Seeds that jump at the same moment count as one jump. On its own, a seed can jump up to about 5 times a second; while driven sliders are swinging back and forth too, the seeds jump less often. With fast drums some hits are then skipped; they are not saved up for later.
- **Your seed stays in its box.** Next to a driven seed's box, a small number in the colour of the live lines shows the seed the letters use right now (the live seed). The **Seed** in the Distortion and Random anchors statistics, and the status line at the bottom, show the live seed too. When the sound stops moving the letters — you pause, the file ends, or you switch off **Drive letters** or the row's light — the letters go back to the seed in the box, and the next **Play** starts from it again. To keep a seed you like, press **Freeze**: it writes the live seed into the box.
- **Try it — anchors that jump on the beat:**
  1. Choose **File** → **Choose file**, pick a song with clear drums, and press **Play**.
  2. Click **Add mapping**.
  3. Set **Feature** to **Beat** and **Target** to **Distortion · Seed**. If **Noise amplitude** was 0, the note "Set Noise amplitude to 40." appears under the row: the outline is now rough, so there is something to move.
  4. The row's knob is now **Rate**: turn it up to 100 % (or click it and press End). The rough outline takes a new shape on every beat. For calmer jumps, lower the Rate.

**Presets** — ready-made starting points, the quickest way to start:

1. Choose **File** → **Choose file** and pick a song (or choose **Microphone**).
2. In **Transport**, pick a preset in the **Preset** list. Picking only selects it: nothing changes yet.
3. Press **Load**.
4. Press **Play** (or **Start listening**).

- **Load starts the letters afresh.** It first puts every setting in the **Geometry** and **Experimental** tabs back to its starting value — your three seeds are kept — then sets the few sliders the preset starts from, and replaces your rows with the preset's. So a preset always looks the same, whatever you had set before. Your text, typography, colours, canvas, the sound source, and the seven sound knobs (**Sensitivity**, **Release**, and the four **Response** knobs) are not touched.
- **A note under Preset says what Load did,** for example "Loaded Bloom. Turned off Crumple. Other Geometry and Experimental settings back to defaults (seeds kept)." It names the effects it switched off, so you know what went. The note goes away when you load again or pick another preset.
- Load does not ask first, but it is a single undo step: undo (⌘Z on a Mac, Ctrl+Z elsewhere) right after it to get your earlier settings and rows back. The note under **Preset** then goes away. Picking a target yourself, as described above, never puts anything back to its default: it only switches on what that target needs.
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
  - **Which settings take turns** while Thorn is on: Thorn's sliders except **Reach**, the Experimental **Seed** (so Crumple's folds and Slipstream's gusts also change a few letters at a time), every Geometry setting that comes before Distortion (Curve flattening, Squaring, Anchors, Grid & angles, and Random anchors), and the sliders of Crumple, Ripple, Whorl, and Slipstream, except the two below.
  - **Which stay smooth** and change every letter together: Distortion's sliders and its seed, the **Amount** of Crumple and of Ripple, Thorn's **Reach**, and Dissolve's sliders (Dissolve runs after Thorn, so it never moves a thorn). The thorns stay on their points while these move (see **Thorns stay put** under Thorn). Reach only sets how long the thorns are, so a beat on Reach makes every letter's thorns shoot out and sink back together, and with Reach at 0 % between beats the letters return to their plain shapes in time with the music.
  - **Hits on the beat stay together.** A setting driven in **Trigger** or **Toggle** mode (on any effect) changes every letter together, even while Thorn is on, so each beat shows on the whole text at once and the letters return to their plain shapes together after it.
  - **Small movements still arrive.** When the sound moves a setting only a little (less than a twentieth of its slider), a group waits about 2½ seconds before taking it, so the text stays calm but still follows the sound.
  - A slider you move yourself, one the sound is not driving, still changes every letter at once. When the sound starts moving the letters, when you turn Thorn on, or when you change the text or the font, every letter starts on the latest settings together. With Thorn off, nothing takes turns.
- **Live · N fps** — shown in **Transport** (and in **Record**) and in the status line at the bottom: how many new shapes a second the app can keep up with (fps means frames per second). The app draws the next shape as soon as the last one is ready, at most 30 a second, so heavy settings and long texts give fewer. Motion contrast and Pitch reactive give the app up to three versions of each letter to work out, so they lower the number too. It counts new shapes, not how often the app listens to the sound (that happens at the screen's own pace, and only while the tab is in view).
- **No flashing:** every driven slider and seed shares one limit, so that together they make the letters flash at most 3 times a second. A flash is a big change and the change back, so that is about 5 big changes a second. A big change is a slider turning back by a tenth of its track or more (several sliders turning back at the same moment count together once their moves add up to a tenth), or a seed jump (see **Seeds** above). When the music would go faster (fast drums with a short **Release**, for example), the sliders wait a moment before they turn back again, and seed jumps are skipped. The limit watches every letter on screen: with Motion contrast or Pitch reactive, the letters that move furthest count, and a letter switching between moving less and moving more counts as a change too. A change that reaches the screen in a few quick steps, as when the melody moves to a new note, counts once. A group of letters taking its turn (see **Thorns take turns**) counts as a big change too when its thorns change a lot; when the limit is reached, the turn waits a moment.
- If that falls below about 8 a second, the tab says "Too slow to follow the sound: try fewer effects or a shorter text." (with Motion contrast or Pitch reactive on: "Too slow to follow the sound: try fewer effects, a shorter text, or less Motion contrast and Pitch reactive."). Turning off some Experimental effects, using a shorter text, choosing lighter settings, or turning those two knobs down helps.
- **Freeze** (in **Transport**) — copies what the letters look like right now into the sliders and seed boxes and pauses the sound (the file pauses, or the microphone stops listening). That moment stays on screen as ordinary settings that you can keep adjusting or export. Press **Play** or **Start listening** to carry on. Freeze is greyed out while the sound is not moving the letters, and while a video is recording ("Freeze is off while recording."). Pressed while the shared values (the lines on the sliders, and the live seeds) match your sliders and seeds (for example between two drum hits), it only pauses the sound. Undo (⌘Z on a Mac, Ctrl+Z elsewhere) puts the sliders and seeds back as they were before Freeze (the sound stays paused). Freeze also keeps the live switches, Typography, and colours. A variable font's axes have no slider, so after Freeze the font goes back to its own values.
  - With Motion contrast, Pitch reactive, or Thorn's turns, Freeze writes the shared values (the ones the lines on the sliders show). Every letter then takes them, so the letters that moved more or less than the others, or whose thorns had not had their turn yet, look like the rest again.
- **SVG, PNG, and font exports always use the sliders and seed boxes**, never the moving letters. To save a moment of the music, press **Freeze** first, then **Export…**. While the sound is moving the letters, the export dialog reminds you of this. To keep the movement itself, save a video: it shows the letters exactly as they move, each with its own amount (see [As a video](#as-a-video)). **Fit text** and **Free** (in the Typography tab) also measure the letters as your sliders make them, as exports do.

**Sound settings** — how the sound is measured (the **Sensitivity** and **Release** knobs in **Input**) and how strongly the letters answer it (the four knobs in **Response**: **Strength**, **Contrast**, **Pitch reactive**, **Melody**, and **Glide**). Seven knobs, each with an **ⓘ** next to its name that explains it. At their starting values the letters move a little further than the mappings set them (**Strength** starts at 150 %); at **Strength** 100 % they move just as set.

- **Sensitivity** — boosts or cuts the input before measuring, for quiet or loud sources (−24 to +24 dB, default 0 dB). Raise it for a quiet room or a distant microphone, which also helps Beat catch quiet hits; lower it if the meters are always full.
- **Strength** — how far all the mappings move the letters, from 0 % to 400 % (default 150 %, so the letters answer the music clearly). At 50 % they move half as far, at 200 % twice as far; a slider still stops at the end of its track. It also scales every seed's **Rate** (which never goes past 100 %). At 0 % the letters hold still. Larger moves are held back more often by the no-flashing limit (see **No flashing** above). Work saved when the starting value was 100 % opens at 150 %; any other value you chose stays as it was.
- **Motion contrast** (the **Contrast** knob) — lets each letter react by its own amount (0–100 %, default 0 %). At 0 % every letter moves the same. Above 0 %, about one letter in six moves less than the rest, about one in six moves more, and the others move by the shared amount; the higher the value, the bigger the difference (at 100 %, the letters that move more go several times as far as the shared amount, and those that move less go only a fraction of it). Which letters lead drifts slowly, every few seconds. **Strength** still sets the overall amount. While Thorn is on, it leaves the settings that take turns alone (see **Thorns take turns** above). It can lower the frame rate.
- **Release** — how slowly the readings fall back after a sound: short is jumpy, long is calm (20–1000 ms, default 150 ms). Most readings rise at once; Beat and Melody fall back at this speed; Swell and Pitch keep their own speed. (Earlier versions called it **Smoothing**.)
- **Pitch reactive** — lets the note decide which letters move most (0–200 %, default 0 %): the low notes of the tune move the letters on the left more, its high notes those on the right, so a tune sweeps across the whole text, whether it is sung low or high. The app learns the tune's range from the last few seconds of notes: it starts with an octave around the first clear note, stretches almost at once (in about 0.15 seconds) when a higher or lower note comes, and slowly narrows towards the latest note over about 8 seconds; after 8 seconds without a note it starts afresh. The range is never narrower than an octave, so a steady voice does not throw the letters from side to side, and notes at the very bottom or top of the **Pitch** meter (within a semitone of 55 Hz or 1760 Hz) are ignored, because chords and drums tend to read there. Because the range stretches with each new note, the first time a tune climbs, each new highest note sits at the right edge; once the app has heard the whole tune, each note gets its own place. It needs a clear single note, such as a voice or one instrument. The higher the value, the bigger the difference; at high values a quick jump of an octave is now and then held back by the flash limit (see **No flashing** above). While Thorn is on, it leaves the settings that take turns alone, as Motion contrast does. It can lower the frame rate.
- **Melody tracking** (the **Melody** knob) — adds movement each time the tune moves to a new note, even while the loudness stays the same (0–200 %, default 0 %). It gives every slider row a push from the **Melody** reading (see **Input** above): the higher the value, the bigger the push. Rows on **Pan** or on **Melody** itself, and seeds, get no push. To move a slider with the melody alone, pick **Melody** as a row's **Feature** instead.
- **Glide** — how long the letters take to travel to each new shape while the sound moves them (0–1000 ms, default 150 ms). Without it, each new shape replaces the last one at once, which can look jumpy; with it, every corner of a letter slides from where it is to where the sound puts it, fast at first and settling into place. A new shape that comes along on the way is picked up from where the letters are, so they never jump back. A big change — an effect switching on or off (as **Return to plain** does on every beat), or an effect's strength moving a long way — goes through two real in-between shapes on its way, so an effect grows in from nothing or fades out, instead of one letter simply melting into the next. The in-between shapes are made of straight lines like every other shape. Each effect moves in its own way: with **Whorl**, the letter winds the way Whorl itself winds it, a little further each moment: every part swings round the centre, following the straight sides of Whorl's rings and turning at their corners, so its path is a "curve" made of straight lines; with every other effect (Thorn and Burst spikes, Dissolve, Distortion, and the rest) the corners travel in straight lines, so a spike shoots straight out of the outline and sinks straight back. The letters stay made of straight lines all the way. **0 ms** shows each shape at once, exactly as before. Glide only changes what you see on the canvas, in the preview, and in a video: the shapes themselves, the slider markers, **Freeze**, and your exports are the same at any value. When the sound stops, the letters glide back once to the sliders' shape. Changing the text or the font shows the new letters at once. If your computer is set to reduce motion, the letters never glide. Longer times look smoother but trail further behind the sound.
- **Reset sound** — the button under the **Response** knobs: puts all seven back to their starting values: 0 dB and 150 ms, then 150 %, 0 %, 0 %, and 0 %, and 150 ms for Glide. It is greyed out when they already are.
- All seven are kept with your work and can be undone like any other setting (see [Coming back later](#coming-back-later)). Loading a preset does not change them.

**If something goes wrong**, a message appears in **Transport**, under the sound (pointing at it may show the browser's own technical detail):

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

The **Record** box, at the bottom of the Sound tab, records the canvas as a video while the microphone moves the letters, in real time and with the sound in it. With an audio file, the box shows a short note and an **Export video…** button instead: a file's video is made in the export dialog, from any stretch of the file, faster than real time and smooth however heavy the effects (see [As a video](#as-a-video)). Unlike the other exports, a video keeps the movement: every letter exactly as it moves, including letters that react by their own amounts and thorns taking turns, with the text held in place as on the canvas. It records what the canvas shows, so a change you make during a take is in the video too. Like a PNG, it shows only the canvas: anything past its edge is cut off. (A **take** is one recording, from **Record** until it ends.)

The box is open at first; click its heading, **Record**, to fold it away or open it again (a take goes on while it is folded, and the header still shows it).

1. Choose **Microphone** as the sound and set up the letters and mappings as usual.
2. Set the options below.
3. Press **Record**. If the microphone is not listening yet, Record starts it (the first time, the browser asks for permission). Recording begins as soon as the sound runs.
4. Press **Stop**, or let the chosen **Length** end the take. The video is saved to your computer like any other export (usually into your Downloads folder). If Record started the microphone, it stops listening again.

- **Record** / **Stop** — beside it, the time recorded and, for a set length, how long the take will be (for example "0:03 / 0:10"), and **Live · N fps** while the sound moves the letters. When Record cannot start, it is greyed out and the reason shows underneath: "Load a font to record.", "Choose an audio file first.", "Opening the sound…", or "This browser cannot record video."
- **Format** — **MP4** (the starting choice; it plays almost everywhere) or **WebM**. A browser that cannot write MP4 saves WebM instead and says "MP4 isn't supported in this browser: saved as WebM." A format the browser cannot write at all is greyed out and marked "(not supported in this browser)".
- **Length** — how long a take runs: **Until stopped** (the starting choice), **5 s**, **10 s**, **15 s**, **30 s**, **60 s**, or **Whole file**. **Whole file** is greyed out for the microphone (a whole audio file is saved from the export dialog instead); if it was already chosen, a note says "Whole file needs an audio file: this take runs until stopped." Every take stops after 10 minutes at the latest ("Stopped at the 10-minute limit."), because the browser holds the video in its memory until it is saved.
- **Frame rate** — how many frames a second the video file has: **24**, **25**, **30** (the starting choice), **50**, or **60**. Pick the rate your video editor or project uses; **30** suits most uses, and **24** gives a film-like file. The video keeps to about this rate for the whole take: when the letters have not changed, it simply shows the same picture again. It is "about" because the browser writes the file with a slightly uneven rate, and on a 60 Hz screen **60** can skip the odd frame; most video editors handle this without trouble. The letters themselves change at most 30 times a second, so **50** and **60** do not make the movement smoother; they suit projects that expect those rates, and make larger files.
- **Include audio** — puts the sound into the video, lined up with the letters (on at the start). With the microphone, its sound goes into the file, but it is still never played through your speakers. Recording does not change what you hear.
- **Use the preview look** — off (the start): the canvas in its **Color** settings, as a PNG export shows it. On: the look of the small preview at the bottom right, with its **Blur** and, if **Invert** is on, its swapped colours.
- **The size line** under the options says what the next take will be, for example "1200 × 800 px · 30 fps · MP4". The size is the PNG size: the canvas's **W** × **H** times its 1×–4× multiplier (see [Canvas size](#canvas-size)). A video larger than 4K (longer than 3840 px, or more pixels than 3840 × 2160) is scaled down to fit, and the line adds "(scaled down to the 4K limit)". A video cannot be transparent: with **Transparent background** on, the background colour is painted, and a note says "Videos have no transparency: the background colour is painted."
- **Frames:** the video has about the chosen **Frame rate**. The pictures in it change each time the canvas shows a new shape, at most 30 a second — the same number as **Live · N fps**; in between, and while the letters stand still, the video repeats the last picture. If the app cannot keep up, the box says "Too slow for a smooth video: try fewer effects or a shorter text."
- If nothing would move — **Drive letters** is off, **Strength** is 0 %, or no row has a Depth (and **Return to plain** is off) — a note says "Sound is not moving the letters: the video will be still." You can still record.
- **In the header:** while a take runs, the top of the screen shows "Starting to record…", then a red light with "Recording 0:12", then "Saving the video…", with a square stop button that stays in reach whichever tab is open in the tools. When the take has ended, the header says how it went until you close the note with its **×**.
- **From the export dialog:** with the microphone, **Export…** → **Video — sound** shows the same options (changing them there changes them here). Its **Record** button closes the dialog and starts the take at once; stop it in the header. If you open the dialog again during a take, it has its own **Stop**. See [As a video](#as-a-video).
- **What ends a take** (what was recorded so far is always saved):
  - **Stop** — in the box, in the header, or in the export dialog;
  - the chosen **Length**;
  - the sound stopping — you press **Stop listening**, the microphone stops, or you switch to **File**: "The sound stopped, so the recording ended.";
  - hiding the tab — switching to another tab or minimising the window: "Recording stopped because the tab was hidden." (a hidden page is not drawn, so the video would freeze);
  - changing the canvas size or its multiplier: "Recording stopped because the canvas size changed.";
  - the 10-minute limit.
  - Closing the page during a take asks you first.
- **When it is saved,** the box and the header say so, for example "Saved Roboto-Regular-video.mp4: 0:05, 1200 × 800 px." The file is named after the font's family and style, then "video" — or "video-preview" with **Use the preview look** — for example `Roboto-Regular-video.mp4` or `Roboto-Regular-video-preview.webm`.
- **Good to know:**
  - Some players show no total length for a WebM file, or let you jump around in it only after it has played once. The video itself is complete; web browsers and players such as VLC play it.
  - Long takes at a large size make large files: up to about 1 GB for 10 minutes at the 4K limit.
  - The options last until you close the page. They are not saved with your work and are not undone.

If a take goes wrong, the box and the header say why:

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

- **Size** — the letter size in pixels (how tall one em is on the canvas), from 4 to 2000. It stays the same when you change the canvas size. You can drag the slider or type a number.
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

**Exploding letters**
Experimental tab → **Use thorn** on, then **Burst** on. **Anchors** 30–80 spikes, **Reach** 5–15 %, **Dent** 50–100 %, **Spread** 50–100 %. Fewer spikes with more Dent give torn, broken letters; many spikes with a little Reach give a hairy outline. Press **Next variant** for a new pattern.

**Unreadable, shattered letters**
Experimental tab → **Use crumple** at 300–500 %, or **Use ripple** at 200–400 %, or **Use slipstream** with **Gustiness** 150–200 %. Combine them for total chaos, and press **Next variant** until the shapes surprise you. With several of them near their maximum the letters are simplified into coarse slabs (see "When the settings get very heavy" in the Experimental tab). Exporting a whole large font with every effect at its maximum can exceed the file's point limit; export only the characters in the text instead.

**Letters that pulse with the music**
Sound tab → **File** → **Choose file** → **Play**. Under **Modulation**, click **Add mapping** (Level → Distortion · Noise amplitude, +50 %): loud passages roughen the letters, quiet ones smooth them. For a stronger effect turn up the row's **Depth** knob, or start Distortion's **Noise amplitude** a little higher. Press **Freeze** at a moment you like, then export it.

**Petals that open on the bass**
Experimental tab → **Use ripple** on, **Amount** 0–30 %, **Petals** 0–20 %, **Sides** 5. Sound tab → **Add mapping**, then set **Feature** to **Bass**, **Target** to **Ripple · Petals**, and **Depth** to +10 %. For a shiver on the cymbals as well, add **Treble** → **Crumple · Amount** (this turns on Crumple for you).

**Anchors that jump on the beat**
Sound tab → **File** → **Choose file** → **Play**. Click **Add mapping**, set **Feature** to **Beat**, **Target** to **Distortion · Seed** (if **Noise amplitude** was 0, it is set to 40 for you), and **Rate** to 100 %: the rough outline takes a new shape on every beat. For points that move along the letter itself, choose **Random anchors · Seed** instead (this turns on random anchors). Press **Freeze** when you like a shape.

**Back to the original**
Set Curve flattening to **Adaptive** with a small **Tolerance**, and turn off Squaring, Anchors, Grid & angles, Distortion, and the Experimental effects (each has a reset button). Or simply choose **Original** in the canvas toolbar to look at the untouched font.

---

## 10. Saving your work (Export)

Click **Export…** in the top-right corner. Nothing is downloaded until you press a download button (a microphone video is saved when its take ends).

**File name**, under the formats, names the file you save. Leave it empty and the app picks a name from the font (shown greyed out in the box, for example `Roboto-Regular-text`). The ending (`.svg`, `.png`, `.otf`, `.mp4` or `.webm`, `.json`) is added for you and shown beside the box, so one name works for every format: type `poster` and you get `poster.svg`, `poster.png` and so on. Any language works; characters a computer can't use in a file name, such as `/` or `:`, become `-`. The name stays while the page is open. A video recorded from the Sound tab's **Record** box uses the name the app picks.

SVG, PNG, and font exports always use your slider settings and seeds. If the **Sound** tab is moving the letters, press **Freeze** first to export the moment you see. A video is different: it shows the letters as they move with the sound (see [As a video](#as-a-video)).

### As an image (SVG or PNG)

Both save the canvas: its size, your text placed as on the canvas, and your colours.

1. Choose **SVG — main view** (shapes you can keep editing) or **PNG — main view** (a picture).
2. For a transparent background (only the letters are drawn), tick **Transparent background** in the Color tab first.
3. Optional: tick **Export the preview look** to save what the small preview shows instead — its blur, and its swapped colours if **Invert** is on. Set Blur and Invert in the preview first.
4. **Solid or outlines only:** the image follows the canvas's **Fill** button. With Fill on (the usual), the letters are solid. With Fill off, they are drawn as outlines only — lines 2 px wide on the canvas (so 4 px in a 2× PNG), in the text colour, with nothing inside. The dialog tells you which one you will get; to change it, close the dialog and click **Fill** above the canvas.
5. For SVG, **Coordinate precision** — how many decimals the numbers in the file keep; 2 is a good default. The preview shows the letters at this precision too, and the app keeps your choice for next time. For PNG, the image size comes from **Canvas size** (width × height × the 1×–4× multiplier).
6. Click **Download SVG** or **Download PNG**. If some letters are not ready yet at the current settings, the dialog says **Computing outlines…** and the download starts as soon as they are; **Cancel** stops it.

SVG files open in Illustrator, Figma, Inkscape, and web browsers; the shapes contain only straight lines. A blurred SVG uses a blur effect that browsers and most design apps show; if an app ignores it, use PNG.

### As a font (OTF)

1. Choose **Font file — OpenType (.otf)**.
2. **Glyphs to include:** **Current glyph**, **Specimen characters** (only the characters in your text), or **All mapped characters** (every letter the font has).
3. Give it a **Family name** and **Style name** — use plain English letters. A new name avoids confusion with the original font. Below the names, the dialog says about how many outline points the font will have. A yellow note warns you if that is more than a font file can hold (1,000,000), or if many letters still have to be worked out at these settings, so that the build may take minutes.
4. Click **Build & verify**. The app builds the font in the background and then checks it thoroughly, showing how far it has got (for example "Processing outlines 120 / 300", then writing and checking the file). Letters already drawn on the canvas are reused, so only the others need working out. **Cancel** stops the build at once. If the build makes no progress for a whole minute, it is stopped and the dialog says "The export stopped responding."
5. When it says "Verified", click **Download .otf** and install the font like any other.

Good to know:

- If you change any setting after building, build again before downloading.
- A font file always has solid letters, even when **Fill** is off on the canvas; the dialog reminds you.
- The new font keeps the original's **kerning** — the fine spacing between pairs such as "AV" — for the letters it contains, so text sets as it does on the canvas. Ligatures, the placing of accents on letters, kerning that depends on the neighbouring letters or on the language, and the original's other advanced features are not included. **What the font file does not include** in the dialog lists them all.
- Letters are saved with the same weight, style (for example italic), slant, line spacing, and copyright and license details as the original font, so a Regular and a Bold you make install side by side like the originals.
- Lines are spaced as on the canvas, on Mac and Windows alike. If letters reach far above or below their usual height (for example with Slipstream), a few older apps may space the lines further apart.
- **Letters that reach very far are trimmed.** A font file stores each letter within a square 32,766 font units across — 16 em in a font with 2048 units per em, 32.8 em in one with 1000 — placed around the letter. Parts of an outline that reach further, such as long Thorn tips, are cut off with straight cuts at the square's edge, so the letter is still saved. The dialog lists these letters under "Trimmed to fit". This only changes the font file: the canvas, SVG, and PNG show them as before.
- Very rarely a letter cannot be stored in a font file at all — for example, its shape has details finer than one font unit, or it takes up more than 32,767 font units of width (from its start to where the next letter begins). The dialog then says "Left out of the font file:" and names each such letter with the reason. For details that are too fine, less **Distortion** or **Anchor spacing** usually helps.
- With very dense settings (Anchor spacing near 1, or strong Experimental effects) a whole font can have too many points for one file. The dialog warns you before you build, and suggests a larger Anchor spacing, weaker Experimental effects, or exporting only the characters in your text.
- Variable fonts are saved in the version you see on screen, with their kerning rounded to whole font units.
- **Licensing:** a modified font is still based on someone else's design. Check the original font's license before sharing it — many open-source fonts require a new name for modified versions. If the original reserves its name, the export dialog tells you to choose a different family name.

### As a video

Choose **Video — sound**. It needs a font and a sound chosen in the Sound tab. What happens next depends on the sound.

**With an audio file**, the app makes the video itself, picture by picture, from the plan it works out for the whole file (the same one that makes playback smooth). It does not have to keep up with the music, so the video is smooth however heavy the effects, is made faster than real time, and comes out exactly the same every time. **Glide** and its in-between shapes are in it, as on the canvas.

1. Set the **Time range**: **Start** and **End**, in seconds from the beginning of the file. It starts as the whole file; the line underneath shows the stretch and how long it is. One video can be at most 10 minutes long.
2. Set **Format**, **Frame rate**, **Include audio** (the file's sound for the same stretch), and **Use the preview look**. These are shared with the Sound tab's **Record** group; there is no **Length**, since the Time range sets it.
3. Click **Render video**. A bar shows how far it has got; **Cancel** stops it and saves nothing ("Cancelled: nothing was saved."). Closing the dialog stops it too.
4. When it is done, the video is saved like any other export, and the dialog says so, for example "Saved Roboto-Regular-video.mp4: 0:00.0 to 0:30.0."

- Files longer than 6 minutes cannot be made into a video: "Files longer than 6 minutes cannot be rendered: use a shorter file."
- A browser that cannot write MP4 saves WebM instead and says "This browser cannot write MP4: saved as WebM." If it cannot put the sound in, the video is saved silent and the dialog says "This browser cannot encode the sound: the video has none."
- The file's name follows the same pattern as a recording's (see [Record a video](#record-a-video)).

**With the microphone**, there is no file to work from, so the video is recorded live:

1. Set **Format**, **Length**, **Frame rate**, **Include audio**, and **Use the preview look**. These are the same options as in the Sound tab's **Record** group: changing them here changes them there. The line under them shows the video's size, for example "1200 × 800 px · 30 fps · MP4".
2. Click **Record**. The dialog closes and the take starts at once; the microphone starts listening if it was not. The top of the screen shows, for example, "Recording 0:02" and a square stop button.
3. Click the stop button, or wait for the chosen **Length**. The video is saved when the take ends, and the header says what was saved.

The video follows the canvas's **Fill** button like an image: with Fill off it shows outlines only, and the dialog says so.

What each option does, what ends a live take, and how the file is named are explained in [Record a video](#record-a-video).

### As a config file (settings only)

A config file keeps your settings, not your letters: load it later, in another browser, or on another computer, and the app is set up as it was. It is a small `.json` file.

1. Choose **Config — settings (.json)**. This also works before you load a font.
2. The dialog says which font the file asks for. Click **Download config**. The file is named after the font, for example `none-curve-Roboto-config.json`.

It holds the same things the app keeps between visits (see [Coming back later](#coming-back-later)): every setting, the canvas size, the text, the canvas view buttons, the preview's Blur and Invert, the **Coordinate precision**, the Sound tab's mappings and its seven sound knobs, the selected letter, and the font's name. It never holds the font itself, the sound, or the video options.

**To load it:** click **Import** → **Config file** and pick the file, or drag it onto the canvas.

- Your settings, text, Sound mappings, and the seven sound knobs change in one go, and one undo (⌘Z on a Mac, Ctrl+Z elsewhere) brings back what you had before. The canvas view buttons, the preview's Blur and Invert, and the Coordinate precision change too, but undo leaves them as they are (they are never undone).
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
No. Your text, settings, Sound mappings, and the seven sound knobs are kept in this browser and come back when the page opens again, and the same settings and seed always give the same result. A Google font is downloaded again by itself; a font from your computer has to be imported again. See [Coming back later](#coming-back-later). To keep a result for sure, export it.

**I changed something by mistake.**
Undo it: ⌘Z on a Mac, Ctrl+Z elsewhere. See [Undo and redo](#undo-and-redo).

**How do I start over from scratch?**
Press the turning-arrow button at the right end of the status line (**Reset all**): it closes the font and puts the text and every setting back to how the app first opens. It cannot be undone, so export or save a config file first if you want to keep anything. To start over in just one group, use that group's reset button. See *Starting over in one click* in [A tour of the screen](#3-a-tour-of-the-screen) and [Coming back later](#coming-back-later).

**A letter is missing, and the text box says some glyphs "failed to process".**
The app gives up on a letter that takes longer than 60 seconds to work out. That letter is left out of the canvas and of exports; a font export lists it with the reason "Took longer than 60 s; try lighter settings". Lower the heaviest settings (usually Experimental effects or a small **Anchor spacing**).

**A red message on the canvas says "The geometry worker … Reload the page to try again."**
The letters are worked out in the background by a few copies of a part of the app called the geometry worker, which share the work. If none of them could start, or they kept failing or stopped responding several times within a minute (counted together), the letters cannot be drawn any more: reload the page. If a heavy setting was the cause, lower it after reloading. "The geometry worker could not open this font" means the font file could not be read for drawing; try another copy of the font.

**The letters do not move with the music.**
In the Sound tab, check that a font is loaded, that the file is playing (or the microphone is listening), that **Drive letters** is switched on, that **Strength** (under **Response**) is above 0 % (at 0 % a note under Drive letters says "Strength is 0%: the letters hold still."), and that there is at least one mapping that is ticked and has a **Depth** (or **Rate**) other than 0 %. If a grey note sits under the row, click **Enable** next to it — for example, "Turn on Crumple to hear this." means the Crumple effect is off. If the meters stay empty, the sound is too quiet: raise **Sensitivity**. The app listens only while its tab is in view: when you switch to another tab, minimise the window, or hide it behind another window, the letters stop following the sound, and they pick it up again when you come back.

**The sliders and seeds do not move while the letters do.**
That is on purpose: your sliders and seed boxes keep your settings. The thin line on each driven slider shows where the sound has taken it, and the small number beside a driven seed's box is the live seed. When the sound stops, the letters go back to your settings. Press **Freeze** to copy the current look into the sliders and seed boxes.

**A setting switched itself on when I picked a target.**
That target only has an effect while that setting is on, so the app switched it on and said so under the row (for example "Turned on Ripple."). It stays on when you change the row's target or remove the row; switch it off yourself if you do not want it.

**My export does not look like the moving letters.**
SVG, PNG, and font exports use the sliders, not the sound. Press **Freeze** at the moment you want, then export. With **Motion contrast**, **Pitch reactive**, or Thorn's turns, Freeze gives every letter the shared values, so the frozen letters look more alike than the moving ones did. To keep the movement itself, save a video: **Video — sound** in the export dialog (see [As a video](#as-a-video)).

**The video is choppy.**
A video of an audio file is made picture by picture, so it is always smooth; this is about recording the microphone live. A live video's pictures change as often as the app draws while the sound moves the letters — the **Live · N fps** number, at most 30 (the file still has about its **Frame rate**: between new shapes it repeats the last picture). Heavy settings, a long text, **Motion contrast**, and **Pitch reactive** lower it; below about 8 a second the Record group says "Too slow for a smooth video: try fewer effects or a shorter text." Turn off some Experimental effects, use a shorter text, or lower Motion contrast and Pitch reactive, then record again. While the letters stand still, the video holds the picture: that is not a fault.

**Why did I get a WebM file instead of MP4?**
Not every browser can write MP4. When yours cannot, the app saves WebM instead and says "MP4 isn't supported in this browser: saved as WebM." (for a video of an audio file: "This browser cannot write MP4: saved as WebM."); in the **Format** list, MP4 is then marked "(not supported in this browser)". WebM plays in web browsers and in players such as VLC. If you need MP4, record in another browser (for example a recent Chrome or Edge), or convert the file with a video converter. Some players show no total length for a WebM file; the video itself is complete.

**Sound and picture are slightly out of step in the video.**
A video of an audio file is made from the file itself, so its sound and picture line up exactly; this is about recording the microphone live. Live, the letters always follow the sound a moment late, because each new shape takes time to work out. The app delays the sound in the video by the same amount, measured when the take starts, but it can still be off by about one frame, and by more if the frame rate changes a lot during the take. Let the sound move the letters for a few seconds before you press **Record**, so the app can measure the delay, and use lighter settings so the frame rate stays steady. A video editor can shift the sound if you need it exact.

**The recording stopped when I switched tabs.**
A browser stops drawing a page you cannot see, so a live video would freeze. The app therefore ends the take when its tab is hidden — you switch to another tab or minimise the window — saves what it recorded, and says "Recording stopped because the tab was hidden." Keep the app's tab open and in view until the take ends.

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
| **Onset** | The moment a new sound starts, such as a drum hit; the **Beat** meter jumps to full on it. |
| **Mapping** | In the Sound tab, a connection from one sound reading (such as **Level**) to one slider or seed, whose value then follows the sound (the slider or seed box itself stays put; a thin line on the slider, or a small number beside the seed box, shows the live value). |
| **Depth** | How far a mapping moves its slider when the reading is at its strongest, as a share of the slider's track. |
| **Rate** | How often a mapping moves its seed on to the next one, from 0 to 100 %. |
| **fps (frames per second)** | How many new shapes a second the app can keep up with while the sound moves the letters (**Live · N fps**). For a video, its **Frame rate**: how many pictures a second the file has, repeating the last one when nothing changed. |
| **Strength** | In the Sound tab's **Response** group: how far all the mappings move the letters, from 0 % (they hold still) to 400 %, 150 % to start; at 100 % they move just as the mappings set them. |
| **Motion contrast** | In the **Response** group: lets each letter react by its own amount, so some letters move less and some more than the shared amount the slider lines show. |
| **Pitch reactive** | In the **Response** group: lets the note decide which letters move most — the low notes of the recent tune move the letters on the left most, its high notes those on the right, whatever the tune's range. |
| **Thorns take turns** | In the Sound tab, while Thorn is on: the letters are split into five groups that take on the sound's latest thorn settings one after another, so only a few letters' thorns change at a time. |
| **Melody** | A Sound reading that jumps each time the tune moves to a new note. **Melody tracking** (the **Melody** knob in **Response**) uses it to give the slider mappings a push. |
| **Release** | How slowly the Sound readings fall back after a sound (earlier versions called it Smoothing). |
| **Take** | One live video recording from the microphone, from **Record** until it ends. |
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
