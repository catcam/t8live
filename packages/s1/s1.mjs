/*
s1.mjs - Roland AIRA Compact S-1 helpers, built on top of @strudel/midi's
existing Web MIDI output support (.midi(), .midichan(), .ccn(), .ccv(),
.progNum(), .midicmd()).
Copyright (C) 2026 t8live contributors - see <https://codeberg.org/catcam/t8live>
This program is free software: you can redistribute it and/or modify it under
the terms of the GNU Affero General Public License as published by the Free
Software Foundation, either version 3 of the License, or (at your option) any
later version.

Channels, CC numbers, and Program Change range below come from Roland's own
official S-1 MIDI implementation chart (v1.02, static.roland.com) - see
docs/s1-implementation-plan.md in this repo for the full sourced writeup.

The Clock/Start/Stop transport behavior WAS confirmed against a real S-1
(2026-07-31, raw python-rtmidi test bypassing the browser entirely - see
docs/s1-implementation-plan.md §3): unlike the T-8, the S-1 follows external
MIDI Clock/Start/Stop immediately with no on-device mode toggle needed, so
s1clock/s1transport below do NOT carry the T-8's autostart:false workaround.

s1clock/s1transport intentionally duplicate t8clock/t8transport's small
clock-generation body rather than sharing an extracted helper from
@strudel/midi - the underlying math is identical, but the T-8 package is
already hardware-confirmed and this project's own convention is minimal
diffs to working code, not opportunistic refactors. If a third device ever
needs the same clock generator, that's the point to extract it for real.

s1polyMode is NOT hardware-confirmed: the chart lists CC 80 as "POLY MODE"
but does not spell out which of Poly/Mono/Unison/Chord corresponds to which
CC value, or whether the four modes are evenly spaced steps across 0-127.
It's exposed here as a raw 0-1 passthrough (like s1cc) rather than a named
enum, specifically so it doesn't assert mode boundaries nobody has verified.
*/
import { register, ccn, ccv, progNum, midicmd, reify, stack, isPattern } from '@strudel/core';
import { mini } from '@strudel/mini';

// The S-1 shows up to Web MIDI as class-compliant USB-MIDI ports named
// "S-1 MIDI IN" / "S-1 MIDI OUT" as soon as it's connected (confirmed via
// both Web MIDI and python-rtmidi port listings on real hardware).
export const S1_PORT = 'S-1 MIDI IN';

// MIDI channels are 1-indexed here (webmidi.js / .midichan() convention).
export const S1_NOTE_CHANNEL = 3;
export const S1_PC_CHANNEL = 16;

// Full CC list from the official chart (docs/s1-implementation-plan.md §1.3),
// camelCased from the chart's own parameter names so each key traces back to
// a specific documented CC number. A few short aliases are added for the
// most commonly automated params (cutoff, resonance, attack, decay, release,
// lfoRate) without dropping the traceable long-form name.
export const S1_CC = {
  modulationWheel: 1,
  lfoRate: 3,
  portamentoTime: 5,
  pan: 10,
  expressionPedal: 11,
  lfoWaveForm: 12,
  oscLfo: 13,
  oscRange: 14,
  oscPulseWidth: 15,
  oscPwmSource: 16,
  lfoModulationDepth: 17,
  oscBendSens: 18,
  oscLevel: 19,
  oscLevel2: 20, // second OSC
  oscSubOscLevel: 21,
  oscSubOctType: 22,
  oscNoiseLevel: 23,
  filterEnvelope: 24,
  filterLfo: 25,
  filterKeyboardFollow: 26,
  filterBendSens: 27,
  ampEnvelopeModeSw: 28,
  envTriggerMode: 29,
  envSustain: 30,
  portamentoMode: 31,
  damperPedal: 64,
  portamento: 65, // on/off
  filterResonance: 71,
  resonance: 71, // alias
  envRelease: 72,
  release: 72, // alias
  envAttack: 73,
  attack: 73, // alias
  filterFrequency: 74,
  cutoff: 74, // alias
  envDecay: 75,
  decay: 75, // alias
  fineTune: 76,
  transposeSw: 77,
  noiseMode: 78,
  lfoMode: 79,
  polyMode: 80,
  chordVoice2Sw: 81,
  chordVoice3Sw: 82,
  chordVoice4Sw: 83,
  chordVoice2KeyShift: 85,
  chordVoice3KeyShift: 86,
  chordVoice4KeyShift: 87,
  reverbTime: 89,
  delayTime: 90,
  reverbLevel: 91,
  delayLevel: 92,
  chorus: 93,
  oscDrawMultiply: 102,
  oscChopOvertone: 103,
  oscChopComb: 104,
  lfoKeyTrigger: 105,
  lfoSync: 106,
  oscDrawSw: 107,
};

/**
 * Sets the S-1's synth channel (3) on a note pattern. The chart confirms a
 * true 0-127 voice range with no internal remapping, so ordinary note names
 * work directly -- no name mapping needed, just the right channel. The S-1
 * is 4-voice polyphonic (Poly/Mono/Unison/Chord via polyMode/S1_CC.polyMode),
 * not monophonic, so stacked/chorded note patterns are a first-class case,
 * not a workaround.
 * @name s1note
 * @tags external_io, midi, s1
 * @example
 * note("c3 eb4 g3").s1note().midi('S-1 MIDI IN')
 */
export const s1note = register('s1note', (pat) => {
  return pat.midichan(S1_NOTE_CHANNEL);
});

/**
 * Named-parameter CC helper for the S-1: pass either a name from S1_CC
 * (e.g. 'cutoff', 'resonance', 'lfoRate') or a raw CC number 0-127, plus a
 * 0-1 value pattern. Returns a standalone controller pattern (ccv+ccn) the
 * same shape as calling .ccn(N).ccv(value) directly -- combine with other
 * patterns via stack() or chain .midichan(3)/.midi(S1_PORT) as needed.
 * Throws immediately (not inside a pattern query) on an unknown name, since
 * a wrong CC number reaching real hardware can silently detune or mute the
 * instrument rather than just skip a hit -- a worse failure mode than
 * s1note's per-event errors would be for this.
 * @name s1cc
 * @tags external_io, midi, s1
 * @example
 * s1cc('cutoff', sine.slow(4)).midichan(3).midi('S-1 MIDI IN')
 */
export function s1cc(nameOrNumber, valuePattern) {
  let n = nameOrNumber;
  if (typeof n === 'string') {
    if (!(n in S1_CC)) {
      throw new Error(`[s1cc] unknown S-1 parameter "${n}" -- expected a CC number or one of ${Object.keys(S1_CC).join(', ')}`);
    }
    n = S1_CC[n];
  }
  if (!Number.isInteger(n) || n < 0 || n > 127) {
    throw new Error(`[s1cc] CC number must be an integer 0-127, got ${n}`);
  }
  const pat = isPattern(valuePattern) ? reify(valuePattern) : mini(valuePattern);
  return ccv(pat).ccn(n);
}

/**
 * Raw 0-1 passthrough for CC 80 (POLY MODE). NOT hardware-verified: the
 * official chart names the CC but not its Poly/Mono/Unison/Chord value
 * boundaries, so this deliberately does not offer named mode arguments --
 * sweep/set the raw 0-1 range yourself and listen, or use s1cc('polyMode',
 * value) directly, which this just aliases for discoverability.
 * @name s1polyMode
 * @tags external_io, midi, s1
 * @example
 * s1polyMode(0).midichan(3).midi('S-1 MIDI IN')
 */
export function s1polyMode(valuePattern) {
  return s1cc('polyMode', valuePattern);
}

/**
 * Builds a Program Change pattern that selects an S-1 patch slot (0-63,
 * flat range -- the chart shows no bank/pattern split the way the T-8's
 * t8select does), on the S-1's Program Change channel (16). Still needs
 * .midi(S1_PORT) to actually send. Throws immediately (not inside a pattern
 * query) if out of range, since a silently wrong patch number would select
 * a real but unintended slot on the device rather than doing nothing.
 * @name s1select
 * @tags external_io, midi, s1
 * @example
 * s1select(12).midi('S-1 MIDI IN')
 */
export function s1select(patch) {
  if (!Number.isInteger(patch) || patch < 0 || patch > 63) {
    throw new Error(`[s1select] patch must be an integer 0-63, got ${patch}`);
  }
  return progNum(patch).midichan(S1_PC_CHANNEL);
}

/**
 * A continuous MIDI Clock stream (24 PPQN). Confirmed against a real S-1
 * (2026-07-31): unlike the T-8, no on-device mode toggle is needed -- the
 * S-1 starts following as soon as Clock+Start arrive. ticksPerCycle
 * defaults to 48 (2 quarter notes per cycle at 24 PPQN); tune it to match
 * your cps/tempo setup.
 * @name s1clock
 * @tags external_io, midi, s1
 * @example
 * s1clock().midi('S-1 MIDI IN')
 */
export function s1clock(ticksPerCycle = 48) {
  return midicmd(mini(`clock*${ticksPerCycle}`));
}

/**
 * A continuous Clock stream with Start/Stop injected mid-stream.
 * startStopPattern follows midicmd's mini-notation, e.g. "<start stop>/2"
 * toggles once every 2 cycles. Confirmed against real hardware (2026-07-31):
 * the S-1's sequencer/arpeggiator responded to Start within ~0.6s with no
 * special device-side setup, unlike the T-8's SYnC=AUTO requirement.
 *
 * Note: if you pass a plain string in quotes (as in the example below), the
 * strudel transpiler already mini-notation-parses it into a Pattern before
 * this function ever sees it -- that's handled either way, whether you pass
 * a string or a pattern.
 * @name s1transport
 * @tags external_io, midi, s1
 * @example
 * s1transport("<start stop>/4").midi('S-1 MIDI IN')
 */
export function s1transport(startStopPattern = '<start stop>/2', ticksPerCycle = 48) {
  const transportPat = isPattern(startStopPattern) ? reify(startStopPattern) : mini(startStopPattern);
  return stack(midicmd(mini(`clock*${ticksPerCycle}`)), midicmd(transportPat));
}
