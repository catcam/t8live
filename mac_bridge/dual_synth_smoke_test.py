#!/usr/bin/env python3
"""Smoke test: trigger T-8 + S-1 together over MIDI, confirm real audio came
back independently from each device's own audio bridge (audio_bridge.py /
s1_audio_bridge.py, ports 8737/8738). Run locally on the Mac with Xcode's
python3 (needs the mic TCC grant + rtmidi/requests/numpy already used by the
bridges themselves):

    /Applications/Xcode.app/Contents/Developer/usr/bin/python3 \\
        mac_bridge/dual_synth_smoke_test.py

Confirms two things at once (2026-08-02): both devices coexist on Core Audio
and MIDI without collision when physically connected simultaneously, and
each bridge's rolling /capture buffer actually contains audio, not just a
successful MIDI send. Exit code 0 if both audible, 1 otherwise.

Known gotcha: right after a fresh USB connect, /status can report
device_present:false even though sd.query_devices() already lists the
device -- the bridge's detection-loop supervisor needs a kick:
    launchctl kickstart -k gui/$(id -u)/com.catcam.t8helper.audiobridge
    launchctl kickstart -k gui/$(id -u)/com.catcam.s1helper.audiobridge
"""
import time, io, wave, sys
import rtmidi
import requests
import numpy as np

T8_OUT = 'T-8 MIDI IN'
S1_OUT = 'S-1 MIDI IN'
T8_BRIDGE = 'http://127.0.0.1:8737'
S1_BRIDGE = 'http://127.0.0.1:8738'

# channel numbers below are 0-indexed for raw MIDI bytes (status = 0x90 | ch);
# values match T8_RHYTHM_CHANNEL/S1_NOTE_CHANNEL (1-indexed) in t8.mjs/s1.mjs
T8_RHYTHM_CH = 9   # T8_RHYTHM_CHANNEL=10
S1_NOTE_CH = 2     # S1_NOTE_CHANNEL=3

T8_BD, T8_SD = 36, 38  # T8_RHYTHM_NOTES.bd / .sd


def open_port(name):
    mo = rtmidi.MidiOut()
    ports = mo.get_ports()
    idx = ports.index(name)
    mo.open_port(idx)
    return mo


def note_on(mo, ch, note, vel=100):
    mo.send_message([0x90 | ch, note, vel])


def note_off(mo, ch, note):
    mo.send_message([0x80 | ch, note, 0])


def wav_stats(wav_bytes):
    buf = io.BytesIO(wav_bytes)
    with wave.open(buf, 'rb') as wf:
        n = wf.getnframes()
        sr = wf.getframerate()
        ch = wf.getnchannels()
        raw = wf.readframes(n)
    data = np.frombuffer(raw, dtype=np.int16).astype(np.float64) / 32768.0
    if ch > 1:
        data = data.reshape(-1, ch).mean(axis=1)
    peak = float(np.max(np.abs(data))) if len(data) else 0.0
    rms = float(np.sqrt(np.mean(data ** 2))) if len(data) else 0.0
    dom_freq = 0.0
    if len(data) > sr // 4:
        win = data[: sr * 2] if len(data) > sr * 2 else data
        spec = np.abs(np.fft.rfft(win))
        freqs = np.fft.rfftfreq(len(win), 1 / sr)
        spec[freqs < 30] = 0  # ignore DC/rumble
        if spec.max() > 0:
            dom_freq = float(freqs[np.argmax(spec)])
    return {'peak': round(peak, 4), 'rms': round(rms, 5), 'dom_freq_hz': round(dom_freq, 1), 'duration_s': round(n / sr, 2)}


def main():
    t8 = open_port(T8_OUT)
    s1 = open_port(S1_OUT)
    print('MIDI ports open: T-8 + S-1')

    note_on(t8, T8_RHYTHM_CH, T8_BD, 110)
    note_on(t8, T8_RHYTHM_CH, T8_SD, 100)
    note_on(s1, S1_NOTE_CH, 60, 100)   # C4
    note_on(s1, S1_NOTE_CH, 64, 100)   # E4
    note_on(s1, S1_NOTE_CH, 67, 100)   # G4
    print('Notes sent: T-8 bd+sd, S-1 C-E-G chord. Holding 1.5s...')
    time.sleep(1.5)

    note_off(t8, T8_RHYTHM_CH, T8_BD)
    note_off(t8, T8_RHYTHM_CH, T8_SD)
    for n in (60, 64, 67):
        note_off(s1, S1_NOTE_CH, n)

    print('Waiting 1s for audio to settle in ring buffer...')
    time.sleep(1.0)

    results = {}
    for label, base in (('T-8', T8_BRIDGE), ('S-1', S1_BRIDGE)):
        r = requests.get(f'{base}/capture', params={'seconds': 4}, timeout=10)
        r.raise_for_status()
        results[label] = wav_stats(r.content)

    t8.close_port()
    s1.close_port()

    print('\n=== AUDIO CONFIRMATION ===')
    for label, stats in results.items():
        heard = stats['peak'] > 0.01
        print(f"{label}: {'SOUND DETECTED' if heard else 'SILENCE'}  peak={stats['peak']} rms={stats['rms']} dom_freq={stats['dom_freq_hz']}Hz dur={stats['duration_s']}s")

    both_ok = all(s['peak'] > 0.01 for s in results.values())
    print(f"\nBOTH AUDIBLE: {both_ok}")
    sys.exit(0 if both_ok else 1)


if __name__ == '__main__':
    main()
