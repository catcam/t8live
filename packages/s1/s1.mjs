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
 *
 * All 54 CCs in S1_CC are officially "Recognized" per the S-1's own MIDI
 * chart (docs/s1-implementation-plan.md §1.3, resolved against the PDF
 * manual 2026-07-31), so in principle every name here should do something.
 * In practice, 31 of them are only reachable on the physical panel via a
 * [SHIFT]+knob/pad gesture, and the chart listing them as ordinary CC
 * numbers is NOT proof they behave like one -- at least one (oscPulseWidth,
 * CC 15) is hardware-confirmed to do nothing at all. All 31 SHIFT-combo CCs
 * have now been individually tested against real hardware (2026-07-31/
 * 2026-08-01, see plan doc §9 item 4 for full methodology and per-CC
 * numbers). Per-CC confidence, from that testing:
 *
 * CONFIRMED WORKING (clear, multi-metric spectral change well above the
 * observed noise floor): fineTune (76), transposeSw (77), filterBendSens
 * (27, tested with an active pitch-bend message since it's inert without
 * one).
 *
 * LIKELY WORKING (moderate confidence -- effect size clearly above the
 * ~6% noise-floor ceiling seen among the confirmed-negative CCs, but only
 * tested once, not to CC15's more rigorous two-configuration bar):
 * oscChopOvertone (103).
 *
 * CONFIRMED NOT WORKING: oscPulseWidth (15, two independent test
 * configurations -- plain depth sweep and LFO-routed-to-osc sweep, see
 * plan doc §9 item 4 for the full writeup).
 *
 * NO EFFECT DETECTED (single-pass baseline-vs-extreme test, same method as
 * the "likely/confirmed working" bucket above but the result came back
 * flat -- weaker evidence than CC15's confirmed-broken status since each
 * of these was only tested once): oscPwmSource (16), lfoModulationDepth
 * (17), oscBendSens (18, pitch-bend tested), oscSubOctType (22),
 * ampEnvelopeModeSw (28), envTriggerMode (29), portamentoMode (31),
 * noiseMode (78), lfoMode (79), chordVoice3Sw (82), chordVoice4Sw (83),
 * chordVoice3KeyShift (86), chordVoice4KeyShift (87), reverbTime (89),
 * delayTime (90), chorus (93), oscDrawMultiply (102), oscChopComb (104),
 * lfoKeyTrigger (105), lfoSync (106), oscDrawSw (107). Several of these
 * (envTriggerMode, portamentoMode, reverbTime, delayTime) plausibly need a
 * different test shape than "one held note, baseline vs extreme value" to
 * reveal an effect at all (e.g. portamentoMode's effect would only show up
 * across a note-to-note transition, not a single held note) -- a flat
 * result here is genuinely weaker evidence of brokenness than it is for a
 * CC whose effect *should* be visible on a single held note.
 *
 * INCONCLUSIVE (ambiguous or methodology-limited, don't treat either
 * direction as established): portamentoTime (5, original finding, pitch
 * tracker confused by subharmonic content), filterKeyboardFollow (26,
 * cross-note test gave a result dominated by broadband low-frequency
 * content rather than a clean cutoff-vs-pitch scaling signal),
 * chordVoice2Sw (81, borderline centroid shift but near-identical spectral
 * shape -- weaker signal than a genuine added voice should produce),
 * chordVoice2KeyShift (85, see s1chord's JSDoc -- a dedicated differential
 * FFT test found no isolable added-voice pitch at any key-shift value).
 *
 * A community Pd project's author independently reported the same kind of
 * difficulty with SHIFT-combo CCs generally (plan doc §4), consistent with
 * more than one of them not working as advertised. Treat any SHIFT-combo
 * name not in the "confirmed/likely working" buckets above with real
 * caution -- "no effect detected" is not the same confidence level as
 * CC15's "confirmed not working," but it's not a green light either.
 * @name s1cc
 * @tags external_io, midi, s1
 * @example
 * s1cc('cutoff', sine.slow(4)).midichan(3).midi('S-1 MIDI IN')
 */
export function s1cc(nameOrNumber, valuePattern) {
  let n = nameOrNumber;
  if (isPattern(n)) {
    throw new Error(
      "[s1cc] name/CC argument is a pattern, try using single quotes ('cutoff') instead of double quotes (\"cutoff\") -- the strudel transpiler auto-wraps double-quoted strings into patterns, which s1cc's name argument isn't meant to be",
    );
  }
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
 * Raw 0-1 passthrough for CC 80 (POLY MODE). PARTIALLY hardware-verified
 * (2026-07-31, spectral/FFT analysis of real S-1 audio via the audio
 * bridge, not just listening): a 4-note chord sent at CC80=0/16/32
 * consistently produces a SPARSE spectrum (one fundamental + its own
 * harmonics -- single-voice-like behavior), while CC80=40 through 127
 * consistently produces a RICH spectrum (multiple simultaneous
 * fundamentals, including pitches NOT in the sent chord -- consistent with
 * chord-voice auto-generation, not simple 4-voice polyphony of exactly what
 * was sent). That's a real, reproduced 2-way split, confirmed twice.
 * **Mono vs Unison follow-up (2026-07-31, single sustained note instead of
 * a chord):** CC80=16 produced NO audible output for a single note (twice,
 * reproducible) despite audibly working for a 4-note chord in the earlier
 * test -- single-note and chord behavior genuinely differ at this value,
 * not a test artifact. CC80=32 gave one clean spectral peak (no detected
 * pitch-splitting) plus a strong ~10.6 Hz amplitude envelope beat --
 * *suggestive* of unison-style oscillator detuning (which would show as
 * exactly this kind of beating between near-identical pitches), but
 * inconclusive: a patch-level tremolo/LFO would look identical by this
 * method. **Left unresolved, honestly** -- don't trust a 4-way name
 * mapping from this data, it still isn't there, just a bit more textured
 * than a flat "unknown."
 * **CC80=0 specifically produced NO audible output at all, twice,
 * reproducibly, for both chord and single-note tests** -- a real usable
 * finding: don't default anything to exactly 0 without expecting silence.
 * **Manual cross-reference (2026-07-31, docs/s1-implementation-plan.md §9
 * item 3):** the S-1 owner's manual body names and defines the four POLY
 * modes directly -- Mono ("plays single tones"), Unison ("stacks multiple
 * tones to play a layered note"), Poly (up to 4 simultaneous voices as
 * literally played), Chord ("plays voices 2-4 ... according to the
 * parameter settings", i.e. auto-generated extra voices). This text is a
 * strong match for the spectral data above: the "rich, extra pitches not
 * in the sent chord" result lines up with Chord's own definition, and the
 * "one clean peak + amplitude beat" result for a single note at CC80=32
 * lines up with Unison's definition (stacked near-identical pitches beat
 * against each other). That narrows the story but still does NOT establish
 * the exact CC-value boundaries between all four modes (the manual gives
 * names, not CC80 numbers), and doesn't explain why CC80=16 was silent for
 * a single note the way a plain Mono mode shouldn't be.
 * **CC80=32 Unison hypothesis CONFIRMED (2026-08-01), decisive test:**
 * played the same CC80=32 test at two notes two octaves apart (c4=261.6Hz,
 * c6=1046.5Hz -- substituted for the original c3/c5 idea because c3 turned
 * out to be silent on the test unit's current patch for unrelated reasons)
 * and compared the amplitude-envelope beat frequency (Hilbert-envelope FFT)
 * between them. Result: beat frequency scaled from 2.15 Hz at c4 to 8.38 Hz
 * at c6, a 3.90x ratio against a theoretical 4.00x pitch ratio (~2.5% off
 * an exact match) -- this is the signature of genuine unison detuning (two
 * oscillators a fixed number of cents apart; cents are multiplicative, so
 * the beat Hz scales with the fundamental), and rules out a fixed-rate
 * LFO/tremolo (which would hold the beat frequency constant regardless of
 * note pitch). Absolute beat-Hz values are not expected to match the
 * original 2026-07-31 c3 measurement (~10.6 Hz) session-to-session --
 * what matters for Mono-vs-Unison is the *within-test* scaling, which came
 * out clean. **CC80=32 is confirmed Unison, not a patch-level tremolo.**
 * This still does NOT establish the exact CC-value boundaries for all four
 * modes (Mono/Poly/Chord numeric ranges remain unmapped) or explain the
 * CC80=16 single-note silence above, so this still deliberately does not
 * offer named mode arguments -- sweep/set the raw 0-1 range yourself, or
 * use s1cc('polyMode', value) directly, which this just aliases for
 * discoverability.
 * @name s1polyMode
 * @tags external_io, midi, s1
 * @example
 * s1polyMode(0.5).midichan(3).midi('S-1 MIDI IN')
 */
export function s1polyMode(valuePattern) {
  return s1cc('polyMode', valuePattern);
}

/**
 * Composite helper for the S-1's chord-voice CCs (81-83 on/off switches,
 * 85-87 key-shift amounts) -- a single call instead of six separate s1cc
 * calls. Confirmed live (2026-07-31, FFT analysis) that chord-voice content
 * audibly appears once CC80/poly-mode is in its "rich" region even with
 * these CCs left at their power-on defaults, producing pitches you didn't
 * ask for -- use this to set the voices explicitly instead of inheriting
 * whatever the default key-shift amounts happen to be.
 * Only pass the voices/shifts you want to set; omitted ones aren't sent.
 * Key-shift is a raw 0-1 CC passthrough like s1cc's value args -- the exact
 * semitone range/center-point for CC 85-87 is NOT hardware-verified (the
 * chart gives no value table for it), so this does not attempt to convert
 * "semitones" into a CC value for you. Sweep and listen.
 *
 * **Calibration attempt, inconclusive (2026-08-01):** tried to establish
 * the real semitone mapping by playing a fixed root note, enabling
 * chordVoice2Sw with CC80/poly-mode pinned to its known-audible single-note
 * value (32), and sweeping chordVoice2KeyShift through 0/0.25/0.5/0.75/1.0
 * while looking for a second pitch (via both raw peak-picking and a
 * differential FFT against a chord-off reference capture, to cancel out a
 * broadband low-frequency noise floor that dominated raw peak-picking).
 * Neither method found a clean, consistently-tracking second-voice
 * fundamental across the five key-shift values -- the strongest
 * non-root-harmonic energy found was small (a few tenths of a percent of
 * total spectral energy) and didn't move in a way consistent with a real
 * pitch sweep. This matches the broader batch SHIFT-combo test's own
 * borderline read on chordVoice2Sw itself (s1cc's JSDoc, "INCONCLUSIVE"
 * bucket) -- it's not clear the chord-voice mechanism was reliably audible
 * under any tested configuration, whether that's because it genuinely
 * needs a true multi-note chord as input (per the manual's own "Chord"
 * definition -- see s1polyMode's JSDoc) rather than a single re-harmonized
 * note, or because the added voice is mixed too quietly to register over
 * this capture chain's noise floor. Per this project's own rule against
 * inventing a conversion formula from noisy data: key-shift stays raw and
 * undocumented in semitones, no `semitones` option was added. Revisit with
 * a real multi-note chord input and/or a quieter capture setup if someone
 * wants another pass at this.
 * @name s1chord
 * @tags external_io, midi, s1
 * @example
 * s1chord({ voice2: true, voice2Shift: 0.6, voice3: true, voice3Shift: 0.4 }).midichan(3).midi('S-1 MIDI IN')
 */
export function s1chord({
  voice2,
  voice3,
  voice4,
  voice2Shift,
  voice3Shift,
  voice4Shift,
} = {}) {
  const parts = [];
  if (voice2 !== undefined) parts.push(s1cc('chordVoice2Sw', voice2 ? '1' : '0'));
  if (voice3 !== undefined) parts.push(s1cc('chordVoice3Sw', voice3 ? '1' : '0'));
  if (voice4 !== undefined) parts.push(s1cc('chordVoice4Sw', voice4 ? '1' : '0'));
  if (voice2Shift !== undefined) parts.push(s1cc('chordVoice2KeyShift', String(voice2Shift)));
  if (voice3Shift !== undefined) parts.push(s1cc('chordVoice3KeyShift', String(voice3Shift)));
  if (voice4Shift !== undefined) parts.push(s1cc('chordVoice4KeyShift', String(voice4Shift)));
  if (parts.length === 0) {
    throw new Error('[s1chord] pass at least one of voice2/voice3/voice4/voice2Shift/voice3Shift/voice4Shift');
  }
  return parts.length === 1 ? parts[0] : stack(...parts);
}

/**
 * Builds a Program Change pattern that selects an S-1 patch slot (0-63,
 * flat range -- the chart shows no bank/pattern split the way the T-8's
 * t8select does), on the S-1's Program Change channel (16). Still needs
 * .midi(S1_PORT) to actually send. Throws immediately (not inside a pattern
 * query) if out of range, since a silently wrong patch number would select
 * a real but unintended slot on the device rather than doing nothing.
 *
 * If this appears to do nothing on a real unit, check two S-1 menu
 * settings before assuming a bug (found reading the manual body,
 * docs/s1-implementation-plan.md §9 item 5): "rxPc" (Rx Program Change)
 * must be On for incoming Program Change to actually switch patches, and
 * "Pc.Ch" (Program Change Channel) is independently configurable 1-16 and
 * may have been changed away from the documented default of 16 -- neither
 * is queryable over MIDI (no SysEx, §1.5), so a silent no-op is the only
 * symptom you'd see.
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
 *
 * Nuance found reading the manual body (docs/s1-implementation-plan.md §3's
 * addendum): the S-1 DOES have a "SYnC" (MIDI Clock Sync) menu setting --
 * AUtO / Int / MIDI / USB -- and the hardware test above worked because the
 * unit was at (or defaults to) AUtO. If this doesn't drive a real S-1's
 * sequencer, check that menu isn't set to "Int" (internal clock only,
 * ignores everything sent here) before assuming a code bug -- there's no
 * way to query it over MIDI (no SysEx, §1.5).
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
 * special device-side setup, unlike the T-8's SYnC=AUTO requirement. See
 * s1clock's JSDoc above for a real "if it doesn't work, check this menu"
 * caveat found reading the manual body (the S-1's own SYnC setting, not a
 * Strudel-side issue) before assuming a bug here.
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
