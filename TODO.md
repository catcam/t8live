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
