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
- Adds first-class support for the Roland AIRA Compact T-8 beat machine over Web MIDI
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

## 4. Known bugs (fixed in this fork — don't re-break these)

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

## 5. Workflow notes for this repo

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
