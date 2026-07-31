# S-1 Implementation Plan — Roland AIRA Compact S-1 support for t8live/t8strudel

**Version 0.1.0** · Research + planning only, no code changes · 2026-07-29

---

## AI READING INSTRUCTION

Written in [HADS](https://codeberg.org/catcam/t8live) format, matching this repo's convention
(see `README.md`, `TODO.md`). `[SPEC]` = verified fact, cite source. `[NOTE]` = context. `[?]` =
unverified / open question, do not treat as fact.

---

## 1. What real, verified S-1 MIDI capability exists

**[SPEC]** Source: Roland's own official MIDI implementation chart, fetched directly from
`https://static.roland.com/manuals/s-1_manual_v102/eng/87294690.html` (AIRA Compact S-1, MIDI
implementation chart version 1.02, dated Apr. 18, 2023 — part of the official S-1 Owner's Manual).
This is the real chart, not a paraphrase — every number below was read out of that page's table.

### 1.1 Channels
- Transmitted: channel 3 (Synth) and channel 16 (Program Change) — same split pattern the T-8
  already uses (rhythm=10, bass=2, PC=16 — see `t8.mjs`). S-1 uses ch 3 for its single synth voice
  instead of two separate voice channels, because it's monophonic/one sound engine, not a drum kit.
- Recognized: channels 1–16, memorized (persists across power cycles, same as T-8).

### 1.2 Mode / Note data
- Mode 3 (Omni Off, Poly) is both default and the only mode — "altered" column is `x` (can't be
  changed to another mode).
- Note number range 0–127, true voice 0–127 (no internal transposition/remapping to worry about,
  unlike T-8's `t8drum` name→note mapping).
- Velocity: Note On recognized (`o`), Note Off velocity NOT recognized (`x`) — matches T-8's
  documented behavior in `t8.mjs`'s JSDoc for its own notes ("Note Off velocity not transmitted").
- Aftertouch (key's and channel's): not supported in either direction.
- Pitch Bend: recognized (`o`), not transmitted (`x`) — S-1 accepts incoming pitch bend on ch 3.

### 1.3 Control Change — full parameter list (verbatim from the chart's "Control change list")

| CC # | Parameter |
|---|---|
| 1 | Modulation Wheel |
| 3 | LFO RATE |
| 5 | PORTAMENTO TIME |
| 10 | Pan |
| 11 | Expression Pedal |
| 12 | LFO WAVE FORM |
| 13 | OSC LFO |
| 14 | OSC RANGE |
| 15 | OSC PULSE WIDTH (PWM depth) |
| 16 | OSC PWM SOURCE |
| 17 | LFO MODULATION DEPTH |
| 18 | OSC BEND SENS |
| 19 | OSC LEVEL |
| 20 | OSC LEVEL (second OSC) |
| 21 | OSC SUB OSC LEVEL |
| 22 | OSC SUB OCT TYPE |
| 23 | OSC NOISE LEVEL |
| 24 | FILTER ENVELOPE (depth) |
| 25 | FILTER LFO (depth) |
| 26 | FILTER KEYBOARD FOLLOW |
| 27 | FILTER BEND SENS |
| 28 | AMP ENVELOPE MODE SW |
| 29 | ENV TRIGGER MODE |
| 30 | ENV SUSTAIN |
| 31 | PORTAMENTO MODE |
| 64 | Damper Pedal |
| 65 | PORTAMENTO (on/off) |
| 71 | FILTER RESONANCE |
| 72 | ENV RELEASE |
| 73 | ENV ATTACK |
| 74 | FILTER FREQUENCY (cutoff) |
| 75 | ENV DECAY |
| 76 | FINE TUNE |
| 77 | TRANSPOSE SW |
| 78 | NOISE MODE |
| 79 | LFO MODE |
| 80 | POLY MODE |
| 81 | CHORD VOICE 2 SW |
| 82 | CHORD VOICE 3 SW |
| 83 | CHORD VOICE 4 SW |
| 85 | CHORD VOICE 2 KEY SHIFT |
| 86 | CHORD VOICE 3 KEY SHIFT |
| 87 | CHORD VOICE 4 KEY SHIFT |
| 89 | REVERB TIME |
| 90 | DELAY TIME |
| 91 | REVERB LEVEL |
| 92 | DELAY LEVEL |
| 93 | CHORUS |
| 102 | OSC DRAW MULTIPLY |
| 103 | OSC CHOP OVERTONE |
| 104 | OSC CHOP COMB |
| 105 | LFO KEY TRIGGER |
| 106 | LFO SYNC (added in fw 1.02) |
| 107 | OSC DRAW SW |

**[NOTE]** The chart's per-CC Transmitted/Recognized flags got mangled by HTML-table→text
extraction (rowspan/colspan structure was lost when scraping) — I could not cleanly reconstruct
which of these 51 CCs the S-1 *transmits* vs only *recognizes*. What's clear from the raw chart is
that the block is overwhelmingly `o` (supported) on the recognized side. **For a first
implementation, treat every CC above as an outbound (host→S-1) control** — that's the direction
t8live/Strudel cares about anyway (sending patterns out, not reading the S-1's own knob turns back
in), and the "Recognized" column is what governs that. Re-verify against a real S-1 with a MIDI
monitor before relying on the transmit direction for anything (e.g. building a "read current patch
state" feature).

### 1.4 Program Change
- Transmitted/Recognized: `o` / `o`, true number, range 0–63 (S-1 has 64 pattern/patch slots
  addressable by Program Change on channel 16 — same channel the T-8 uses for its own Program
  Change, `T8_PC_CHANGE = 16`).

### 1.5 System Exclusive
- Not supported (`x`/`x`) — no vendor SysEx for deep parameter access beyond the CC list above.
  Whatever's in the CC table above is the entire remotely-controllable parameter surface.

### 1.6 System Real-Time / transport
- Clock: transmitted & recognized (`o`/`o`).
- Start: transmitted & recognized (`o`/`o`).
- Stop: transmitted & recognized (`o`/`o`).
- **Continue: NOT supported in either direction (`x`/`x`)** — this is a real difference from a
  generic MIDI device; don't build a resume-from-pause feature expecting Continue to work.

### 1.7 Aux messages
- All Sound Off: recognized only (`x`/`o`).
- All Notes Off: recognized only (`x`/`o`).
- Active Sensing: transmitted & recognized (`o`/`o`).
- Reset All Controllers, Omni On/Off, Mono/Poly mode switches, System Reset: not supported.

---

## 2. What kind of instrument the S-1 is

**[SPEC]** (Sources: MusicRadar, Sound on Sound, Juno Daily, Synth and Software reviews — cross-
checked, consistent across all of them.)
- 4-voice virtual-analog synth using Roland's Analog Circuit Behavior (ACB) modeling of the
  classic SH-101 architecture: blendable pulse/saw oscillator + sub-oscillator + noise, one
  resonant low-pass filter, one ADSR-ish envelope (attack/decay/sustain/release per CC 71-75), one
  LFO, delay/reverb/chorus send effects.
- **Not monophonic by default** despite the task brief's assumption and the "S-1 monophonic
  synth" framing — the hardware supports 4 polyphony modes: Poly, Mono, Unison, Chord (up to 4
  voices), switchable live via CC 80 (POLY MODE) and the Chord-voice CCs (81-87). Worth flagging
  explicitly since it changes what a "note pattern → S-1" helper needs to handle (chords are a
  first-class use case, not just a monophonic bassline the way `t8bass` treats the T-8's bass
  channel).
- Step sequencer + "OSC DRAW"/"OSC CHOP" wavetable-drawing features on the panel are also exposed
  as CCs (102-104, 107) — real synthesis controls, not just performance macros.

---

## 3. SYnC-mode transport: S-1 vs T-8

**[SPEC]** Confirmed facts:
- AIRA Compact devices sync via three independent paths: analog SYNC IN/OUT jacks (trigger pulses,
  clocks-per-beat configurable at 1/2/3/4/6/8/12/24 via a "SYNC CLOCK"/`S.cLK` menu setting),
  MIDI clock + Start/Stop over MIDI IN/OUT, and USB. (Source: Roland's own "Getting to Know AIRA
  Compact: The Basics" article, `articles.roland.com`.)
- The S-1's own MIDI implementation chart (§1.6 above) confirms it recognizes incoming Clock,
  Start, and Stop — so in principle a continuous clock + Start/Stop stream from Strudel, the same
  shape `t8clock()`/`t8transport()` already produce, should drive the S-1's sequencer/arpeggiator
  the same way it drives the T-8's.
- A real-world anecdote (Elektronauts thread "MIDI issues w/ Roland Aira s1 (solved)") describes a
  user driving an S-1 from an Elektron Syntakt's MIDI clock and seeing "the sequencer moving on the
  S1" — informal but consistent with recognized Clock/Start/Stop working out of the box.

**[SPEC] RESOLVED against real hardware (2026-07-31):** Confirmed possibility #1. Tested directly
with `python-rtmidi` on Nikša's Mac (bypassing the browser entirely — raw MIDI, not `.midi()`),
sending 24 clocks, then Start (0xFA), then 8 beats of continuous Clock (24ppqn @ 120bpm), then Stop
(0xFC), while listening on "S-1 MIDI OUT" for any response. Result: the S-1 began sending Note On
(channel 3, matching the MIDI chart's documented note channel) **0.59s after Start** — a 4-note
chord (consistent with the confirmed 4-voice-polyphonic finding in §1), note-off ~0.2s later, then
another chord just before Stop. **The S-1 follows external MIDI Clock/Start/Stop immediately, no
menu toggle, no equivalent of the T-8's `SYnC=AUTO` requirement.** Test script saved at
`/tmp/s1_sync_test.py` on the Mac for reference/re-run.

**Consequence — settled, not just recommended:** `s1clock()`/`s1transport()` can reuse
`t8clock`/`t8transport`'s exact generation logic (promote to `@strudel/midi` as planned in §5) with
**`autostart` left at Strudel's normal upstream default** — the T-8-specific `autostart: false`
workaround in `packages/midi/midi.mjs` must NOT be applied to the S-1 path. An S-1 owner sending a
bare one-shot Start with a live clock stream will work correctly out of the box.

---

## 4. Existing prior art

**[SPEC]**
- A community-built Pure Data (Pd Vanilla) patch, "Roland AIRA S-1 midi map" by user
  `will-blackhurst` (patchstorage.com, Academic Free License v3.0, 35 downloads, work-in-progress
  status). It maps S-1 knob/CC parameters and note data bidirectionally with Pd, confirming the
  official CC list is usable in practice — but the author explicitly says they have **not** figured
  out how to reach the SHIFT-combo panel functions from MIDI and are still looking for help there.
  This matters directly for §1.3: several CCs in the official chart (e.g. CC 5 PORTAMENTO TIME, CC
  15 OSC PULSE WIDTH, CC 22 SUB OCT TYPE — anything whose panel description includes "[SHIFT]
  button + ...") are reached on the physical panel only via a SHIFT-modified gesture, yet the chart
  lists them as ordinary single CC numbers with no modifier byte. The Pd author's difficulty
  suggests it's worth explicitly testing a SHIFT-labeled CC against real hardware early, in case
  there's an undocumented quirk (e.g. value curve, or a second message needed) — don't assume the
  chart's plain CC-number listing is the complete story for every parameter just because it's the
  official chart.
- No existing JS/Strudel/TidalCycles-specific S-1 integration was found.

---

## 5. Proposed API surface — `@strudel/s1`

**[SPEC]** Package boundary: new `packages/s1/` directory, sibling to `packages/t8/`, same
structure (`s1.mjs`, `package.json`, `test/s1.test.mjs`, registered in `prebake.mjs` /
`website/src/repl/util.mjs` the same way `t8.mjs` is — confirmed via `README.md` §3). Naming
follows the existing convention (`@strudel/t8` despite the fork being branded "t8live" —
`packages/t8/package.json`'s own `name` field), so `@strudel/s1`, not `@strudel/t8live-s1` or
similar.

**Rationale for a separate package rather than folding into `@strudel/t8`:** the T-8 is a drum/bass
groovebox (voice-triggering, pattern-slot-select); the S-1 is a synth-voice/parameter-control
instrument. Their MIDI *shapes* barely overlap (T-8: note-per-drum-voice + PC-for-pattern-slot; S-1:
note-per-pitch + CC-per-parameter + PC-for-patch-slot). Forcing them into one package would mean
either a confusing shared namespace (`t8drum` next to `t8cutoff`?) or prefix soup. A separate
package matches how Strudel itself separates concerns (`@strudel/midi` generic, `@strudel/t8`
device-specific) and lets someone install just the S-1 helpers without pulling in T-8 drum-voice
names that mean nothing for a synth.

**What *should* be shared:** the clock/transport primitives, if and only if §3's open question
resolves toward "S-1 behaves like T-8 needs the same treatment." Proposed shared home: a new small
internal module, e.g. `packages/midi-transport-helpers/` (or just promote `t8clock`/`t8transport`'s
guts into `@strudel/midi` itself as generic `midiClockStream()`/`midiTransport()` helpers that both
`t8.mjs` and `s1.mjs` then wrap with device-specific channel/default choices). Don't duplicate the
same clock-generation logic in two files — that's exactly the kind of copy-paste this repo's own
`t8.mjs` warns against repeating (see its JSDoc's own reasoning for why `t8select` throws
immediately but `t8drum` doesn't — deliberate, don't blur the two packages' identical-looking code
until it's actually forked for a real reason).

### Proposed functions

| Function | Purpose | Channel | Confidence |
|---|---|---|---|
| `s1note(pattern)` | Thin wrapper setting channel 3 on a note pattern (S-1's synth channel), analogous to `t8bass` — standard note names/numbers pass through unchanged (chart confirms true voice 0-127, no remapping) | 3 | High — directly off the verified chart |
| `s1cc(name \| ccNumber, valuePattern)` | Named-parameter CC helper, e.g. `s1cc('cutoff', sine.slow(4))` instead of raw `.ccn(74).ccv(...)`. Needs a name→CC lookup table built from §1.3's list (`cutoff: 74, resonance: 71, attack: 73, decay: 75, release: 72, lfoRate: 3, ...`) | n/a (CC-level, channel set via `.midichan(3)` or left to caller) | High — table is the verified chart, just needs mapping decisions (naming) |
| `s1select(patch)` | Program Change 0-63 on channel 16, single integer arg (no bank/pattern split like `t8select` — S-1's chart shows a flat 0-63 range, not `t8select`'s bank×pattern structure) | 16 | High |
| `s1polyMode(mode)` | Sets CC 80 to switch among Poly/Mono/Unison/Chord — needs the exact value-per-mode mapping, which the chart doesn't spell out (just says "POLY MODE" for CC 80) | n/a | **Low — needs hardware verification of the CC 80 value curve/discrete steps before shipping** |
| `s1clock(ticksPerCycle)` / `s1transport(...)` | Mirrors `t8clock`/`t8transport`, ideally sharing implementation per §3's shared-helper proposal | n/a | Medium — mechanism (Clock/Start/Stop shape) is verified; whether S-1 needs T-8's `autostart` workaround is not |

**Explicitly NOT proposed for v1:** anything requiring SysEx (§1.5 confirms none exists) or reading
back current patch state (Transmitted-direction CC data is unverified per §1.3's note, and there's
no SysEx patch dump to fall back on either).

**Naming table for `s1cc`** should be built directly from §1.3's table using the chart's own
capitalized names lowercased/camelCased (`FILTER FREQUENCY` → `filterFrequency`, with maybe a short
alias `cutoff`) rather than invented names, to stay traceable back to the source chart — avoids the
kind of drift where a helper's friendly name no longer obviously maps to a specific CC number six
months later.

---

## 6. Test plan

**[SPEC]** Follow `t8.test.mjs`'s existing approach exactly — this repo already learned (per
`TODO.md`'s "Code review (2026-07-26)" entry) that calling functions directly with plain values
misses real transpiler/mini-notation bugs; `t8.test.mjs`'s own header comment explains why it
builds patterns with `mini()` the same way the real transpiler auto-wraps string literals.

For `@strudel/s1`:
- `s1note`: verify a mini-notation note pattern (`mini('c3 eb4 g3')`) round-trips through
  `s1note(...)` with `midichan === 3` and note values unchanged, mirroring `t8bass`'s test.
- `s1cc`: verify a named lookup (`s1cc('cutoff', ...)`) produces the same haps as the raw
  `.ccn(74).ccv(...)` equivalent, plus a test for an unknown parameter name (should fail loud like
  `t8select`'s out-of-range check, not silently swallow like `t8drum`'s unknown-voice case — a
  wrong CC number sent to real hardware is a worse failure mode than a wrong note, since it could
  silently detune/mute the instrument rather than just skip a hit).
- `s1select`: mirror `t8select`'s three tests (in-range value, boundary at 0, out-of-range throws
  immediately) but for a flat 0-63 range instead of bank×pattern.
- `s1clock`/`s1transport`: copy `t8clock`/`t8transport`'s tests verbatim if the shared-helper
  refactor in §5 happens; otherwise duplicate the same test shape.
- **New test not present in `t8.test.mjs`:** a chord-mode test, since §2 established the S-1 is
  polyphonic (up to 4 voices) unlike the T-8's monophonic bass channel — verify a stacked note
  pattern doesn't get accidentally squashed to mono anywhere in the pipeline.
- Same caveat `t8.mjs`'s header comment carries forward: none of this is validated against real S-1
  hardware yet. Add an equivalent header comment to `s1.mjs` once it exists, and don't claim
  hardware-confirmed status until someone actually plays a pattern through a real S-1 and hears it,
  the same bar `t8live`'s `TODO.md` used ("Confirmed working on real hardware: heard t8drum(...)
  play live through Chrome on the Mac").

---

## 7. Site/UI changes

**[SPEC]**
- **No new "audio bridge" tab needed for v1, and it shouldn't be forced onto S-1 by analogy to
  T8Tab.jsx.** T8Tab.jsx (`website/src/repl/components/panel/T8Tab.jsx`) polls a local
  `audio_bridge.py` HTTP API (`127.0.0.1:8737`) that's part of the separate `roland-t8` project and
  runs only on Nikša's own Mac, reading actual audio peak/rms levels off the T-8's physical audio
  output for a "yes it's really making sound" confirmation. That bridge is bound to a specific
  piece of companion software (`roland-t8`'s `audio_bridge.py`) that doesn't exist for the S-1 at
  all — building an equivalent would mean writing and maintaining a whole new audio-capture bridge
  program, which is a much bigger lift than the Strudel-side helper package this plan is otherwise
  scoped to. Recommend **not** doing this for v1.
- **What v1 *should* reuse from T8Tab.jsx's pattern:** the cheap, dependency-free half — MIDI
  *device presence* detection via `navigator.requestMIDIAccess()` (see `useT8MidiOutputDetected()`
  in `T8Tab.jsx`, lines ~77-106). A small `S1Tab.jsx` (or a shared generic
  `DeviceMidiStatus.jsx` parameterized by a device-name regex, used by both T8Tab and a new S1Tab)
  that just shows a green/red dot for "S-1 MIDI connected" costs almost nothing and gives the same
  "don't just say did-you-hear-that" confidence T8Tab.jsx already provides for the T-8's MIDI half
  — it's the audio-bridge half specifically that's T-8-specific, not the whole tab concept.
- Register the new tab the same way T8Tab is wired into `Panel.jsx` (`import { S1Tab } from
  './S1Tab'` + a case branch, mirroring `Panel.jsx:14` and `Panel.jsx:275`).
- `WelcomeTab.jsx`'s credits section (Strudel/TidalCycles attribution, confirmed present at
  `WelcomeTab.jsx` lines ~87-96) needs no content change for S-1 support — it already credits the
  underlying pattern engine generically, not per-device. Just make sure any new "what is this site"
  copy that mentions "T-8" by name (per `WelcomeTab.jsx` line ~13's "Roland AIRA Compact T-8 beat
  machine" framing) gets updated to mention both devices once S-1 support ships, so the welcome
  copy doesn't undersell what the site now supports. AGPL attribution itself (LICENSE file, header
  comments in every `.mjs` file like `t8.mjs`'s own copyright block) should be copied verbatim into
  `s1.mjs` — same license, same upstream credit, no new legal text needed.

---

## 9. Implementation log (2026-07-31)

**[SPEC]** Steps 1-3, 6, 7 from §8 done same day the hardware arrived:
- Step 1 (SYnC confirmation) — done, see §3's resolution above.
- Step 2 (`packages/s1/s1.mjs` core) — done: `s1note`, `s1cc` (full CC table from §1.3, camelCase +
  cutoff/resonance/attack/decay/release/lfoRate aliases), `s1select`, `s1polyMode` (raw 0-1
  passthrough, no invented mode boundaries, per §5's confidence caveat), `s1clock`/`s1transport`.
  Package structure mirrors `packages/t8/` exactly (`package.json`, `index.mjs`, `vite.config.js`).
- Step 4 (clock/transport) — done, but **not** via the §5 shared-helper extraction into
  `@strudel/midi`. Chose to duplicate `t8clock`/`t8transport`'s small body directly in `s1.mjs`
  instead, to avoid touching the already-hardware-confirmed `t8.mjs` (this project's own convention
  is minimal diffs to working code). Documented as a deliberate tradeoff in `s1.mjs`'s header
  comment — revisit if a third device ever needs the same generator.
- Step 3 (tests) — done: 14 tests in `packages/s1/test/s1.test.mjs`, all passing, including the
  chord/polyphony test §6 called out as new (not present in `t8.test.mjs`). T-8's own 11 tests
  re-run and still pass (no regression).
- Step 6 (registration) — done: `packages/repl/prebake.mjs`, `website/src/repl/util.mjs`,
  `website/package.json` all updated; `pnpm install` linked the new workspace package.
- Step 7 (`S1Tab.jsx`) — done: MIDI-presence-only tab per §7's recommendation (no audio-bridge
  half), wired into `Panel.jsx` the same way `T8Tab` is.
- **Not done yet:** Step 5 (`s1polyMode` value-curve hardware verification, SHIFT-combo CC
  verification from §4) — deliberately deferred, these need real listening/panel-watching, not just
  MIDI-level testing. README.md/TODO.md "Writing S-1 patterns" section also not written yet.
- **Known UX cost:** `S1Tab` adds a 6th tab to `Panel.jsx`'s already-cramped mobile nav (see
  Nikša's own 2026-07-30 mobile check: the "reference" tab label already clips at 393px viewport
  width before this change). Not fixed as part of this work — pre-existing issue, just noting it
  gets one tab worse.

---

## 8. Scope, complexity, and suggested order

**[SPEC]** Rough estimate, calibrated against how long the equivalent T-8 work actually took (per
`TODO.md`'s "Done so far" — package + 9-test suite + tab, roughly one focused session plus a
follow-up code-review pass):

1. **Confirm the SYnC/clock-follow open question (§3) against real hardware first** — this gates
   whether `s1clock`/`s1transport` need a T-8-style workaround or can just use upstream defaults.
   Cheapest way: connect a real S-1, run `t8clock().midi('S-1 MIDI IN')` (the *existing* T-8 helper
   works fine as a generic clock generator, no S-1 package needed yet) and watch whether the S-1's
   sequencer/arp follows correctly with plain Strudel defaults or needs the same `autostart: false`
   treatment. Low effort, unblocks a real design decision instead of guessing.
2. **Build `packages/s1/s1.mjs` core**: `s1note`, `s1cc` (with the name table from §1.3), `s1select`
   — all derivable directly from the verified chart, no hardware-dependent guesswork. This is the
   bulk of the value and the safest part to build first.
3. **Write `test/s1.test.mjs`** per §6, following `t8.test.mjs`'s real-pipeline pattern.
4. **Wire clock/transport** (`s1clock`/`s1transport`) using whatever step 1 revealed. If shared
   helper extraction (§5) is worth it, do it now while both device packages are fresh in mind rather
   than as a later refactor.
5. **`s1polyMode` and the SHIFT-combo CCs flagged in §4** — lowest confidence items, do last, and
   validate each one against real hardware individually rather than shipping the whole CC table as
   equally trustworthy (the chart is trustworthy for CC *numbers*; the *value semantics* of e.g. CC
   80's poly-mode steps or CC 5's portamento-time curve are not verified here).
6. **Register in `prebake.mjs`/`website/src/repl/util.mjs`**, update `README.md` (a new "Writing
   S-1 patterns" section mirroring §3's T-8 one) and `TODO.md`.
7. **Optional `S1Tab.jsx`** (§7) — small, can slot in anytime after step 1, not on the critical path
   for the pattern-language functionality itself.

No step here requires SysEx work, no step requires a companion audio-bridge program. The overall
lift looks smaller than the original T-8 integration was, because there's no drum-voice name-
mapping table to reverse-engineer (T-8's `T8_RHYTHM_NOTES` had to be confirmed note-by-note against
real hardware; S-1's note numbering is already confirmed standard 0-127 in the official chart) —
the main unknowns are the *transport* question (§3) and a handful of *value-semantics* questions on
specific CCs (§5's `s1polyMode` row, §4's SHIFT-combo caveat), not the basic CC-number map itself.

---

## 9. Open questions (honest gaps — do not guess past these)

**[?]**
1. **SYnC-mode equivalence (§3):** does the S-1 need a T-8-style `autostart: false` workaround, or
   does it just follow incoming Clock/Start/Stop unconditionally? Not resolved by this research
   pass. Unblocked by: 10 minutes with a real S-1 and the existing `t8clock()`/`t8transport()`
   helpers (they're generic enough to test against any device already), or a careful read of the
   full S-1 owner's manual body (not just the MIDI chart page) for a menu setting this pass didn't
   search for.
2. **Per-CC Transmitted vs Recognized direction (§1.3):** the official chart's transmit/recognize
   columns for the 51-entry CC list didn't survive HTML table extraction cleanly. Unblocked by:
   re-fetching the chart with a tool that preserves table structure (e.g. render the page and read
   the table visually, or find the PDF version of the manual — a PDF link is listed at
   `assets.brack.ch/documents2/7/0/7/282129707/282129707.pdf`, not yet opened during this pass) —
   or just not building any inbound (S-1→host) CC feature until it doesn't matter.
3. **CC 80 (POLY MODE) and CC 81-83/85-87 (Chord voice switches) exact value semantics:** the chart
   gives the CC number and panel-control name but not the discrete value ranges (e.g. does CC 80 use
   0-31=Poly, 32-63=Mono, etc., or some other split?). Unblocked by: MIDI-monitoring a real S-1
   while manually switching poly modes on the panel and reading off the CC values it responds to
   *or* transmits (whichever direction turns out to work per open question 2).
4. **SHIFT-combo CC behavior (§4):** whether any of the ~15 CCs whose panel description includes a
   SHIFT gesture behave identically to a plain knob CC when sent over MIDI, or have some quirk (the
   Pd community project's author couldn't fully resolve this either). Unblocked by: hardware testing
   each flagged CC individually, or contacting Roland support directly.
5. **Full owner's manual body was not read in this pass** — only the MIDI implementation chart page
   and the officially-published control-change list on that same page. The manual's main body
   (panel descriptions, "Connecting to a computer or mobile device" section, D-MOTION tilt control,
   etc. — visible in the page's own table of contents, e.g. at
   `https://www.manualslib.com/manual/3069202/Roland-S-1.html`) may contain additional detail
   relevant to questions 1 and 3 above. Recommend reading it before finalizing `s1polyMode` and the
   transport helpers, not before starting `s1note`/`s1cc`/`s1select` (those are already
   fully-grounded in the verified chart).

---

*Forked from [Strudel](https://codeberg.org/uzu/strudel) (AGPL-3.0-or-later) — this plan concerns
new device-specific helper code built on top of Strudel's existing generic `@strudel/midi` layer,
same as the existing `@strudel/t8` package. All credit for the underlying pattern engine,
mini-notation language, and audio engine goes to the Strudel/TidalCycles project and contributors.*
