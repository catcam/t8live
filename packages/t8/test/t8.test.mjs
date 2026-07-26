/*
t8.test.mjs - tests of t8.mjs
Copyright (C) 2026 t8strudel contributors
This program is free software: you can redistribute it and/or modify it under
the terms of the GNU Affero General Public License as published by the Free
Software Foundation, either version 3 of the License, or (at your option) any
later version.

Note: these tests call mini() directly to build patterns, the same way the
real strudel transpiler auto-wraps double-quoted string literals in user code
before it reaches these functions -- see t8.mjs's own comments for why
t8transport() has to handle both a raw string and an already-parsed Pattern.
*/
import { note } from '@strudel/core';
import { mini } from '@strudel/mini';
import { describe, it, expect } from 'vitest';
import { t8drum, t8bass, t8select, t8clock, t8transport, T8_RHYTHM_NOTES } from '../t8.mjs';

describe('t8drum', () => {
  it('maps T-8 voice names to their confirmed MIDI notes on channel 10', () => {
    const haps = t8drum(mini('bd sd clap tom ch oh')).queryArc(0, 1);
    expect(haps.map((h) => h.value.note)).toEqual([
      T8_RHYTHM_NOTES.bd,
      T8_RHYTHM_NOTES.sd,
      T8_RHYTHM_NOTES.clap,
      T8_RHYTHM_NOTES.tom,
      T8_RHYTHM_NOTES.ch,
      T8_RHYTHM_NOTES.oh,
    ]);
    expect(haps.every((h) => h.value.midichan === 10)).toBe(true);
  });

  it('respects rests', () => {
    const haps = t8drum(mini('bd ~ sd ~')).queryArc(0, 1);
    expect(haps.length).toBe(2);
  });

  it('errors instead of sending a wrong note for an unknown voice name', () => {
    // Pattern.queryArc catches query-time errors and logs them rather than
    // throwing (see packages/core/pattern.mjs) -- so an unknown voice name
    // anywhere in the queried arc surfaces as an empty result, not a thrown
    // exception. This still beats silently sending a bogus MIDI note.
    const haps = t8drum(mini('bd xyz')).queryArc(0, 1);
    expect(haps).toEqual([]);
  });
});

describe('t8bass', () => {
  it('sets channel 2 without altering note values (T-8 bass numbering matches MIDI)', () => {
    const haps = t8bass(note(mini('c2 eb3'))).queryArc(0, 1);
    expect(haps.every((h) => h.value.midichan === 2)).toBe(true);
    expect(haps.map((h) => h.value.note)).toEqual(['c2', 'eb3']);
  });
});

describe('t8select', () => {
  it('computes the Program Change number from bank/pattern on channel 16', () => {
    // bank 4, pattern 15 -> confirmed on real hardware as PC=62 (device showed "4-15")
    const haps = t8select(4, 15).queryArc(0, 1);
    expect(haps[0].value.progNum).toBe(62);
    expect(haps[0].value.midichan).toBe(16);
  });

  it('matches bank 1 pattern 1 as PC=0', () => {
    const haps = t8select(1, 1).queryArc(0, 1);
    expect(haps[0].value.progNum).toBe(0);
  });
});

describe('t8clock', () => {
  it('produces one clock message per tick, ticksPerCycle times per cycle', () => {
    const haps = t8clock(4).queryArc(0, 1);
    expect(haps.length).toBe(4);
    expect(haps.every((h) => h.value.midicmd === 'clock')).toBe(true);
  });
});

describe('t8transport', () => {
  it('stacks a continuous clock with start/stop, both as plain string midicmd values', () => {
    const haps = t8transport(mini('<start stop>/2'), 4).queryArc(0, 2);
    const clockHaps = haps.filter((h) => h.value.midicmd === 'clock');
    const transportHaps = haps.filter((h) => h.value.midicmd === 'start' || h.value.midicmd === 'stop');
    expect(clockHaps.length).toBe(8); // 4 ticks/cycle * 2 cycles
    expect(transportHaps.length).toBeGreaterThan(0);
    expect(transportHaps[0].value.midicmd).toBe('start');
  });

  it('also works with a raw (unparsed) string, not just a Pattern', () => {
    const haps = t8transport('<start stop>/2', 4).queryArc(0, 1);
    expect(haps.some((h) => h.value.midicmd === 'start')).toBe(true);
  });
});
