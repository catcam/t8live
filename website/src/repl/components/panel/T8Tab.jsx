import { useEffect, useState } from 'react';

// audio_bridge.py (from the roland-t8 project) always binds to 127.0.0.1 on
// the Mac the T-8 is connected to. This tab only works when the browser tab
// itself is running on that same Mac (same requirement as Web MIDI/.midi()),
// since 127.0.0.1 means "this machine" from the browser's point of view.
const BRIDGE_URL = 'http://127.0.0.1:8737';
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

    // Two independent polling loops -- previously a single Promise.all
    // chain forced the fast-moving meter to wait on the slow-moving bar
    // chart's round-trip every cycle, which was the actual cause of the
    // "laggy meter" feel (and /levels was re-fetching ~94% the same
    // 5-second window every 300ms for no reason).
    async function pollStatus() {
      try {
        const res = await fetch(`${BRIDGE_URL}/status`);
        if (!res.ok) throw new Error('audio_bridge.py returned an error response');
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

export function T8Tab() {
  const { status, levels, error } = useAudioBridge();

  if (error) {
    const isHttpsPage = typeof window !== 'undefined' && window.location.protocol === 'https:';
    return (
      <div className="p-4 text-foreground space-y-2 text-sm">
        <h2 className="text-lg font-bold">T-8 Audio Bridge</h2>
        <p className="text-red-400">Not reachable: {error}</p>
        <p className="opacity-70">
          This needs Chrome running on the same Mac the T-8 is connected to, with{' '}
          <code>audio_bridge.py</code> running (it starts automatically as a LaunchAgent -- see the{' '}
          <a
            className="underline"
            href="https://codeberg.org/catcam/roland-t8"
            target="_blank"
            rel="noreferrer"
          >
            roland-t8
          </a>{' '}
          project). Check from a terminal on the Mac:
        </p>
        <pre className="bg-black/30 p-2 rounded overflow-auto">curl http://127.0.0.1:8737/health</pre>
        {isHttpsPage && (
          <p className="opacity-70">
            Note: this page is loaded over HTTPS but the bridge only speaks plain HTTP on{' '}
            <code>127.0.0.1:8737</code> -- if <code>curl</code> above works fine but this tab still
            says unreachable, your browser is likely blocking the request as mixed content (an
            HTTPS page fetching a plain-HTTP address), not an actual connectivity problem.
          </p>
        )}
      </div>
    );
  }

  if (!status) {
    return <div className="p-4 text-foreground text-sm">Connecting to audio_bridge.py...</div>;
  }

  const recentPeaks = levels.slice(-40);

  return (
    <div className="p-4 text-foreground space-y-4 text-sm">
      <h2 className="text-lg font-bold">T-8 Audio Bridge</h2>

      <div className="flex items-center space-x-2">
        <Dot ok={status.device_present} />
        <span>{status.device_present ? 'T-8 connected' : 'T-8 not detected'}</span>
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
        Live audio confirmation straight from the T-8 -- no need to say &quot;did you hear that&quot;.
        Polling audio_bridge.py every {STATUS_POLL_INTERVAL_MS}ms.
      </p>
    </div>
  );
}
