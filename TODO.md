# TODO — t8strudel

Full fork of [Strudel](https://codeberg.org/uzu/strudel) (AGPL-3.0), rebranded and extended for the
Roland AIRA Compact T-8. Primary repo: `codeberg.org/catcam/t8strudel` (GitHub is a read-only
mirror, per upstream's explicit request not to fork back to GitHub). Domain: t8strudel.fyi.

## Done so far

- **Rebrand pass 1**: TR-808-styled default editor theme (`packages/codemirror/themes/t8-808.mjs`,
  `t808Theme`), title/description/manifest/PWA/CNAME renamed to t8strudel across the site.
- **`@strudel/t8` package** (`packages/t8/`): `t8drum`, `t8bass`, `t8select(bank, pattern)`,
  `t8clock`, `t8transport` — MIDI helpers built on `@strudel/midi`'s existing Web MIDI output.
  9-test vitest suite. **Confirmed working on real hardware**: heard `t8drum("bd ~ sd ~ bd bd sd
  ~").midi('T-8 MIDI IN')` play live through Chrome on the Mac.
- **T-8 audio-confirm tab** (`website/src/repl/components/panel/T8Tab.jsx`): new REPL panel tab
  polling `audio_bridge.py`'s `/status` + `/levels` every 300ms — device-present dot, passthrough
  state, peak/rms meters, small bar chart of the last 5s. Required adding CORS headers to
  `audio_bridge.py` (companion commit in the `roland-t8` repo). **Confirmed working**: Nikša sees
  live meters in the browser tab.

## Known workflow notes (don't re-derive from scratch)

- **Dev server**: `sudo -u botuser bash -c 'export PATH=$HOME/.npm-global/bin:$PATH; cd
  /home/botuser/t8strudel; nohup pnpm dev > /tmp/t8strudel_dev.log 2>&1 &'` — pnpm is installed to
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

## Remaining work (not yet started, no particular order agreed yet)

- **Low priority**: T8Tab's peak/rms meters feel laggy (Nikša noticed 2026-07-26). Likely culprits:
  300ms poll interval combined with the CSS `transition-[width] duration-100` on `MeterBar`, and/or
  `/status` only reflecting audio_bridge.py's own 100ms `WRITE_INTERVAL` ring-buffer cadence. Possible
  fix later: poll `/status` faster (~100ms) and separately from the slower `/levels` bar-chart poll,
  drop or shorten the CSS transition for an instant-attack/slower-decay VU-meter feel. Not started.

- Rebrand pass 2: favicon/logo image asset (still generic Strudel icon), a real Footer component
  with Strudel/TidalCycles credit (currently doesn't exist even upstream — broken import), deep
  docs/blog prose still says "Strudel" throughout, Algolia search reindexing under our own account.
- Deployment to t8strudel.fyi (hosting target not decided yet — Codeberg Pages? Vercel/Netlify
  pointed at the Codeberg repo? A VPS?).
- `t8clock`/`t8transport`'s `ticksPerCycle` default (48) needs tuning against a real BPM/cps
  setting — not yet dialed in against actual musical tempo, just structurally confirmed to work.
