/*
s1.test.mjs - tests of s1.mjs
Copyright (C) 2026 t8live contributors
This program is free software: you can redistribute it and/or modify it under
the terms of the GNU Affero General Public License as published by the Free
Software Foundation, either version 3 of the License, or (at your option) any
later version.

Note: these tests call mini() directly to build patterns, the same way the
real strudel transpiler auto-wraps double-quoted string literals in user code
before it reaches these functions -- see t8.test.mjs's own comment for why
this matters (it caught a real bug in t8transport's string-vs-Pattern
handling that direct function calls with plain values would have missed).
*/
import { note, stack } from '@strudel/core';
import { mini } from '@strudel/mini';
import { describe, it, expect } from 'vitest';
import { s1note, s1cc, s1polyMode, s1chord, s1select, s1clock, s1transport, S1_CC } from '../s1.mjs';

describe('s1note', () => {
  it('sets channel 3 without altering note values', () => {
    const haps = s1note(note(mini('c3 eb4 g3'))).queryArc(0, 1);
    expect(haps.every((h) => h.value.midichan === 3)).toBe(true);
    expect(haps.map((h) => h.value.note)).toEqual(['c3', 'eb4', 'g3']);
  });

  it('does not squash a stacked (chord) note pattern to a single voice', () => {
    // S-1 is 4-voice polyphonic (Poly/Mono/Unison/Chord) unlike the T-8's
    // monophonic bass channel -- a chord stacked on one step must survive.
    const chord = stack(note('c3'), note('eb3'), note('g3'), note('bb3'));
    const haps = s1note(chord).queryArc(0, 1);
    expect(haps.length).toBe(4);
    expect(haps.every((h) => h.value.midichan === 3)).toBe(true);
    expect(new Set(haps.map((h) => h.value.note))).toEqual(new Set(['c3', 'eb3', 'g3', 'bb3']));
  });
});

describe('s1cc', () => {
  it('resolves a named parameter to its documented CC number', () => {
    const haps = s1cc('cutoff', mini('0.5')).queryArc(0, 1);
    expect(haps[0].value.ccn).toBe(S1_CC.cutoff);
    expect(haps[0].value.ccn).toBe(74);
    expect(haps[0].value.ccv).toBe(0.5);
  });

  it('long-form and short-alias names resolve to the same CC', () => {
    expect(S1_CC.filterFrequency).toBe(S1_CC.cutoff);
    expect(S1_CC.filterResonance).toBe(S1_CC.resonance);
    expect(S1_CC.envAttack).toBe(S1_CC.attack);
    expect(S1_CC.envDecay).toBe(S1_CC.decay);
    expect(S1_CC.envRelease).toBe(S1_CC.release);
  });

  it('accepts a raw CC number instead of a name', () => {
    const haps = s1cc(3, mini('0.25')).queryArc(0, 1); // lfoRate
    expect(haps[0].value.ccn).toBe(3);
  });

  it('throws immediately (not inside a query) for an unknown parameter name', () => {
    expect(() => s1cc('doesNotExist', mini('0.5'))).toThrow(/unknown S-1 parameter/);
  });

  it('throws immediately for an out-of-range raw CC number', () => {
    expect(() => s1cc(128, mini('0.5'))).toThrow(/CC number must be an integer 0-127/);
  });

  it('gives a helpful error if the name arg is transpiler-wrapped (double-quoted) instead of a plain string', () => {
    // Reproduces a real mistake made testing this live: s1cc("cutoff", ...) in
    // the actual REPL auto-wraps "cutoff" into a Pattern via the transpiler,
    // same as register()'s own name argument -- see register()'s identical
    // error message in packages/core/pattern.mjs for the established
    // convention this mirrors.
    expect(() => s1cc(mini('cutoff'), mini('0.5'))).toThrow(/try using single quotes/);
  });
});

describe('s1chord', () => {
  it('sets a single chord-voice switch to the right CC', () => {
    const haps = s1chord({ voice2: true }).queryArc(0, 1);
    expect(haps[0].value.ccn).toBe(S1_CC.chordVoice2Sw);
    expect(haps[0].value.ccn).toBe(81);
    expect(haps[0].value.ccv).toBe(1);
  });

  it('turning a voice off sends ccv=0, not just omitting it', () => {
    const haps = s1chord({ voice3: false }).queryArc(0, 1);
    expect(haps[0].value.ccn).toBe(82);
    expect(haps[0].value.ccv).toBe(0);
  });

  it('combines multiple voices/shifts into one stacked pattern', () => {
    const haps = s1chord({ voice2: true, voice2Shift: 0.6, voice4: true }).queryArc(0, 1);
    const ccns = haps.map((h) => h.value.ccn).sort((a, b) => a - b);
    expect(ccns).toEqual([81, 83, 85]); // chordVoice2Sw, chordVoice4Sw, chordVoice2KeyShift
  });

  it('throws if called with no arguments at all', () => {
    expect(() => s1chord()).toThrow(/pass at least one of/);
    expect(() => s1chord({})).toThrow(/pass at least one of/);
  });
});

describe('s1polyMode', () => {
  it('is a thin alias for s1cc("polyMode", ...)', () => {
    const haps = s1polyMode(mini('1')).queryArc(0, 1);
    expect(haps[0].value.ccn).toBe(S1_CC.polyMode);
    expect(haps[0].value.ccn).toBe(80);
  });
});

describe('s1select', () => {
  it('sends the patch number as-is (flat 0-63 range) on channel 16', () => {
    const haps = s1select(12).queryArc(0, 1);
    expect(haps[0].value.progNum).toBe(12);
    expect(haps[0].value.midichan).toBe(16);
  });

  it('accepts the boundary values 0 and 63', () => {
    expect(s1select(0).queryArc(0, 1)[0].value.progNum).toBe(0);
    expect(s1select(63).queryArc(0, 1)[0].value.progNum).toBe(63);
  });

  it('throws immediately on an out-of-range patch number', () => {
    expect(() => s1select(64)).toThrow(/patch must be an integer 0-63/);
    expect(() => s1select(-1)).toThrow(/patch must be an integer 0-63/);
  });
});

describe('s1clock', () => {
  it('produces one clock message per tick, ticksPerCycle times per cycle', () => {
    const haps = s1clock(4).queryArc(0, 1);
    expect(haps.length).toBe(4);
    expect(haps.every((h) => h.value.midicmd === 'clock')).toBe(true);
  });
});

describe('s1transport', () => {
  it('stacks a continuous clock with start/stop, both as plain string midicmd values', () => {
    const haps = s1transport(mini('<start stop>/2'), 4).queryArc(0, 2);
    const clockHaps = haps.filter((h) => h.value.midicmd === 'clock');
    const transportHaps = haps.filter((h) => h.value.midicmd === 'start' || h.value.midicmd === 'stop');
    expect(clockHaps.length).toBe(8); // 4 ticks/cycle * 2 cycles
    expect(transportHaps.length).toBeGreaterThan(0);
    expect(transportHaps[0].value.midicmd).toBe('start');
  });

  it('also works with a raw (unparsed) string, not just a Pattern', () => {
    const haps = s1transport('<start stop>/2', 4).queryArc(0, 1);
    expect(haps.some((h) => h.value.midicmd === 'start')).toBe(true);
  });
});
