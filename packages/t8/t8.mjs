/*
t8.mjs - Roland AIRA Compact T-8 helpers, built on top of @strudel/midi's
existing Web MIDI output support (.midi(), .midichan(), .progNum(), .midicmd()).
Copyright (C) 2026 t8strudel contributors - see <https://codeberg.org/catcam/t8strudel>
This program is free software: you can redistribute it and/or modify it under
the terms of the GNU Affero General Public License as published by the Free
Software Foundation, either version 3 of the License, or (at your option) any
later version.

All note numbers, channels, and the clock/transport requirement below were
confirmed against a real T-8 (see the roland-t8 project's docs/T8_MANUAL.md)
using a Python/mido bridge -- this package has NOT yet been verified against
real hardware from inside a browser. Test with a real T-8 connected before
trusting it for a performance.
*/
import { register, midicmd, progNum, midichan, reify, stack, isPattern } from '@strudel/core';
import { mini } from '@strudel/mini';

// The T-8 shows up to Web MIDI as class-compliant USB-MIDI ports named
// "T-8 MIDI IN" / "T-8 MIDI OUT" as soon as it's connected in normal
// operating mode (not USB mass-storage/restore mode).
export const T8_PORT = 'T-8 MIDI IN';

// MIDI channels are 1-indexed here (webmidi.js / .midichan() convention).
export const T8_RHYTHM_CHANNEL = 10;
export const T8_BASS_CHANNEL = 2;
export const T8_PC_CHANNEL = 16;

// Confirmed against real hardware: the T-8 has 6 real rhythm voices. The
// .prm file format's extra LT/HT/CY columns don't have a confirmed
// independent MIDI note on this unit.
export const T8_RHYTHM_NOTES = {
  bd: 36,
  sd: 38,
  clap: 50,
  tom: 47,
  ch: 42,
  oh: 46,
};

/**
 * Maps T-8 rhythm voice names (bd, sd, clap, tom, ch, oh) to their real MIDI
 * notes and sets the rhythm channel (10) -- still needs .midi(T8_PORT) to
 * actually send. An unrecognized voice name throws inside the pattern query,
 * which strudel's Pattern.queryArc catches and logs rather than propagating
 * -- in practice this means the whole queried cycle goes silent (check the
 * console/log for "[t8drum] unknown T-8 voice") instead of sending a wrong
 * note, but it will NOT throw a catchable exception in your own code.
 * @name t8drum
 * @tags external_io, midi, t8
 * @example
 * t8drum("bd ~ sd ~ bd bd sd ~").midi('T-8 MIDI IN')
 */
export const t8drum = register('t8drum', (pat) => {
  return pat
    .fmap((value) => {
      const name = String(value).toLowerCase();
      const note = T8_RHYTHM_NOTES[name];
      if (note == null) {
        throw new Error(
          `[t8drum] unknown T-8 voice "${name}" -- expected one of ${Object.keys(T8_RHYTHM_NOTES).join(', ')}`,
        );
      }
      return note;
    })
    .note()
    .midichan(T8_RHYTHM_CHANNEL);
});

/**
 * Sets the T-8 bass channel (2) on a note pattern. The T-8 bass sequencer's
 * note numbering lines up with standard MIDI note numbers (confirmed against
 * real hardware), so ordinary note names work directly -- no name mapping
 * needed, just the right channel.
 * @name t8bass
 * @tags external_io, midi, t8
 * @example
 * note("c2 ~ eb3 ~").t8bass().midi('T-8 MIDI IN')
 */
export const t8bass = register('t8bass', (pat) => {
  return pat.midichan(T8_BASS_CHANNEL);
});

/**
 * Builds a Program Change pattern that selects a T-8 pattern slot (bank
 * 1-4, pattern 1-16), on the T-8's Program Change channel (16). Still needs
 * .midi(T8_PORT) to actually send. Throws immediately (not inside a pattern
 * query, unlike t8drum) if bank/pattern are out of range, since a silently
 * wrong bank/pattern number would select a real but unintended slot on the
 * device rather than doing nothing.
 * @name t8select
 * @tags external_io, midi, t8
 * @example
 * t8select(4, 15).midi('T-8 MIDI IN')
 */
export function t8select(bank, pattern) {
  if (!Number.isInteger(bank) || bank < 1 || bank > 4) {
    throw new Error(`[t8select] bank must be an integer 1-4, got ${bank}`);
  }
  if (!Number.isInteger(pattern) || pattern < 1 || pattern > 16) {
    throw new Error(`[t8select] pattern must be an integer 1-16, got ${pattern}`);
  }
  const pc = (bank - 1) * 16 + (pattern - 1);
  return progNum(pc).midichan(T8_PC_CHANNEL);
}

/**
 * A continuous MIDI Clock stream (24 PPQN), required for the T-8's remote
 * transport control to work at all. IMPORTANT: on the device itself, the
 * `SYnC` menu setting must be `AUTO` (not `InT`) for it to follow this
 * clock and respond to Start/Stop -- see the roland-t8 project's manual.
 * ticksPerCycle defaults to 48 (2 quarter notes per cycle at 24 PPQN); tune
 * it to match your cps/tempo setup.
 * @name t8clock
 * @tags external_io, midi, t8
 * @example
 * t8clock().midi('T-8 MIDI IN')
 */
export function t8clock(ticksPerCycle = 48) {
  return midicmd(mini(`clock*${ticksPerCycle}`));
}

/**
 * A continuous Clock stream with Start/Stop injected mid-stream -- the T-8
 * ignores a one-shot Start/Stop with no live clock (confirmed against real
 * hardware). startStopPattern follows midicmd's mini-notation, e.g.
 * "<start stop>/2" toggles once every 2 cycles. Requires SYnC=AUTO on the
 * device, same as t8clock.
 *
 * Note: if you pass a plain string in quotes (as in the example below), the
 * strudel transpiler already mini-notation-parses it into a Pattern before
 * this function ever sees it -- that's handled either way, whether you pass
 * a string or a pattern.
 * @name t8transport
 * @tags external_io, midi, t8
 * @example
 * t8transport("<start stop>/4").midi('T-8 MIDI IN')
 */
export function t8transport(startStopPattern = '<start stop>/2', ticksPerCycle = 48) {
  const transportPat = isPattern(startStopPattern) ? reify(startStopPattern) : mini(startStopPattern);
  return stack(midicmd(mini(`clock*${ticksPerCycle}`)), midicmd(transportPat));
}
