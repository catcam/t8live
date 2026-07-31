# t8live — Live Coding for the Roland AIRA Compact T-8
**Version 0.1.0** · Nikša Barlović · 2026 · Fork of Strudel (AGPL-3.0-or-later)

---

## AI READING INSTRUCTION

This document is written in [HADS](https://codeberg.org/catcam/t8live) format. Read `[SPEC]` and
`[BUG]` blocks for authoritative facts about programming t8live and running/developing this
repo. Read `[NOTE]` blocks only if additional context is needed. `[?]` blocks are unverified —
treat with lower confidence and confirm before relying on them.

---

## 1. What is this

**[SPEC]**
- t8live is a full fork of [Strudel](https://codeberg.org/uzu/strudel), a browser-based
  live-coding pattern language (a JS port of TidalCycles)
- Adds first-class support for the Roland AIRA Compact T-8 beat machine and the AIRA Compact S-1
  synth over Web MIDI
- Primary repo: `codeberg.org/catcam/t8live` — GitHub is a read-only mirror (see `[NOTE]` below)
- License: AGPL-3.0-or-later, same as upstream Strudel
- Domain: t8live.fyi (hosting target not yet decided)

**[NOTE]**
Strudel's own maintainers ask contributors not to fork the project back to GitHub ("we have moved
from Microsoft's Github platform to Codeberg for ethical reasons"). This project respects that:
`codeberg.org/catcam/t8live` is the canonical repo, `github.com/catcam/t8live` exists only as
a convenience mirror. All credit for the underlying pattern engine, mini-notation language, and
audio engine belongs to the Strudel/TidalCycles project and contributors.

---

## 2. Running locally

**[SPEC]**
```bash
corepack prepare pnpm@9 --activate   # or npm i -g pnpm; corepack's `latest` needs Node >=22.13
pnpm i
pnpm dev                              # serves the REPL, default port 4321
```
- Requires Node >=18 (developed against Node 20.20.2)
- Requires a checkout fully owned by the user running `pnpm` — see `[BUG]` below if `pnpm i` fails
  with `EACCES`

**[?]**
- Exact minimum Node/pnpm version compatibility beyond what's been tested here is unverified.

---

## 3. Writing T-8 patterns — the `@strudel/t8` API

**[SPEC]**
Package: `packages/t8/t8.mjs`, globally available in the REPL (registered via `evalScope` in
`packages/repl/prebake.mjs` and `website/src/repl/util.mjs`) — no import needed in your pattern.

| Function | Purpose | Channel |
|---|---|---|
| `t8drum(pattern)` | Maps voice names to T-8 rhythm notes | 10 |
| `t8bass(pattern)` | Sets T-8 bass channel (note names pass through unchanged) | 2 |
| `t8select(bank, pattern)` | Program Change to select a T-8 pattern slot (bank 1-4, pattern 1-16) | 16 |
| `t8clock(ticksPerCycle=48)` | Continuous MIDI Clock stream | n/a |
| `t8transport(startStopPattern='<start stop>/2', ticksPerCycle=48)` | Clock + Start/Stop, stacked | n/a |

`t8drum` voice names → MIDI notes: `bd`=36, `sd`=38, `clap`=50, `tom`=47, `ch`=42, `oh`=46. An
unknown voice name errors (logged, query returns no haps) instead of silently sending a wrong note.

All of the above still need `.midi('T-8 MIDI IN')` appended to actually send anything.

```js
// trigger drum voices by name
t8drum("bd ~ sd ~ bd bd sd ~").midi('T-8 MIDI IN')

// bass line -- standard note names work directly, no mapping needed
note("c2 ~ eb3 ~").t8bass().midi('T-8 MIDI IN')

// select bank 4 pattern 15 on the device
t8select(4, 15).midi('T-8 MIDI IN')

// drive the T-8's own transport (device menu: SYnC must be set to AUTO)
t8transport("<start stop>/4").midi('T-8 MIDI IN')
```

**[NOTE]**
The T-8 has 6 real rhythm voices. The `.prm` pattern-file format used by the companion
[roland-t8](https://codeberg.org/catcam/roland-t8) project has extra `LT`/`HT`/`CY` columns that
don't map to independent MIDI notes on this unit, so `t8drum` intentionally exposes only the 6
confirmed voices. Bass note numbering on the T-8 happens to line up with standard MIDI note
numbers, which is why `t8bass` needs no name-mapping step, unlike `t8drum`.

---

## 4. Writing S-1 patterns — the `@strudel/s1` API

**[SPEC]**
Package: `packages/s1/s1.mjs`, globally available in the REPL (registered via `evalScope` in
`packages/repl/prebake.mjs` and `website/src/repl/util.mjs`, same mechanism as `@strudel/t8`) — no
import needed in your pattern. Full sourced research/implementation writeup, including hardware-test
results and open questions, lives in `docs/s1-implementation-plan.md`.

| Function | Purpose | Channel |
|---|---|---|
| `s1note(pattern)` | Sets the S-1's synth channel on a note pattern (standard note names/numbers pass through unchanged) | 3 |
| `s1cc(name \| ccNumber, valuePattern)` | Named-parameter CC helper, e.g. `s1cc('cutoff', ...)` instead of `.ccn(74).ccv(...)` — full name table in `S1_CC` | n/a |
| `s1polyMode(valuePattern)` | Raw 0-1 passthrough for CC 80 (POLY MODE) — deliberately not a named enum, see caveat below | n/a |
| `s1chord({voice2, voice3, voice4, voice2Shift, voice3Shift, voice4Shift})` | Composite helper for the four chord-voice CCs (81-83 switches, 85-87 key-shifts) instead of six separate `s1cc` calls | n/a |
| `s1select(patch)` | Program Change to select an S-1 patch slot (flat 0-63 range, no bank split unlike `t8select`) | 16 |
| `s1clock(ticksPerCycle=48)` | Continuous MIDI Clock stream | n/a |
| `s1transport(startStopPattern='<start stop>/2', ticksPerCycle=48)` | Clock + Start/Stop, stacked | n/a |

Unlike the T-8, the S-1 is up to 4-voice polyphonic (Poly/Mono/Unison/Chord, switchable via
`s1polyMode`/CC 80) — stacked/chorded note patterns are a first-class case for `s1note`, not just a
monophonic bassline. All of the above still need `.midi('S-1 MIDI IN')` appended to actually send
anything.

```js
// a chord, sent to the S-1's synth channel
note("<[c3,eb3,g3] [c3,f3,ab3]>").s1note().midi('S-1 MIDI IN')

// sweep the filter cutoff
s1cc('cutoff', sine.slow(4)).midichan(3).midi('S-1 MIDI IN')

// set chord-voice 2 on with a key shift, leave 3/4 alone
s1chord({ voice2: true, voice2Shift: 0.6 }).midichan(3).midi('S-1 MIDI IN')

// select patch slot 12
s1select(12).midi('S-1 MIDI IN')

// drive the S-1's own transport -- unlike the T-8, this needs no on-device
// mode toggle for Clock/Start/Stop to work (confirmed against real hardware)
s1transport("<start stop>/4").midi('S-1 MIDI IN')
```

**[NOTE]**
Unlike `t8bass`, `s1note` needs no note-name-to-MIDI-note mapping table — the S-1's own MIDI chart
confirms a true 0-127 voice range with no internal remapping. The bulk of the CC table (§1.3 of the
plan doc) is directly sourced from Roland's official chart, cross-checked against the PDF version
of the manual (the HTML version's Transmitted/Recognized columns didn't survive scraping cleanly;
the PDF did).

**[BUG-LIKE CAVEAT] `s1cc('pulseWidth', ...)` (CC 15, PWM depth) does not audibly work**
Roughly 31 of the S-1's ~54 documented CCs are only reachable on the physical panel via a
`[SHIFT]+knob/pad` gesture — the MIDI chart lists them as ordinary CC numbers with no modifier byte,
but a community Pure Data project's author previously reported difficulty getting SHIFT-combo CCs
working at all. Hardware-tested here (2026-07-31, spectral analysis via the S-1 audio bridge): CC 15
(OSC PULSE WIDTH / PWM depth) produces no measurable audible change between depth=0 and depth=127,
in two independent test configurations, even with the LFO explicitly routed toward the oscillator
first to rule out an unrouted-modulation confound — while a known-good non-SHIFT CC (74, filter
cutoff) and even a modest non-SHIFT modulation-depth CC (13, OSC LFO) both clearly worked in the
same setup. Treat any other SHIFT-combo CC in `S1_CC` with the same suspicion until individually
verified — see `docs/s1-implementation-plan.md` §9 item 4 for the full list and methodology.
CC 5 (PORTAMENTO TIME, also SHIFT-combo) was also tested but the result was genuinely inconclusive
(pitch-tracking limitations, not a hardware finding either way) — left honestly unresolved rather
than guessed at.

---

## 5. Known bugs (fixed in this fork — don't re-break these)

**[BUG] `.midi()` sends an unwanted Start message on every cycle-0 hap**
Symptom: pressing play on *any* pattern using `.midi()` — even one that never touches `midicmd` —
makes the T-8 start playing its own currently-selected pattern at the same time as whatever Strudel
is triggering live. Two patterns clash audibly.
Cause: upstream `packages/midi/midi.mjs`'s `onTrigger` handler unconditionally calls
`device.sendStart()` whenever a hap's cycle begins at 0. On the T-8 (`SYnC=AUTO`), a bare Start with
no accompanying clock stream makes the device fall back to its own internal clock and start its own
sequencer.
Fix: gated behind a new `autostart` option on `.midi(port, options)`, defaulting to `false` in this
fork. Intentional transport control still works via `t8transport()`, which sends a real continuous
clock alongside Start/Stop. Pass `{ autostart: true }` to restore the old unconditional behavior if
some other (non-T-8) device ever needs it.

**[BUG] "Your Browser does not support WebMIDI" in Chrome**
Symptom: Chrome — which does support Web MIDI — throws this error anyway.
Cause: `navigator.requestMIDIAccess` is only exposed in a secure context (HTTPS or `localhost`). A
plain `http://<tailscale-ip>:4321` origin doesn't qualify, even though the connection works fine
for everything else served from that origin.
Fix: the browser must load the REPL from `localhost` (or a real HTTPS origin once deployed). During
remote development, a reverse SSH tunnel from the dev-server host to the machine running the
browser (`ssh -N -R 4321:localhost:4321 user@browser-host`) makes `http://localhost:4321` on that
machine reach the remote dev server.

**[BUG] `pnpm i` fails with `EACCES` creating `node_modules`**
Symptom: `pnpm i` fails trying to symlink into a package's `node_modules` directory.
Cause: a file or directory somewhere in the repo was created by a different OS user (e.g. `root`
instead of whichever user owns the checkout), flipping ownership on that subtree.
Fix: `chown -R <repo-owner>:<repo-owner>` the whole repo, then retry.

**[BUG] Edited a component but the browser doesn't reflect the change**
Symptom: hot-reload log shows the file was picked up, but the running app (via a tunnel, a
bookmark, or otherwise) still shows the old behavior.
Cause: an earlier `pnpm dev` process was never actually killed (e.g. a `pkill` pattern didn't match
the real command line), so a second instance started and silently bound to the next free port
(4322) instead of 4321 — whatever's still listening on 4321 is the stale one.
Fix: check `lsof -i :4321` / `ps aux | grep astro` for more than one matching process before
assuming a code change didn't take effect. Kill all of them, then start exactly one.

---

## 6. Workflow notes for this repo

**[SPEC]**
- Primary remote: `origin` → `codeberg.org/catcam/t8live`. Push here first, always.
- Mirror remote: `github-mirror` → `github.com/catcam/t8live`. Convenience only — push after
  `origin`, never instead of it.
- `upstream` remote → `codeberg.org/uzu/strudel` (the original project, for pulling updates).
- Full outstanding-work tracker: see `TODO.md` in this repo — not duplicated here.

**[NOTE]**
This README stays focused on "how do I write T-8 patterns" and "what's already been fixed and why."
`TODO.md` is the living list of what's left, since that changes faster than a README should.

---

*Forked from [Strudel](https://codeberg.org/uzu/strudel) (AGPL-3.0-or-later) — all credit for the
pattern engine, mini-notation language, and audio engine goes to the Strudel/TidalCycles project
and contributors.*
