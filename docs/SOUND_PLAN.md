# Sound plan

**English** · [中文](SOUND_PLAN.zh.md)

**Status:** Phases 1 (sources, features, meters) and 2 (continuous mappings, live scheduler, live markers, flash limit, Freeze) built  
**Scope:** A new **Sound** tab beside **Geometry** and **Experimental**. Live sound (a local audio file or the microphone) drives the parameters that already exist in both tabs, so the letters move with the music: anchors jump on the beat, outlines crumple when it gets loud, petals open on the bass.

## 1. Goals

- Sound drives **existing parameters only**, in both the Geometry tab (Curve flattening, Random anchors, Squaring, Anchors, Grid & angles, Distortion) and the Experimental tab (Noise, Ripple, Curl, Wind, Seed). There are no new deformation operators.
- Two kinds of drive:
  - **Continuous:** a feature such as loudness moves a slider up and down.
  - **Events:** a beat makes something jump, such as a new seed (the anchors jump to new places) or a step to the next angle.
- It runs live, at a frame rate that adapts to how heavy the settings are.
- Audio stays in the browser: decoded and analysed locally, never uploaded.
- Switching Sound off restores the slider values exactly.

This replaces the earlier "Sound-driven carved letterforms" direction (PRD section 11). That direction planned new carving operators, a timeline, audio spread across the letters of a text, and recipe export; those are dropped.

## 2. Highest rule: no curves

Sound changes nothing but parameter values, and only within each slider's own range. Every frame on screen is therefore a result the sliders could produce by hand, computed by the same pipeline: it keeps straight edges only, it is validated like every other result, and it can be exported. Frames are shown one after another as they are computed. There is no tweening or morphing between frames, which would invent in-between outlines the pipeline never made.

## 3. Sound sources

- **Off** (the default).
- **File:** any audio file the browser can decode (WAV, MP3, AAC, OGG, FLAC, depending on the browser). It has play, pause, loop, and a position slider, and plays through the speakers.
- **Microphone:** starts only when the user presses **Start listening**, after the browser asks for permission; choosing **Microphone** only shows that button. It is not played back, so there is no feedback loop. Stop listening, switching source, and closing the tab release the microphone, and an indicator shows while it is active.
- Invalid, empty, silent, and unsupported input each get their own message.

## 4. Audio features

The features are computed every animation frame from a Web Audio `AnalyserNode`: a 2048-point FFT at 44.1 and 48 kHz (doubled at 88.2 and 96 kHz, so the window stays about 43 ms), with time-domain samples for the level. A 20 Hz high-pass in front of the analyser removes DC offset from what is measured.

| Feature | Definition | Normalised to 0–1 |
|---|---|---|
| **Level** | Short-time RMS (DC offset removed), in dB | −60 dB → 0, 0 dB → 1, shifted by **Sensitivity** |
| **Low** | Energy 20–250 Hz | Against a slowly adapting running maximum |
| **Mid** | Energy 250–2000 Hz | Same |
| **High** | Energy 2000 Hz – Nyquist | Same |
| **Brightness** | Spectral centroid of 20 Hz – 20 kHz, on a log-frequency scale | 100 Hz → 0, 8 kHz → 1 |
| **Beat** (event) | Onset: spectral flux above an adaptive threshold (the median of the last second × a factor, plus a floor, and at least half the last onset's flux as it decays, so a hit's own tail does not fire again), at least 100 ms apart. A low-band variant (**Kick**) reacts to sudden bass, mostly the bass drum; every Kick also counts as a Beat. | — |

Phase 4 adds **Pitch** (YIN, with confidence; unvoiced or low-confidence frames hold the last value instead of jumping) and **Balance** (left/right, files only).

- **Smoothing:** each continuous feature follows the sound with a fast attack (10 ms) and a slower release (default 150 ms, set with **Smoothing**), so the letters react at once but do not flicker.
- **Silence gate:** below the silence threshold, continuous features fall to 0 and no beats fire. A band whose own energy is below the silence threshold reads 0, even while another band is loud.
- **Sensitivity** also scales the magnitudes the onset flux compares, ln(1 + 1000 g m) with g = 10^(Sensitivity / 20), so it reaches Beat and Kick too. This differs from the first spec's formula, ln(1 + 1000 m), where Sensitivity could not help a quiet source's onsets.
- Onsets are judged at most about 60 times a second, so the thresholds mean the same on 120 Hz and faster displays.
- Zero denominators are handled and outliers are clamped.

## 5. Mappings

A mapping connects one feature to one target parameter. The Sound tab holds up to 8 mappings, each with an on/off switch.

- **Continuous mapping** (Level, Low, Mid, High, Brightness, Pitch, Balance → any slider):
  - live position = slider position + **Depth** × feature, clamped to the slider's ends, then rounded to the slider's step. Positions are measured along the slider as drawn (0–1), so on an ordinary slider this is slider value + Depth × feature × the slider's full range, and a log-scaled slider such as Tolerance moves evenly along its track.
  - Depth runs from −100% to 100%. Negative Depth turns it down as the sound gets louder.
- **Event mapping** (Beat or Kick → target), with three kinds:
  - **Jump:** a seed moves on by one on every beat, so anchors, folds, or gusts jump to new places.
  - **Step:** a value with a few choices moves to the next one on every beat, for example Allowed directions (the angle step) 15° → 30° → 45° → 90°, Sides, or Rings.
  - **Kick:** the value leaps by Depth on the beat and falls back to the slider value over the release time. This makes a pulse rather than a permanent change.
- **Several mappings on one target:** their contributions add up, then the sum is clamped. Each row names its target, and the driven slider's marker shows the combined live value.
- **Base values stay put:**
  - The sliders keep their own values and do not move while Sound is live; a thin marker on each driven slider shows the live value.
  - Depth 0 or a switched-off mapping gives exactly the slider value.
  - A mapping to a step or effect that is switched off (Random anchors, any Experimental effect) does nothing, and its row says so.

## 6. Targets

**Geometry tab**, where "anchor jumping" lives:

| Target | Suggested drive | What you see |
|---|---|---|
| Distortion **Seed** | Beat → Jump | Every anchor jumps to a new place on the beat |
| Distortion · **Noise amplitude** | Level, or Beat → Kick | Anchors shake harder when loud, or kick out on the beat and settle |
| Distortion · **Noise frequency** | Brightness | Brighter sound gives a finer, jitterier edge |
| Random anchors **Seed** | Beat → Jump | The anchors are re-sampled at new positions on every beat |
| Random anchors **Randomness** | Level | Loud: anchors scatter; quiet: they line up evenly |
| Random anchors **Density** | Low, stepped | Fewer, chunkier anchors on the bass |
| Curve flattening · **Tolerance** | Level | Loud passages get coarser, more polygonal |
| **Squaring** amount | Mid | Bowls square off with the voice |
| Anchors · **Anchor spacing** / **Anchor reduction** | High / Level | Anchors densify or drop out |
| **Grid** size | Low, stepped | Snaps to a coarser grid on the bass |
| Grid & angles · **Allowed directions** (the angle step) | Beat → Step | Edges lock to 15°, 30°, 45°, 90° in turn |

Also targets, with no suggested drive: Curve flattening · Segments per curve and Corner angle, and Distortion · Normal bias. The full list, in panel order, is `TARGETS` in `src/sound/mapping.ts` (README, Targets). The seeds and Allowed directions become targets with event mappings in phase 3.

**Experimental tab**: Noise Amount / Facet size / Turn; Ripple Amount / Wavelength / Sides / Center X / Center Y / Fade / Petals; Curl Amount / Rings / Sides; Wind Direction / Strength / Gust size / Gustiness; and the shared **Seed** (Beat → Jump, phase 3).

Switches (Use noise, Pin top and bottom, and so on) and the Curve flattening Mode are not targets: sound never turns a step on or off.

## 7. Presets

Presets are starting points that fill in the mappings:

- **Anchor jump:** Beat → Distortion Seed (Jump); Level → Distortion · Noise amplitude (Depth 30%).
- **Resample:** Beat → Random anchors Seed (Jump); Level → Randomness.
- **Bass bloom:** Kick → Ripple Amount (Kick); Low → Ripple Petals.
- **Shiver:** High → Noise Amount; Brightness → Noise Turn.
- **Whirl:** Level → Curl Amount; Beat → Experimental Seed (Jump).
- **Grid pulse:** Low → Grid size (stepped); Beat → Allowed directions (Step).

## 8. Architecture and performance

- **New code in `src/sound/`:**
  - `types.ts`: shared types, limits, and the silent feature frame.
  - `engine.ts`: the Web Audio graph and its sources.
  - `useSound.ts`: React hooks for the engine and its frames.
  - `features.ts`: feature extraction from spectrum and samples (testable without audio).
  - `mapping.ts`: the targets, and slider values + features + mappings → live parameters (`modulate`, a pure function).
  - `mappingStore.ts`: a small store, with a hook, for the mappings and the Drive letters switch; it follows `prefers-reduced-motion` while the page is open.
  - `live.ts`: frame timing (`LiveScheduler`, testable through injected dependencies), the flash limit (`FlashLimiter`), the hooks for live parameters, live marker positions and the live status, and Freeze. The marker itself is `src/components/LiveMarker.tsx`.
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
- **Idle audio:** the audio context is suspended after 2 s with nothing playing or listening, and Play and Start listening resume it. Caveat: in Safari, playback restarted by media keys after that may stay silent until the user presses Play.
- **Measured cost:**
  - Geometry alone takes roughly 0.1 ms per glyph.
  - All Experimental effects folding at once take up to about 20 ms per glyph, too heavy for live use with a long text.
  - Live frames, measured in the worker (Node, Arial, the default text's 24 distinct glyphs, 30 frames while the feature sweeps): Level → Distortion · Noise amplitude about 2.6 ms, Level → Noise Amount 7.4 ms, Low → Ripple Petals 6.2 ms, and all three together 12.3 ms, all at the 30 fps cap. With Noise, Ripple, Curl and Wind all on, a frame takes about 41 ms (about 24 fps). A repeated value hits the cache in under 0.1 ms, and placing the glyphs and laying out the artboard on the page takes about 0.3 ms per render.
  - On the page, the controls of the Geometry and Experimental tabs and the glyph list skip live frames unless their own statistics change (`React.memo`): in a production build (Arial, default text, Noise amplitude driven), the page's JavaScript per live frame fell from about 5.3 ms to about 4.5 ms.
  - Not measured yet: copying the results to the page and redrawing the SVG every frame, which is the main-thread risk. Measure it in the browser in phase 3, and switch the live view to canvas drawing only if it limits the frame rate.

## 9. Freeze, export, and repeatability

- **Freeze** writes the live values on screen into the sliders and pauses the sound (it pauses the file or stops listening), so the frozen look stays on screen. It is then ordinary, repeatable settings; press Play or Start listening to go on. It is available whenever Sound drives the letters (it does not blink with the beat); pressed while the letters match the sliders, for example between two drum hits, it only pauses.
- Exports (SVG, PNG, OTF) always use the slider values, never live audio. While Sound is live, the Export dialog says so and points to Freeze.
- Live output depends on timing and is not repeatable; frozen settings are.
- Video recording is later.

## 10. Safety and accessibility

- **Flashing:** fast swings can flash (the WCAG three-flashes threshold).
  - Continuous mappings (built): a driven slider may turn back by 10% or more of its travel at most 6 times (3 flashes) in any second. Turns are counted on the slider positions as shown, after rounding to the step, over 1.25 s, so frames that reach the screen a little later still keep to the limit. A further turn keeps the slider's last value until the window has passed; the held value is one the slider produced a moment ago (§2), and the markers and Freeze use it too.
  - Event mappings (phase 3): beat-driven jumps are limited to at most 3 per second by default.
- **Reduced motion:** with `prefers-reduced-motion`, **Drive letters** starts off (the meters still work) and the Sound tab says why; turning reduced motion on while the page is open switches it off too.
- **Microphone:** only on an explicit click, with a visible indicator, released when stopped.
- **No network:** nothing is uploaded, and no audio leaves the browser.

## 11. Interface

All labels are in English and short, with explanations behind ⓘ.

- A third tab, **Sound**, beside Geometry and Experimental. The chosen tab is remembered as now.
- **Source:** Off / File / Microphone. File has Choose file, play/pause, Loop, position, and the file name. Microphone has Start listening / Stop listening and the active indicator.
- **Meters:**
  - Level, Low, Mid, High, and Brightness bars.
  - Beat and Kick lights, kept even with reduced motion.
- **Sensitivity** (input gain) and **Smoothing** (release).
- **Mappings:**
  - Each row has Feature, Target (grouped: Geometry / Experimental), Depth, and on/off; event targets also show their kind (Jump / Step / Kick). The row's controls are named with its number ("Remove mapping 2"), and a note under a row whose target does nothing now is the Target's description.
  - **Add mapping**, **Presets** (phase 3), and a remove button on each row. Removing a row hands keyboard focus to the next row's remove button (else the previous one's, else Add mapping).
- **Freeze** and **Reset sound**.
- **Status bar:** shows "Live · N fps" while Sound drives the letters.
- **Driven sliders:** show the live marker.

## 12. Verification

- **Features:** synthetic signals:
  - Silence gives 0 and no beats.
  - A 100 Hz tone reads as Low and dark; a 5 kHz tone as High and bright.
  - Clicks at 120 BPM give about 2 beats per second.
  - White noise reads bright.
  - The level rises with amplitude.
- **Modulation:** Depth 0 or switched off gives the slider value; values are clamped; several contributions add; targets in a switched-off group do nothing; Kick falls back over the release time; Step cycles; the rate limit holds; a 4/s kick on full Depth swings a slider at most 6 times in any second, with every value on the slider's grid.
- **No curves and validity:** every live frame is an ordinary parameter set, already covered by the existing audits. In addition, log the parameter sets a test track visits and run them through the validity and curve-like audits on Arial, New York, and Georgia.
- **Performance:** frame rate with each preset on short and long texts, and with heavy settings.
- **In the browser:** a local test file and the microphone, with no downloads. Check that Off restores the sliders exactly, and check Freeze followed by Export.
- **Docs:** README, User Guide, and PRD in English and Chinese, in separate files.

## 13. Phases

| Phase | Content |
|---|---|
| 1 | Sound tab; audio engine (File, Microphone); features Level, Low, Mid, High, Brightness, Beat, Kick; meters |
| 2 | Modulation layer, mappings for continuous targets, adaptive live scheduler with its own cache, live slider markers, flash limit for continuous mappings, Freeze |
| 3 | Event mappings (Jump, Step, Kick), their rate limit, presets; live SVG redraw measurement |
| 4 | Pitch and Balance |
| Later | Video recording |

Each phase ends with the checks in section 12 and is shipped on its own.
