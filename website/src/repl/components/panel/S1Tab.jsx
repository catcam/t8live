import { useEffect, useState } from 'react';

// The S-1 has no audio_bridge.py equivalent (that program is specific to the
// separate roland-t8 project and only exists for the T-8) -- see
// docs/s1-implementation-plan.md §7 for why this tab deliberately stays to
// just MIDI-presence detection instead of trying to add live audio levels.
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

function Dot({ ok }) {
  return <span className={`inline-block w-2.5 h-2.5 rounded-full ${ok ? 'bg-green-600' : 'bg-red-500'}`} />;
}

export function S1Tab() {
  const midiFound = useS1MidiOutputDetected();

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

      <p className="opacity-50 text-xs">
        No audio-bridge meters here (unlike the T-8 tab) -- see{' '}
        <a
          className="underline"
          href="https://codeberg.org/catcam/t8live/src/branch/main/docs/s1-implementation-plan.md"
          target="_blank"
          rel="noreferrer"
        >
          the S-1 implementation plan
        </a>{' '}
        for why.
      </p>
    </div>
  );
}
