import { useEffect, useState } from 'react';

// mac_bridge/s1_audio_bridge.py (this repo) always binds to 127.0.0.1 on the
// Mac the S-1 is connected to. This tab only works when the browser tab
// itself is running on that same Mac (same requirement as Web MIDI/.midi()),
// since 127.0.0.1 means "this machine" from the browser's point of view.
//
// Note: docs/s1-implementation-plan.md §7 originally recommended NOT
// building this (a T-8-style audio bridge was judged too big a lift for
// v1). That was superseded 2026-07-31 once a real S-1 was on hand and the
// TCC/LaunchAgent question was resolved on the T-8 side -- see
// mac_bridge/s1_audio_bridge.py's module docstring for the full evidence
// trail (short version: the bridge inherits an existing Microphone grant
// tied to the Xcode-bundled python3 it runs under, so no fresh permission
// prompt was needed to stand this up).
const BRIDGE_URL = 'http://127.0.0.1:8738';
const STATUS_POLL_INTERVAL_MS = 300; // drives the live peak/rms meter -- keep snappy
const LEVELS_POLL_INTERVAL_MS = 1500; // drives the slow-changing bar chart only
const LEVELS_WINDOW_SECONDS = 5;

function useAudioBridge() {
  const [status, setStatus] = useState(null);
  const [levels, setLevels] = useState([]);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    let statusTimer;
    let levelsTimer;

    // Two independent polling loops -- see T8Tab.jsx for why (a single
    // Promise.all chain forces the fast-moving meter to wait on the
    // slow-moving bar chart's round-trip every cycle).
    async function pollStatus() {
      try {
        const res = await fetch(`${BRIDGE_URL}/status`);
        if (!res.ok) throw new Error('s1_audio_bridge.py returned an error response');
        const json = await res.json();
        if (!cancelled) {
          setStatus(json);
          setError(null);
        }
      } catch (e) {
        if (!cancelled) {
          setError(e?.message || String(e));
          setStatus(null);
        }
      } finally {
        if (!cancelled) statusTimer = setTimeout(pollStatus, STATUS_POLL_INTERVAL_MS);
      }
    }

    async function pollLevels() {
      try {
        const res = await fetch(`${BRIDGE_URL}/levels?seconds=${LEVELS_WINDOW_SECONDS}`);
        if (res.ok && !cancelled) {
          setLevels(await res.json());
        }
      } catch {
        // the /status loop already surfaces connectivity errors; levels can just go stale
      } finally {
        if (!cancelled) levelsTimer = setTimeout(pollLevels, LEVELS_POLL_INTERVAL_MS);
      }
    }

    pollStatus();
    pollLevels();
    return () => {
      cancelled = true;
      clearTimeout(statusTimer);
      clearTimeout(levelsTimer);
    };
  }, []);

  return { status, levels, error };
}

function useS1MidiOutputDetected() {
  const [found, setFound] = useState(null); // null = still checking / unsupported

  useEffect(() => {
    let cancelled = false;
    if (typeof navigator === 'undefined' || !navigator.requestMIDIAccess) {
      setFound(false);
      return;
    }
    function scan(access) {
      if (cancelled) return;
      const hasS1 = Array.from(access.outputs.values()).some((o) => /s-1/i.test(o.name || ''));
      setFound(hasS1);
    }
    navigator
      .requestMIDIAccess()
      .then((access) => {
        scan(access);
        access.onstatechange = () => scan(access);
      })
      .catch(() => {
        if (!cancelled) setFound(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return found;
}

function MeterBar({ value }) {
  const pct = Math.min(100, Math.round((value ?? 0) * 100));
  const color = pct > 80 ? 'bg-red-500' : pct > 40 ? 'bg-orange-500' : 'bg-green-600';
  return (
    <div className="w-full h-4 bg-black/30 rounded overflow-hidden">
      <div className={`h-full ${color} transition-[width] duration-100`} style={{ width: `${pct}%` }} />
    </div>
  );
}

function Dot({ ok }) {
  return <span className={`inline-block w-2.5 h-2.5 rounded-full ${ok ? 'bg-green-600' : 'bg-red-500'}`} />;
}

export function S1Tab() {
  const { status, levels, error } = useAudioBridge();
  const midiFound = useS1MidiOutputDetected();

  if (error) {
    return (
      <div className="p-4 text-foreground space-y-4 text-sm">
        <h2 className="text-lg font-bold">S-1</h2>

        <div className="flex items-center space-x-2">
          <Dot ok={midiFound === true} />
          <span>
            {midiFound === null && 'Checking for an S-1 MIDI connection...'}
            {midiFound === true && 'S-1 MIDI connected'}
            {midiFound === false && 'No S-1 MIDI device detected'}
          </span>
        </div>

        {midiFound === true && (
          <p className="opacity-70">
            Sound plays directly through the S-1&apos;s own audio output -- nothing routes through
            this browser tab, so there&apos;s nothing to hear here. Play a note pattern with{' '}
            <code>.s1note().midi(&apos;S-1 MIDI IN&apos;)</code> and listen to the hardware itself.
          </p>
        )}
        {midiFound === false && (
          <p className="opacity-70">
            Connect a Roland S-1 over USB and refresh this tab. Once your browser sees its MIDI
            port, patterns sent with <code>.midi(&apos;S-1 MIDI IN&apos;)</code> will play through
            the S-1&apos;s own audio output.
          </p>
        )}

        <details className="opacity-50 text-xs">
          <summary className="cursor-pointer">Advanced: live audio-level meters</summary>
          <p className="mt-2">
            Not reachable: {error}. That&apos;s expected unless you&apos;re running{' '}
            <a
              className="underline"
              href="https://codeberg.org/catcam/t8live/src/branch/main/mac_bridge/s1_audio_bridge.py"
              target="_blank"
              rel="noreferrer"
            >
              s1_audio_bridge.py
            </a>{' '}
            locally for peak/rms confirmation -- it&apos;s optional and has nothing to do with
            whether the S-1 itself plays sound.
          </p>
        </details>
      </div>
    );
  }

  if (!status) {
    return <div className="p-4 text-foreground text-sm">Connecting to s1_audio_bridge.py...</div>;
  }

  const recentPeaks = levels.slice(-40);

  return (
    <div className="p-4 text-foreground space-y-4 text-sm">
      <h2 className="text-lg font-bold">S-1 Audio Bridge</h2>

      <div className="flex items-center space-x-2">
        <Dot ok={status.device_present} />
        <span>{status.device_present ? 'S-1 connected' : 'S-1 not detected'}</span>
      </div>
      <div className="flex items-center space-x-2">
        <Dot ok={status.passthrough} />
        <span>Passthrough {status.passthrough ? 'on' : 'off'} (audible to speakers)</span>
      </div>

      <div>
        <div className="flex justify-between mb-1">
          <span>peak</span>
          <span>{(status.peak ?? 0).toFixed(3)}</span>
        </div>
        <MeterBar value={status.peak} />
      </div>
      <div>
        <div className="flex justify-between mb-1">
          <span>rms</span>
          <span>{(status.rms ?? 0).toFixed(3)}</span>
        </div>
        <MeterBar value={status.rms} />
      </div>

      <div>
        <div className="mb-1">last {LEVELS_WINDOW_SECONDS}s</div>
        <div className="flex items-end space-x-[2px] h-16 bg-black/20 rounded p-1">
          {recentPeaks.map((r, i) => (
            <div
              key={i}
              className="flex-1 bg-orange-500 rounded-sm min-h-[2px]"
              style={{ height: `${Math.min(100, Math.round((r.peak ?? 0) * 100))}%` }}
              title={`peak ${(r.peak ?? 0).toFixed(3)}`}
            />
          ))}
        </div>
      </div>

      <p className="opacity-60 text-xs">
        Live audio confirmation straight from the S-1 -- no need to say &quot;did you hear that&quot;.
        Polling s1_audio_bridge.py every {STATUS_POLL_INTERVAL_MS}ms.
      </p>
    </div>
  );
}
