# TODO — t8live

Full fork of [Strudel](https://codeberg.org/uzu/strudel) (AGPL-3.0), rebranded and extended for the
Roland AIRA Compact T-8. Primary repo: `codeberg.org/catcam/t8live` (GitHub is a read-only
mirror, per upstream's explicit request not to fork back to GitHub). Domain: t8live.fyi.

## Done so far

- **Rebrand pass 1**: TR-808-styled default editor theme (`packages/codemirror/themes/t8-808.mjs`,
  `t808Theme`), title/description/manifest/PWA/CNAME renamed to t8live across the site.
- **`@strudel/t8` package** (`packages/t8/`): `t8drum`, `t8bass`, `t8select(bank, pattern)`,
  `t8clock`, `t8transport` — MIDI helpers built on `@strudel/midi`'s existing Web MIDI output.
  9-test vitest suite. **Confirmed working on real hardware**: heard `t8drum("bd ~ sd ~ bd bd sd
  ~").midi('T-8 MIDI IN')` play live through Chrome on the Mac.
- **T-8 audio-confirm tab** (`website/src/repl/components/panel/T8Tab.jsx`): new REPL panel tab
  polling `audio_bridge.py`'s `/status` + `/levels` every 300ms — device-present dot, passthrough
  state, peak/rms meters, small bar chart of the last 5s. Required adding CORS headers to
  `audio_bridge.py` (companion commit in the `roland-t8` repo). **Confirmed working**: Nikša sees
  live meters in the browser tab.

## S-1 support (added 2026-07-31)

Full sourced research/implementation writeup: `docs/s1-implementation-plan.md`. Summary here follows
the same "done so far / still open" shape as the T-8 section above.

**Done, confirmed working:**
- **`@strudel/s1` package** (`packages/s1/`): `s1note`, `s1cc` (full 54-entry CC table from the
  official chart, camelCase names + short aliases), `s1polyMode`, `s1chord`, `s1select`, `s1clock`,
  `s1transport` — 19-test vitest suite, all passing. Registered in `prebake.mjs`/`util.mjs` the same
  way `@strudel/t8` is.
- **SYnC/transport**: confirmed via raw `python-rtmidi` against real hardware — the S-1 follows
  external MIDI Clock/Start/Stop immediately, no T-8-style `autostart:false`/`SYnC=AUTO` menu step
  needed for the default case. Nuance found later reading the manual body: the S-1 *does* have an
  equivalent `SYnC` menu setting (`AUtO`/`Int`/MIDI/USB) — the hardware test worked because the unit
  was already at (or defaults to) `AUtO`. If a real unit was manually set to `Int`, this wouldn't
  work; no way to query the setting over MIDI (no SysEx).
- **S-1 audio bridge** (`mac_bridge/s1_audio_bridge.py`, port 8738): adapted from `roland-t8`'s audio
  bridge, LaunchAgent `com.catcam.s1helper.audiobridge`, no TCC/permission prompt needed (same
  Xcode-python3-bundle grant reuse as the T-8 bridge). `S1Tab.jsx` polls it the same way `T8Tab.jsx`
  does.
- **Per-CC Transmitted/Recognized directions**: resolved by extracting the PDF version of the
  manual with `pdfplumber` (the HTML scrape mangled this table). Also caught and fixed two wrong
  flags from the original HTML-scrape pass (All Sound Off, Reset All Controllers) — see plan doc
  §1.3/§1.7.
- **CC 15 (OSC PULSE WIDTH / PWM depth) hardware-confirmed NOT to work as a plain CC** — no
  measurable spectral change 0→127 in two independent test configurations (one ruling out an
  unrouted-LFO confound), while known-good control CCs (74 cutoff, 13 OSC LFO) both clearly worked
  in the same setup. Roughly 31 of the ~54 documented CCs are behind a `[SHIFT]+knob/pad` gesture on
  the real panel like CC 15 is; only CC 15 itself has been individually verified so far. Documented
  as a real caveat in `s1cc`'s JSDoc and the README.
- **CC 80 (POLY MODE) partially narrowed**: manual body names/defines the four modes (Mono/Unison/
  Poly/Chord) and their definitions line up well with the spectral data already gathered (Chord =
  "extra pitches not in the sent chord", Unison = "one clean peak + amplitude beat" on a single
  note) — still no exact CC-value boundary numbers, `s1polyMode` intentionally stays a raw 0-1
  passthrough, not a named enum.

**Still open / honestly unresolved:**
- **CC 5 (PORTAMENTO TIME) hardware test was inconclusive** — pitch-tracking methodology got
  confused by the S-1's harmonic content (likely sub-oscillator interference), not a finding about
  the CC itself either way. Would need a more robust pitch-tracking approach or a different metric
  entirely to resolve.
- **CC 80's exact Mono vs Unison vs Poly numeric boundaries** — narrowed by the manual's mode
  definitions (see above) but not fully resolved; specifically unclear why CC80=16 was silent for a
  single note when a real Mono mode shouldn't be.
- The other ~30 SHIFT-combo CCs beyond CC 15 haven't been individually hardware-tested — CC 15's
  confirmed failure is a reason for suspicion, not proof they're all broken.
- **`WelcomeTab.jsx`** still only mentions "Roland AIRA Compact T-8" in its intro copy (line ~13) —
  not updated as part of this pass (README.md/TODO.md were the requested scope this round); worth
  updating once S-1 support is announced more broadly, per the original plan doc §7's note about not
  underselling what the site supports.

## Known workflow notes (don't re-derive from scratch)

- **Dev server**: `sudo -u botuser bash -c 'export PATH=$HOME/.npm-global/bin:$PATH; cd
  /home/botuser/t8live; nohup pnpm dev > /tmp/t8live_dev.log 2>&1 &'` — pnpm is installed to
  a botuser-local prefix (`~/.npm-global`), NOT via corepack (corepack's `pnpm@latest` needs Node
  ≥22.13, this box has Node 20.20.2 — installed `pnpm@9` explicitly instead).
- **Any file/dir created by a root-run tool inside this repo breaks `pnpm i`** (EACCES on
  `node_modules` under a root-owned dir) — always `chown -R botuser:botuser` after such edits.
- **Testing Web MIDI from a browser**: Web MIDI needs a secure context (HTTPS or `localhost`) — the
  Tailscale IP (`http://100.81.59.6:4321`) is NOT secure enough and Chrome will refuse to expose
  `navigator.requestMIDIAccess` at all. Fix: a reverse SSH tunnel from this VPS to the Mac (`ssh -N
  -R 4321:localhost:4321 niksabarlovic@catcam-macbook-pro`, backgrounded), then open
  `http://localhost:4321` in Chrome **on the Mac**. Chrome treats `localhost` as secure regardless.
- **Git identity for this repo** is set locally (`git config user.name/user.email`), not global.
- **Push to both remotes**: Codeberg (`origin`) is primary, use the token at
  `/home/botuser/.codeberg_token.txt` via a one-off `http.extraheader` (never embed in the remote
  URL). GitHub (`github-mirror`) via `gh auth token`, same pattern. Push both after every commit.

## Deployment (DONE, 2026-07-26)

Self-hosted on this VPS via nginx + Let's Encrypt (matches the same pattern as Nikša's other
`.fyi`/personal domains already on this box). DNS (Porkbun) A record points at the VPS's public IP.
nginx config: `/etc/nginx/sites-available/t8live.fyi` — port 80 redirects to https, real traffic
terminates at `127.0.0.1:8443` (this box's standard pattern: `sslh` on the real port 443
multiplexes SSH-over-443 vs TLS, forwarding TLS to nginx's 8443 vhost). Cert via
`certbot certonly --nginx -d t8live.fyi -d www.t8live.fyi`, auto-renews.

**Deploy workflow for future changes — no CI yet, fully manual:**
```bash
cd /home/botuser/t8live && sudo -u botuser bash -c 'export PATH=$HOME/.npm-global/bin:$PATH; pnpm build'
# nginx serves website/dist/ directly, no restart needed -- just rebuilding updates the live site
```

## Analytics (DONE, 2026-07-26)

Self-hosted, privacy-friendly, no JS/cookies on the site itself: GoAccess parses nginx's own access
log for t8live.fyi (dedicated log added, previously shared the box's global one) and generates a
static HTML report every 5 minutes via a systemd timer.

- Log: `/var/log/nginx/t8live.fyi.access.log`
- Report generator: `/usr/local/bin/t8live-goaccess-report.sh`, run by
  `t8live-goaccess.timer`/`.service` (systemd, every 5 min, `systemctl list-timers` to check)
- Served at **https://t8live.fyi/analytics/** (password-protected: `/etc/nginx/.htpasswd-t8live`,
  user `niksa` — password given to Nikša directly, not written here)
- No account/subdomain/DNS needed — reuses the existing domain + nginx setup entirely.

## Code review (2026-07-26)

Ran an 8-angle automated review of the session's diff. Fixed (see git log for exact commits):
- T8Tab's laggy meters: root cause was `/status`+`/levels` serialized into one poll cycle, plus
  `/levels` re-fetching ~94% the same window every 300ms — split into two independently-paced polls.
- `t8select(bank, pattern)` now validates its range and throws immediately, matching `t8drum`'s
  fail-loud design (previously silently sent a real-but-wrong Program Change out of range).
- `t8drum`'s JSDoc corrected — it does NOT actually throw a catchable exception for unknown voice
  names (Pattern.queryArc swallows the error and returns an empty hap array); the doc overstated it.
- `packages/midi/README.md` now documents the `autostart` option (was only mentioned in the
  top-level repo README, not the package a MIDI user would actually read).
- **Confirmed working live**: `T8Tab.jsx` fetches plain `http://127.0.0.1:8737` from the HTTPS
  `https://t8live.fyi` page. Was worried this might be blocked as mixed content, but Nikša
  confirmed on the real production site that the T8 tab works correctly -- the CORS allowlist +
  `do_OPTIONS`/Private-Network-Access fix on the bridge side (`roland-t8` repo) was sufficient, no
  further HTTPS-for-the-bridge infra needed.

## `t8clock`/`t8transport` tempo tuning (not started)

`ticksPerCycle` default (48) needs tuning against a real BPM/cps setting — not yet dialed in
against actual musical tempo, just structurally confirmed to work.
