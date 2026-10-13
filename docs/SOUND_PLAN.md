# Sound plan

**English** · [中文](SOUND_PLAN.zh.md)

**Status:** Phases 1 (sources, features, meters) and 2 (continuous mappings, live scheduler, live markers, flash limit, Freeze) built. Phase 3 partly built (seeds that jump, Pitch and stereo Pan among 10 features, compact meters, targets that switch on what they need, presets, and the targets and presets of the reworked Experimental effects); Step mappings and the live SVG redraw measurement still to do  
**Scope:** A new **Sound** tab beside **Geometry** and **Experimental**. Live sound (a local audio file or the microphone) drives the parameters that already exist in both tabs, so the letters move with the music: anchors jump on the beat, outlines crumple when it gets loud, petals open on the bass.

## 1. Goals

- Sound drives **existing parameters only**, in both the Geometry tab (Curve flattening, Random anchors, Squaring, Anchors, Grid & angles, Distortion) and the Experimental tab (Crumple, Ripple, Whorl, Slipstream, Thorn, Seed). There are no new deformation operators.
- Two kinds of drive:
  - **Continuous:** a feature such as loudness moves a slider up and down.
  - **Jumps:** a seed moves on, so the anchors jump to new places: on each beat, or more often the higher a feature reads. A beat can also step a value to its next choice, such as the next angle (still to do).
- It runs live, at a frame rate that adapts to how heavy the settings are.
- Audio stays in the browser: decoded and analysed locally, never uploaded.
- Switching Sound off restores the slider values exactly.

This replaces the earlier "Sound-driven carved letterforms" direction (PRD section 11). That direction planned new carving operators, a timeline, audio spread across the letters of a text, and recipe export; those are dropped.

## 2. Highest rule: no curves

Sound changes nothing but parameter values, and only within each slider's own range (a seed: whole numbers within its field's range). Every frame on screen is therefore a result the sliders and seed fields could produce by hand, computed by the same pipeline: it keeps straight edges only, it is validated like every other result, and it can be exported. Frames are shown one after another as they are computed. There is no tweening or morphing between frames, which would invent in-between outlines the pipeline never made. Distortion's **few anchors** mode, which only the Flicker preset's Load sets (§7), is part of the settings like any other: sound never turns it on or off.

## 3. Sound sources

- **File** (the default): any audio file the browser can decode (WAV, MP3, AAC, OGG, FLAC, depending on the browser). It has play, pause, loop, and a position slider, and plays through the speakers.
- **Microphone:** starts only when the user presses **Start listening**, after the browser asks for permission; choosing **Microphone** only shows that button and pauses the file. It is not played back, so there is no feedback loop. Stop listening, switching source, and closing the tab release the microphone, and an indicator shows while it is active.
- There is no **Off** source (the first versions had one, as the default): Pause stops a file, Stop listening stops the microphone, and choosing **File** releases the microphone.
- Invalid, empty, silent, and unsupported input each get their own message.

## 4. Audio features

The features are computed every animation frame from Web Audio `AnalyserNode`s: a 2048-point FFT at 44.1 and 48 kHz (doubled at 88.2 and 96 kHz, so the window stays about 43 ms), with time-domain samples for the level and the pitch. A 20 Hz high-pass in front of the analysers removes DC offset from what is measured.

**Stereo measuring branch.** After the high-pass, the sound is also up-mixed to exactly two channels (a gain node with the speaker rules, so a mono source becomes identical left and right), split, and measured by one analyser per channel; these give Pan. The three analysers are read one after another, and the audio thread can render in between (in Chrome up to about one frame in 300). So each frame checks that the mixed-down samples are the mean of left and right, and reads all three again, up to 3 times; when none agree, Pan uses the last left and right that did. (A source of more than two channels never agrees, so after one held frame its reads are used as they are.) The speakers still get the file as before, and the microphone is still only measured, never played.

There are 10 features in five groups, listed in this order in the Sound tab (`FEATURES` in `src/sound/mapping.ts`). All run 0–1 except Pan.

| Group | Feature | Definition | Normalised |
|---|---|---|---|
| Loudness | **Level** | Short-time RMS (DC offset removed), in dB | −60 dB → 0, 0 dB → 1, shifted by **Sensitivity** |
| | **Swell** | Level, smoothed slowly: rise 300 ms, fall 2 s, whatever **Smoothing** says | As Level |
| Bands | **Bass** | Energy 20–250 Hz | Against a slowly adapting running maximum of its own |
| | **Mids** | Energy 250–2000 Hz | Same |
| | **Treble** | Energy 2000 Hz – Nyquist | Same |
| Tone | **Brightness** | Spectral centroid of 20 Hz – 20 kHz, on a log-frequency scale | 100 Hz → 0, 8 kHz → 1 |
| | **Pitch** | Fundamental by YIN (threshold 0.15) on the mixed-down samples, decimated to at most 24 kHz first. An unvoiced frame holds the last note; silence gives 0. | 55 Hz → 0, 1760 Hz → 1, on a log scale (5 octaves) |
| Rhythm | **Beat** | Onsets from two detectors on spectral flux: one over the whole spectrum, and one over 20–150 Hz only (the kick detector), since a bass drum can hide in the full-band flux under broadband sound. Each fires above an adaptive threshold (the median of the last second × a factor, 1.5 for the full band and 3 for the kick band, plus a floor, and at least half the last onset's flux as it decays, so a hit's own tail does not fire again), at least 100 ms apart. Every kick also fires the full-band detector, so one hit heard by both is one onset. As a feature it is a pulse, the larger of the two detectors' pulses. Known limit: a steady, buzzy low note (such as a sawtooth bass at 55–110 Hz) can fire it several times a second. | 1 on each onset, then falling back with the Smoothing time |
| | **Activity** | How busy the sound is: the larger of **Change**, how far the full-band spectral flux that Beat judges rises above its median of the last second (held between judged frames), and **Pace**, Beat's onsets per second over the last 2 s; smoothed as one | Change against the largest such rise lately (a running maximum that halves every 3 s), never against less than the Beat flux floor or a quarter of the frame's compressed spectrum: near 0 on steady sound, tones and noise alike, high on attacks. Pace: 8 a second → 1 |
| Stereo | **Pan** | (R − L) / (R + L) of the left and right RMS (DC offset removed) | −1 (left) to 1 (right): the only two-sided feature |

Pan needs a stereo file in practice: a mono file, or a mono microphone, reads centred.

**Merged from 20.** Phase 3 first measured 20 features in six groups. They were merged into these 10: Low, Mid, and High became Bass, Mids, and Treble; the six narrow bands (Sub, Bass, Low mid, High mid, Presence, Air), Noisiness, and stereo Width were dropped; Kick became Beat's second detector; Change and Pace became Activity, which takes the larger of the two rather than their mean, since a mean would halve the range and never reach 1; and Balance became Pan.

- **Smoothing:** each continuous feature follows the sound with a fast attack (10 ms) and a slower release (default 150 ms, set with **Smoothing**), so the letters react at once but do not flicker. Some have their own: Swell (above); Pitch moves both ways in 30 ms, and falls to 0 in silence with the release time; Pan moves both ways with the release time; Beat jumps to 1 and falls back with the release time.
- **Silence gate:** below the silence threshold, continuous features fall to 0 and no beats fire. A band whose own energy is below the silence threshold reads 0, even while another band is loud. Swell falls with its own 2 s, and Activity's Pace as the last beats leave its 2 s window.
- **Sensitivity** also scales the magnitudes the onset flux compares, ln(1 + 1000 g m) with g = 10^(Sensitivity / 20), so it reaches Beat too. This differs from the first spec's formula, ln(1 + 1000 m), where Sensitivity could not help a quiet source's onsets.
- Onsets are judged at most about 60 times a second, so the thresholds mean the same on 120 Hz and faster displays.
- Zero denominators are handled and outliers are clamped.

## 5. Mappings

A mapping connects one feature to one target parameter. The Sound tab holds up to 8 mappings, each with an on/off switch. Any of the 10 features can drive any target; what it does depends on the target.

- **Slider targets** (any feature → a slider):
  - live position = slider position + **Depth** × feature, clamped to the slider's ends, then rounded to the slider's step. Positions are measured along the slider as drawn (0–1), so on an ordinary slider this is slider value + Depth × feature × the slider's full range, and a log-scaled slider such as Tolerance moves evenly along its track.
  - Depth runs from −100% to 100%. Negative Depth turns it down as the sound gets louder. Pan runs −1 to 1, so it moves the slider both ways: one way for sound on the left, the other for sound on the right.
  - Beat is a pulse, so on a slider the value leaps by Depth on each onset and falls back to the slider value over the Smoothing time.
- **Seed targets** (jumps): Distortion · Seed, Random anchors · Seed, and the Experimental Seed. A new seed puts every anchor somewhere new, so the seed moves on by one on each jump. The row's slider reads **Rate** (0–100%) instead of Depth:
  - With Beat, the seed moves on with the onsets: Rate 100% on every onset, 50% on every other one, 25% on every fourth.
  - With any other feature, it jumps at up to 4.8 times a second × Rate × the feature's value (Pan by its size, to either side). A gap between measured frames counts as at most 100 ms, so a stall does not release a burst of jumps.
  - All seeds that jump in the same frame jump together, and the flash limit (§10) skips the jumps beyond it.
  - The live seed is a whole number within the field's range (0–999 999), wrapping past the largest to 0, so every live frame is still a set of values the panel can produce (§2).
  - The sign means nothing for a Rate: picking a seed for a row with a negative Depth makes it positive.
- **Step** (still to do): a value with a few choices moves to the next one on every beat, for example Allowed directions (the angle step) 15° → 30° → 45° → 90°, Sides, or Rings.
- **Several mappings on one target:** on a slider, their contributions add up, then the sum is clamped. On a seed, each mapping counts towards its jumps, and the seed moves on by at most one per frame. Each row names its target, and the driven slider's marker shows the combined live value.
- **Picking a target switches on what it needs:**
  - When the user picks a target whose setting is off (its step, effect, or mode; §6), that setting is switched on, and a notice under the row says what changed, for example "Turned on Ripple.", "Set Noise amplitude to 40.", or "Turned off Random anchors. Set Mode to Adaptive." The same happens for the row **Add mapping** adds, which prefers a target that already acts: it adds Level at +50%, on Distortion · Noise amplitude if no row uses it yet, otherwise on the first unused target that acts.
  - Switching the row to another target, or removing it, never turns anything off.
  - **Load** is the one exception (§7): it resets the Geometry and Experimental settings to their defaults before it sets a preset up, so it can turn things off, and it says so under the Preset row. Picking a target by hand still only switches on what that target needs; it resets nothing.
  - If the user turns the setting off again later, the row says why its target does nothing and offers an **Enable** button, which switches it on again and shows the notice.
  - With the keyboard, browsing the Target list switches nothing on along the way: the choice applies on Enter or when focus leaves the list. A pick with the mouse applies at once.
- **Base values stay put:**
  - The sliders keep their own values and do not move while Sound is live; a thin marker on each driven slider shows the live value.
  - A seed field keeps its own seed; a small live number beside it shows the live seed. The Distortion and Random anchors statistics show the live seed too, since they describe the letters as shown.
  - Depth or Rate 0, or a switched-off mapping, gives exactly the slider value or seed.
  - A mapping to a target whose step, effect, or mode is off does nothing, and its row says so.

## 6. Targets

**Geometry tab**, where "anchor jumping" lives:

| Target | Suggested drive | What you see |
|---|---|---|
| Distortion **Seed** | Beat at Rate 100%, or Level | Every anchor jumps to a new place on the beat, or more often the louder it gets (with few anchors, as Flicker sets, a new few anchors of each letter move instead) |
| Distortion · **Noise amplitude** | Level, or Beat (a pulse) | Anchors shake harder when loud, or kick out on the beat and settle |
| Distortion · **Noise frequency** | Brightness | Brighter sound gives a finer, jitterier edge |
| Random anchors **Seed** | Beat at Rate 100% | The anchors are re-sampled at new positions on every beat |
| Random anchors **Randomness** | Level | Loud: anchors scatter; quiet: they line up evenly |
| Random anchors **Density** | Bass, stepped | Fewer, chunkier anchors on the bass |
| Curve flattening · **Tolerance** | Level | Loud passages get coarser, more polygonal |
| **Squaring** amount | Mids | Bowls square off with the voice |
| Anchors · **Anchor spacing** / **Anchor reduction** | Treble / Level | Anchors densify or drop out |
| **Grid** size | Bass, stepped | Snaps to a coarser grid on the bass |
| Grid & angles · **Allowed directions** (the angle step) | Beat → Step (still to do) | Edges lock to 15°, 30°, 45°, 90° in turn |

Also targets, with no suggested drive: Curve flattening · Segments per curve and Corner angle, and Distortion · Normal bias. The full list, in panel order, is `TARGETS` in `src/sound/mapping.ts` (README, Targets): 43 targets, of which the three seeds are jump targets and the rest sliders. Allowed directions becomes a target with Step mappings.

**Experimental tab**: Crumple Amount / Detail / Facet size / Turn; Ripple Amount / Wavelength / Sides / Center X / Center Y / Fade / Petals; Whorl Amount / Rings / Sides; Slipstream Direction / Strength / Slip / Gust size / Gustiness / Cuts / Trails; Thorn Anchors / Reach / Root / Spread / Width / Refraction / Flute width; and the shared **Seed** (Beat at Rate 100%), listed last as its group sits at the bottom of the tab. The Target list shows it as just "Seed"; every other target reads "Section · Label", such as "Distortion · Seed". Older saved settings that lack a field read it as the panel shows it: Crumple Detail 50%, Thorn Root 50% and Flute width 10%, and 0 for Crumple Turn, Ripple Petals, Slipstream Slip, Cuts, and Trails, and Thorn Refraction.

**What a target needs to act** (its inactive note, and what picking it switches on, §5):

| Targets | Needs | Picking it |
|---|---|---|
| Curve flattening · Tolerance, Segments per curve, Corner angle | Random anchors off (they replace flattening) | Turns Random anchors off |
| Curve flattening · Tolerance | Mode Adaptive | Sets Mode to Adaptive |
| Curve flattening · Segments per curve | Mode Fixed segments | Sets Mode to Fixed segments |
| Curve flattening · Corner angle | Merge joined curves on, in either Mode | Turns on Merge joined curves |
| Grid & angles · Grid size | Snap to grid on | Turns on Snap to grid |
| Distortion · Noise frequency, Normal bias, Seed | Noise amplitude above 0 (at 0, Distortion is off) | Sets Noise amplitude to 40 |
| Random anchors · Density, Randomness, Seed | Random anchors on | Turns on Random anchors |
| Random anchors · Seed | Randomness above 0% (at 0% the anchors are evenly spaced, so the seed has nothing to choose) | Sets Randomness to 100% |
| Crumple, Ripple, Whorl, Slipstream, Thorn sliders | That effect on | Turns on that effect |
| Thorn · Flute width | Thorn on, then Refraction above 0% (at 0% the panel greys Flute width out) | Turns on Thorn, sets Refraction to 50% |
| Experimental Seed | Crumple, Slipstream or Thorn on (Ripple and Whorl have no randomness) | Turns on Crumple |

Squaring, Anchors, and Distortion · Noise amplitude always act. Corner angle acts whenever Merge joined curves is on and Random anchors are off, whatever the Mode: the panel shows it with the merge controls, which both modes share.

Switches (Use crumple, Pin top and bottom, and so on), the Curve flattening Mode, and Distortion's few anchors mode are not targets: sound never turns a step on or off. Only picking a target (or Add mapping, or Enable) switches one on, once, and Load resets the settings and sets a preset's own (§7), each as an ordinary edit of the panel.

## 7. Presets

Presets are ready-made starting points (`PRESETS` in `src/sound/presets.ts`): each sets a few slider values to start from as well as its mappings. Most keep to the Geometry tab and its default sliders, so the letters stay readable while it is quiet, and none turns on more than one Experimental effect.

Choosing a preset in the **Preset** list only selects it. **Load** (`presetSettings`, pure):

1. Resets every Geometry and Experimental setting to its default (Curve flattening, Random anchors, Squaring, Anchors, Grid & angles, Distortion, and every Experimental effect), keeping the three seeds (Distortion, Random anchors, and the Experimental seed). Typography, Color, the canvas, and the Sound tab's source, Drive letters, Sensitivity, and Smoothing are left alone.
2. Sets the preset's start values.
3. Replaces the mappings with the preset's, and clears the earlier row notices.
4. Shows a notice under the Preset row: "Loaded X.", then "Turned off …." for the Experimental effects that were on and are now off (Crumple, Ripple, Whorl, Slipstream, Thorn), then "Turned off Random anchors." when that happened, then "Other Geometry and Experimental settings back to defaults (seeds kept)." when any other setting the preset does not set went back to its default. For example: "Loaded Bloom. Turned off Crumple and Slipstream. Other Geometry and Experimental settings back to defaults (seeds kept)." The notice stays until the next Load or until another preset is chosen in the list, and screen readers announce it.

So every preset starts from the same letters, whatever was set before, and its rows need nothing switched on. Should a row still need something, it is switched on as when its target is picked by hand (§5), row by row, with the row's notice. Picking a target by hand still only switches on what it needs; it resets nothing.

Depth is in brackets, as a share of the slider's travel (negative turns the slider down); on a seed it is Rate. Start values list only what differs from the defaults.

| Preset | Mappings | Start values | Experimental effect | What you see |
|---|---|---|---|---|
| **Flicker** | Level → Distortion · Noise amplitude (90%); Beat → Distortion · Noise amplitude (30%); Beat → Distortion · Seed (Rate 100%) | Few anchors on; Noise amplitude 2; Normal bias 90% | None | On every beat a few other anchors of each letter jump while the rest hold the letter; louder sound and each beat throw them further |
| **Scatter** | Level → Random anchors · Randomness (90%); Level → Random anchors · Density (−9%); Beat → Random anchors · Seed (Rate 50%) | Random anchors on; Density 10; Randomness 5% | None | Anchors are placed afresh on every other beat: close and even while it is quiet, fewer and further from even as it gets louder |
| **Pixel** | Bass → Grid & angles · Grid size (70%); Treble → Anchors · Anchor reduction (40%) | Snap to grid on | None | The letters snap to a grid that the bass makes coarser; hiss and cymbals drop anchors |
| **Low poly** | Level → Curve flattening · Tolerance (70%); Brightness → Anchors · Anchor reduction (40%) | Merge joined curves on | None | Loud passages flatten the curves into fewer, longer sides; bright sound drops anchors |
| **Block** | Swell → Squaring · Amount (90%); Beat → Squaring · Amount (30%) | None (the defaults) | None | The round strokes square off as the music swells, and a little more on each beat |
| **Jitter** | Treble → Distortion · Noise amplitude (60%); Brightness → Distortion · Noise frequency (30%) | Noise amplitude 2; Noise frequency 20 | None | Hiss and cymbals make the outlines tremble; brighter sound makes the tremor finer |
| **Facet** | Level → Curve flattening · Segments per curve (−15%); Beat → Curve flattening · Segments per curve (−5%); Pitch → Curve flattening · Segments per curve (20%) | Mode Fixed segments; Merge joined curves on; Segments per curve 6 | None | Curves break into a few straight sides as it gets louder and on each beat; higher notes smooth them again |
| **Bloom** | Beat → Ripple · Amount (10%); Bass → Ripple · Petals (5%) | Ripple on, Amount 30% | Ripple | Ripples run through the letters and swell on each beat; the bass bends them into petals |
| **Flare** | Beat → Seed (Rate 100%); Level → Thorn · Reach (30%); Beat → Thorn · Anchors (15%) | Thorn on, Anchors 1, Reach 0% em, Root 25% | Thorn | Thorns shoot out of a few anchors per letter as it gets louder; on every beat they jump somewhere new and briefly multiply |
| **Gale** | Level → Slipstream · Slip (50%); Beat → Slipstream · Cuts (40%); Activity → Slipstream · Trails (35%) | Slipstream on, Strength 0%, Slip 0% em, Cuts 0, Trails 0 | Slipstream | Loudness slides slices of the letters past each other; beats cut slits along the stream and busy passages draw trails |

- **Flicker** turns on Distortion's **few anchors** mode. It has no control of its own and is not a Sound target: only this preset sets it, and Reset distortion, or loading another preset, turns it off. Only 1–5 anchors of each letter move, never its corners or extremes, each by at least 60% of the amplitude, and a new seed picks a new set (README, Vertex distortion; PRD, P1). The tiny amplitude, 2, keeps Distortion on, so the Seed row acts while it is quiet.
- **Jitter**'s amplitude of 2 likewise keeps its Noise frequency row acting while it is quiet.
- **Low poly** merges joined curves, so a large Tolerance reaches whole bowls (unmerged, each font curve keeps at least one edge). **Facet** merges them too, so its segments count per merged curve, a quarter of a bowl, not per font curve.
- **Flare** starts at Reach 0, so there are no thorns, and no root pull, while it is quiet; its Root of 25% (half the default) keeps the strokes readable. Thorn is on from the start, so its Seed row needs nothing switched on, and Crumple stays off.
- **Gale** starts with Strength, Slip, Cuts, and Trails at 0, so nothing streams while it is quiet. It never drives Strength: the stretch would push the letters into their neighbours.
- **Bloom**'s Petals row moves the petals between 0% and 10% only, once the bass is up (the slider's step is 10%, and 20% is hard to read).
- **Retuned in phase 3:** when the features were merged, the rows on Kick moved to Beat (with smaller depths for Block, Facet, and Bloom), Low poly's Noisiness row became Brightness, and Pixel and Jitter read Bass and Treble. When the Experimental effects were reworked, Flare and Gale were rebuilt for Thorn and Slipstream. Every preset was looked at on Arial and Georgia in silence, in a full mix, at a beat peak, and at full loudness: the letters stay readable.

## 8. Architecture and performance

- **New code in `src/sound/`:**
  - `types.ts`: shared types, limits, and the silent feature frame.
  - `engine.ts`: the Web Audio graph and its sources, with the stereo measuring branch (§4).
  - `useSound.ts`: React hooks for the engine and its frames.
  - `features.ts`: feature extraction from spectrum, samples, and the left and right channels (testable without audio).
  - `mapping.ts`: the features (`FEATURES`, in five groups), the targets (sliders and seeds, each with what it needs to act and the changes that switch it on, `activate`), and slider values + features + mappings + jumps → live parameters (`modulate`, a pure function).
  - `jumps.ts`: `JumpTracker`, which counts the jumps of each driven seed from the measured frames and keeps them to the flash limit, and `JUMP_LIMITS` (pure, testable without audio).
  - `mappingStore.ts`: a small store, with a hook, for the mappings and the Drive letters switch; it follows `prefers-reduced-motion` while the page is open.
  - `presets.ts`: the presets (`PRESETS`, §7), each with its name, the one line its ⓘ shows, its start values, and its mappings; and `presetSettings` (pure), which gives what Load leaves: the settings (every Geometry and Experimental group reset, seeds kept, then the start values), the groups that changed, and the notice.
  - `live.ts`: frame timing (`LiveScheduler`, testable through injected dependencies, which owns the `JumpTracker`), the flash limit (`FlashLimiter`), the hooks for live parameters, live marker positions, live seeds (`useLiveSeed`) and the live status, and Freeze. The marker itself is `src/components/LiveMarker.tsx`, and the live seed beside a seed field is `src/components/LiveSeed.tsx`.
- **Pipeline unchanged; live requests carry a `live` flag.** Live parameters go to the geometry worker as compute requests marked `live`, and the worker already drops a superseded request between glyphs. The flag only keeps live results in the separate live cache (below); the geometry is computed the same way. On the page, a live frame's results are held until its request is done, so each frame appears whole (§2).
- **What follows the live parameters:** the letters, the snap grid drawn on the canvas, and the status bar's description. What keeps the slider values: the sliders, exports, and Fit text and Free in the Typography tab, which measure the slider letters, as exports do.
- **Adaptive frame rate:**
  - Features update every animation frame.
  - At most one geometry request is in flight; the next is sent when the last one finishes, so the frame rate follows the cost.
  - The rate is capped at 30 fps, and the Sound tab shows it.
  - Below about 8 fps it suggests lighter settings or a shorter text.
- **Quantised live values:** each value is rounded to its slider's step (seeds are whole numbers already), so repeated values hit the geometry cache instead of recomputing.
- **Separate live cache:** live frames use a small cache of their own (about 600 entries), so a song does not evict the cached results of normal editing.
- **Scope:** only the glyphs in the text and the selected glyph are computed, as today.
- **Idle audio:** the audio context is created inside the first user gesture that needs it (choosing a file or a source, Play, Start listening), suspended after 2 s with nothing playing or listening, and resumed by Play and Start listening. Caveat: in Safari, playback restarted by media keys after that may stay silent until the user presses Play.
- **Measured cost:**
  - Geometry alone takes roughly 0.1 ms per glyph.
  - All Experimental effects folding at once take up to about 20 ms per glyph, too heavy for live use with a long text.
  - Live frames, measured in the worker (Node, Arial, the default text's 24 distinct glyphs, 30 frames while the feature sweeps): Level → Distortion · Noise amplitude about 2.6 ms, Level → Crumple Amount 7.4 ms, Bass → Ripple Petals 6.2 ms, and all three together 12.3 ms, all at the 30 fps cap. With Crumple, Ripple, Whorl and Slipstream all on, a frame takes about 41 ms (about 24 fps). A repeated value hits the cache in under 0.1 ms, and placing the glyphs and laying out the artboard on the page takes about 0.3 ms per render. Measured again with phase 3 in place, the same within run-to-run noise: 2.4 ms, all three 12 ms, and everything on 37–41 ms (24–27 fps). The Experimental figures were measured before the rework of Crumple, Slipstream, and Thorn (EXPERIMENTAL_PLAN §4.9), which made each heavier (about 0.6–0.9 ms per glyph at its defaults); they have not been measured live again.
  - A seed jump is a new parameter set, so every distinct glyph is computed again: about 2–3.5 ms per jump frame in the worker (same setup, Beat → each of the three seeds), well within the 30 fps cap.
  - Feature extraction (`process`, Node, 48 kHz) went from about 35 µs to about 90 µs per frame with the phase 3 features, mostly Pitch, and stayed there (89–93 µs on a music-like mix) after they were merged into 10; counting the jumps takes under 1 µs.
  - On the page, the controls of the Geometry and Experimental tabs and the glyph list skip live frames unless their own statistics change (`React.memo`): in a production build (Arial, default text, Noise amplitude driven), the page's JavaScript per live frame fell from about 5.3 ms to about 4.5 ms. The live seed beside a field subscribes on its own (`LiveSeed`), so those controls get no new props; only Distortion and Random anchors also re-render when their live seed changes, for their statistics.
  - Not measured yet: copying the results to the page and redrawing the SVG every frame, which is the main-thread risk. Measure it in the browser (still to do in phase 3), and switch the live view to canvas drawing only if it limits the frame rate.

## 9. Freeze, export, and repeatability

- **Freeze** writes the live values on screen into the sliders, and the live seeds on screen into the seed fields, and pauses the sound (it pauses the file or stops listening), so the frozen look stays on screen. It is then ordinary, repeatable settings; press Play or Start listening to go on. It is available whenever Sound drives the letters (it does not blink with the beat); pressed while the letters match the sliders, for example between two drum hits, it only pauses.
- Exports (SVG, PNG, OTF) always use the slider values, never live audio. While Sound is live, the Export dialog says so and points to Freeze.
- Live output depends on timing and is not repeatable; frozen settings are.
- Video recording is later.

## 10. Safety and accessibility

- **Flashing:** fast swings can flash (the WCAG three-flashes threshold).
  - Continuous mappings (built): a driven slider may turn back by 10% or more of its travel at most 6 times (3 flashes) in any second. Turns are counted on the slider positions as shown, after rounding to the step, over 1.25 s, so frames that reach the screen a little later still keep to the limit. A further turn keeps the slider's last value until the window has passed; the held value is one the slider produced a moment ago (§2), and the markers and Freeze use it too.
  - Beat on a slider is a continuous mapping too, so the same limit holds its pulses.
  - Seeds (built): at most 6 jump frames in any 1.25 s, all seeds that jump in the same frame counting once: 3 flashes a second, counted the same way as the sliders. A jump over the limit is skipped, not put off, since a late jump would no longer follow the sound. With other features, 4.8 jumps a second (at Rate 100% and the feature at 1) is the most the limit allows on average.
  - Pausing, stopping, or turning Drive letters off returns the seeds to their fields' values (exact restore), and playing again starts from them. The jump window is kept across that, and the return itself counts as a jump frame when a seed had moved, so a quick pause and play cannot let a second burst through.
  - On the test track, Beat → Distortion · Seed jumps 1.89 times a second on the kick alone (the beat rate) and is held to about 4.3–4.5 a second on 8 beats a second, with at most 6 seed changes on screen in any second.
- **Reduced motion:** with `prefers-reduced-motion`, **Drive letters** starts off (the meters still work) and the Sound tab says why; turning reduced motion on while the page is open switches it off too.
- **Microphone:** only on an explicit click, with a visible indicator, released when stopped.
- **No network:** nothing is uploaded, and no audio leaves the browser.

## 11. Interface

All labels are in English and short, with explanations behind ⓘ.

- A third tab, **Sound**, beside Geometry and Experimental. The chosen tab is remembered as now.
- **Source:** File / Microphone, File by default (there is no Off). File has Choose file, play/pause, Loop, position, and the file name. Microphone has Start listening / Stop listening and the active indicator; choosing it pauses the file, and choosing File releases the microphone.
- **Meters** (the Levels group):
  - One compact line per feature (label, bar, number), under a small heading for each of the five groups, each heading with an ⓘ that explains its meters in plain words.
  - The numbers: Level in dB, Pitch in Hz ("—" in silence), Pan as the side it leans to ("L 40", "R 40", or "C" within 5% of the centre), the rest in percent; "—" while nothing plays. Pan's bar fills from the centre, to the left or to the right.
  - Beat is a pulse bar: it jumps to full on each onset and falls back. It replaces the earlier lights and, like every bar, moves without transitions, so it works the same with reduced motion.
  - The bars move every frame, the numbers at most 10 times a second, and the values screen readers get at most 4 times a second.
- **Sensitivity** (input gain) and **Smoothing** (release).
- **Drive letters:** an on/off switch (a checkbox with `role="switch"`, drawn as a small track and knob in the theme's colours); sound moves the letters only while it is on. With reduced motion it starts off and says why (§10).
- **Mappings:**
  - **Preset** and **Load**, above the rows, with an ⓘ that says what Load resets and lists each preset with one line. Choosing in the list only selects, so browsing it with the keyboard replaces nothing; Load applies the preset (§7). Under the row, a status line says what the last Load did ("Loaded X. Turned off …. Other Geometry and Experimental settings back to defaults (seeds kept)."), until the next Load or until another preset is chosen in the list.
  - Each row has Feature (grouped like the meters), Target (grouped: Geometry / Experimental; options read "Section · Label", or just "Seed" for the Experimental seed), Depth, and on/off. On a seed, Depth reads **Rate**, 0–100% in steps of 5%, with an ⓘ. The row's controls are named with its number ("Remove mapping 2"), and a note under a row whose target does nothing now is the Target's description.
  - Under a row: the notice of what picking its target switched on, kept until the row's target changes; or, while its target does nothing, why, with **Enable** ("Enable, mapping 2" to screen readers).
  - **Add mapping** and a remove button on each row. Removing a row hands keyboard focus to the next row's remove button (else the previous one's, else Add mapping).
- **Freeze** and **Reset sound**.
- **Status bar:** shows "Live · N fps" while Sound drives the letters.
- **Driven sliders:** show the live marker. **Driven seed fields:** show the live seed beside the field, in the marker's colour.

## 12. Verification

- **Features:** synthetic signals:
  - Silence gives 0 and no beats.
  - A 100 Hz tone reads as Bass and dark; a 5 kHz tone as Treble and bright.
  - Clicks at 120 BPM give about 2 beats per second.
  - White noise reads bright.
  - The level rises with amplitude.
  - Phase 3 (checked; 18 checks, run again after the features were merged into 10): silence and −90 dBFS noise give 0 for every feature; tones at 40 and 100 Hz fill Bass, 700 Hz Mids, and 5 and 10 kHz Treble, each leaving the other two bands at 0, and a band's running maximum halves every 3 s; Pitch puts 110–880 Hz sines and sawtooths within 0.1% of their place on the scale (at 16, 32, 44.1, 48, and 96 kHz), and noise after a note holds it; clicks at 2 a second give Beat pulses of 1 that fall back with the release time, and Activity peaks above 0.6 on each click and stays near Pace's 0.25 between them, also at 120 fps; every bass drum fires Beat; on long steady sounds (a 110 Hz sawtooth, a chord, white or pink noise) Change lifts Activity at most 0.15 above Pace (on the test track: about 0.43 on the chord section, 0.91–1 on the hi-hat sections); left only and right only read Pan −1 and 1, mono and unrelated left and right noise read 0; Swell rises and falls with its own 300 ms and 2 s.
- **Modulation:** Depth 0 or switched off gives the slider value; values are clamped; several contributions add; targets in a switched-off group do nothing; Beat falls back over the release time; Step cycles; the rate limit holds; a 4/s beat on full Depth swings a slider at most 6 times in any second, with every value on the slider's grid.
  - Phase 3 (checked): the 10 features in their groups; for each of the 43 targets over 3000 random parameter sets (Refraction varied too), it needs nothing switched on exactly when it acts, its changes make it act, and they touch nothing else; the seven targets of the reworked effects read as the panel shows them when older settings lack them, and Flute width's notices are right with Thorn and Refraction in every state; seeds wrap past the largest seed to 0 and never move a slider; Beat at Rate 100%, 50%, and 25% jumps on every, every other, and every fourth beat; Level 1 at Rate 100% gives about 4.8 jumps a second; beats at 16 a second never give more than 6 jump frames in any 1.25 s; a 2 s stall gives at most one jump; pausing returns to the field's seed, and Freeze writes the live seed shown.
- **No curves and validity:** every live frame is an ordinary parameter set, already covered by the existing audits. In addition, log the parameter sets a test track visits and run them through the validity and curve-like audits on Arial, New York, and Georgia. Phase 3 (checked): over the whole test track, with mappings on seeds and sliders, every one of 878 live commits is a set the panel can produce (slider values on their steps, whole seeds within range), and each seed change moves on by exactly one.
- **Engine:** with the Web Audio nodes mocked, the stereo branch is wired as in §4, nothing measuring reaches the speakers, and a torn read is read again or held. In Chromium, with the reads probed back to back, torn reads did occur, and none reached the features after the check.
- **Controls:** every target has exactly one live marker (a slider) or live seed (a seed) in the panel, in `TARGETS` order.
- **Performance:** frame rate with each preset on short and long texts, and with heavy settings.
- **Test track** (`test-audio/sound-test.wav`, 42 s, 16-bit stereo, 44.1 kHz): 0–26 s as before, the same in both channels (kick only 0–4 s, kick and hi-hats 4–8 s, a rising chord 8–12 s, silence 12–15.5 s, the full mix fading 15.5–21.5 s, hi-hats at 16 a second 21.5–26 s); 26–32 s a single-note melody A2 → A5 and back, for Pitch; 32–38 s hi-hats switching hard left and hard right every half second over a quiet bass in the centre, for Pan; 38–42 s wide, unrelated noise fading out (Pan stays centred). It reads as planned: the first 26 s as before (Beat about 2 a second on the kick alone; Activity about 0.38 on the kick alone and 0.91–1 with hi-hats), Pitch 110, 220, 440, 880 Hz with the melody, Pan about ±0.5 each half second.
- **In the browser:** a local test file and the microphone, with no downloads. Check that pausing, stopping listening, or turning Drive letters off restores the sliders exactly, and check Freeze followed by Export. Phase 3 (checked): browsing the Target list with the keyboard switches nothing on until Enter or leaving the list, and a pick with the pointer switches on at once.
- **Docs:** README, User Guide, and PRD in English and Chinese, in separate files.

## 13. Phases

| Phase | Content |
|---|---|
| 1 | Sound tab; audio engine (File, Microphone); features Level, three bands (now Bass, Mids, Treble), Brightness, and Beat with a kick detector; meters |
| 2 | Modulation layer, mappings for continuous targets, adaptive live scheduler with its own cache, live slider markers, flash limit for continuous mappings, Freeze |
| 3 | Built: seeds as jump targets with Rate, their flash limit, and the live seed beside the field; Beat pulses on sliders; 13 more features with the stereo measuring branch, then merged with the first ones into 10 in five groups (§4); compact meters; targets that switch on what they need, with a notice and Enable; the 42 s stereo test track; ten presets with Preset and Load, where Load resets the Geometry and Experimental settings (seeds kept), sets the preset's start values, and says what it turned off; Distortion's few anchors mode for Flicker; File as the default source, with no Off, and Drive letters as a switch; seven targets for the reworked Experimental effects (43 in all), with Flare and Gale rebuilt for them. Still to do: Step mappings (Allowed directions, Sides, Rings); live SVG redraw measurement |
| 4 | Pitch and stereo (Pan): built in phase 3, with the other new features |
| Later | Video recording |

Each phase ends with the checks in section 12 and is shipped on its own.
