import { useSettings } from '@src/settings.mjs';

const { BASE_URL } = import.meta.env;
const baseNoTrailing = BASE_URL.endsWith('/') ? BASE_URL.slice(0, -1) : BASE_URL;

export function WelcomeTab({ context }) {
  const { fontFamily } = useSettings();
  return (
    <div className="prose dark:prose-invert min-w-full py-4 font-sans px-4 text-sm" style={{ fontFamily }}>
      <h3>welcome</h3>
      <p>
        You have found <span className="underline">t8live</span>, a live coding platform for the{' '}
        <span className="underline">Roland AIRA Compact T-8</span> beat machine, built on top of Strudel! It is free
        and open-source. To get started:
        <br />
        <br />
        <span className="underline">1. hit play</span> - <span className="underline">2. change something</span> -{' '}
        <span className="underline">3. hit update</span>
      </p>
      <p>
        To get started, check out the{' '}
        <a href={`${baseNoTrailing}/workshop/getting-started/`} target="_blank">
          interactive tutorial
        </a>
        . Also feel free to join the{' '}
        <a href="https://discord.com/invite/HGEdXmRkzT" target="_blank">
          discord channel
        </a>{' '}
        to ask any questions, give feedback or just say hello.
      </p>
      <h3>using the T-8</h3>
      <p>
        Connect the T-8 over USB and open this page in Chrome <span className="underline">on the same machine</span>{' '}
        the device is plugged into — Web MIDI only sees devices local to the browser. Chrome also requires a secure
        context (HTTPS, or an address that is literally <code>localhost</code>) before it exposes MIDI at all.
      </p>
      <p>
        A few functions are added on top of Strudel for the T-8 (see the <span className="underline">t8</span> tab
        for live audio confirmation from the device):
      </p>
      <pre className="bg-black/30 p-2 rounded overflow-auto text-xs">
        {`// trigger drum voices by name (bd, sd, clap, tom, ch, oh)
t8drum("bd ~ sd ~ bd bd sd ~").midi('T-8 MIDI IN')

// bass line -- standard note names, no mapping needed
note("c2 ~ eb3 ~").t8bass().midi('T-8 MIDI IN')

// select bank 4 pattern 15 on the device
t8select(4, 15).midi('T-8 MIDI IN')

// drive the T-8's own transport (device menu: SYnC must be AUTO)
t8transport("<start stop>/4").midi('T-8 MIDI IN')`}
      </pre>
      <p>
        Full reference, known bugs, and workflow notes live in the repo's{' '}
        <a href="https://codeberg.org/catcam/t8live" target="_blank">
          README
        </a>
        .
      </p>
      <h3>about</h3>
      <p>
        t8live is a fork of{' '}
        <a href="https://codeberg.org/uzu/strudel" target="_blank">
          strudel
        </a>
        , a JavaScript version of{' '}
        <a href="https://tidalcycles.org/" target="_blank">
          tidalcycles
        </a>
        , which is a popular live coding language for music, written in Haskell. t8live is free/open source
        software: you can redistribute and/or modify it under the terms of the{' '}
        <a href="https://codeberg.org/catcam/t8live/src/branch/main/LICENSE" target="_blank">
          GNU Affero General Public License
        </a>
        . You can find the source code at{' '}
        <a href="https://codeberg.org/catcam/t8live" target="_blank">
          codeberg
        </a>
        . You can also find <a href="https://github.com/felixroos/dough-samples/blob/main/README.md">licensing info</a>{' '}
        for the default sound banks there. Please consider to{' '}
        <a href="https://opencollective.com/tidalcycles" target="_blank">
          support the strudel project
        </a>{' '}
        to ensure ongoing development of the engine t8live is built on 💖
      </p>
      <h3>credits</h3>
      <p>
        t8live is built by <span className="underline">Nikša Barlović</span> with{' '}
        <span className="underline">Claude</span> (Anthropic), on top of the work of the{' '}
        <a href="https://codeberg.org/uzu/strudel/activity/contributors" target="_blank">
          strudel and tidalcycles contributors
        </a>
        . All credit for the pattern engine, mini-notation language, and audio engine belongs to them.
      </p>
    </div>
  );
}
