"""Combined audio passthrough + HTTP status API for the Roland AIRA Compact
S-1, adapted from roland-t8's `src/mac_bridge/audio_bridge.py` (the T-8
bridge). Same core approach: a single sounddevice full-duplex
sd.Stream(device=(input_idx, output_idx)), NOT AVAudioEngine -- the T-8
project already proved AVAudioEngine shares one HAL I/O unit for input+
output on macOS, silently misrouting output to whichever device input was
pinned to (see roland-t8's docs/T8_MANUAL.md sec 10 and commit 6f30c76).
That finding is device-agnostic (it's a CoreAudio/AVAudioEngine property,
not a T-8 quirk), so it applies here unchanged -- no reason to re-litigate
AVAudioEngine for the S-1.

TCC / LaunchAgent note (resolved 2026-07-31, see roland-t8 git history for
the full evidence trail): the T-8 bridge's own header comment carries a
now-stale warning that it "MUST be run locally, interactively, in
Terminal.app -- NOT via SSH." That was written before roland-t8 commit
e4d09e5 ("Step 8 complete") empirically disproved it: a LaunchAgent with no
Terminal.app ancestor gets full microphone access too, and testing
TCC.db directly confirms why -- the responsible-process identity macOS
attributes to `/Applications/Xcode.app/Contents/Developer/usr/bin/python3`
resolves to python3's *enclosing signed app bundle* (`com.apple.dt.Xcode`),
which already carries a durable Microphone grant (TCC.db:
kTCCServiceMicrophone|com.apple.dt.Xcode|...|2|2). That resolution is keyed
to the executable's own bundle, not to whoever launches it (Terminal, SSH,
or launchd) and not to the launchd Label/bundle-style identifier assigned
to the job. This script also shells out to that same Xcode python3 binary,
so it inherits the identical standing grant -- no fresh "Allow Microphone"
prompt is expected, even though this is a brand-new LaunchAgent with a
different Label (com.catcam.s1helper.audiobridge, not
com.catcam.t8helper.audiobridge). If a prompt *does* appear anyway, it will
say "python3.9 wants to use the microphone" -- click Allow once.

Roland S-1 hardware notes (do NOT duplicate here -- handled outside this
script, already done as of 2026-07-31): the S-1 needs its own `USb.d` (USB
Direct Out) menu setting at a nonzero value for USB audio to route at all.
That is a one-time device-menu setting, not something this script can or
should set programmatically over the USB Audio Class 2.0 interface.

HTTP API on 127.0.0.1:8738 (one port below the T-8 bridge's 8737, so both
can run simultaneously without colliding):
    GET  /health                 -> {"status": "ok", "uptime": <seconds>}
    GET  /status                 -> latest reading, incl. device_present/passthrough
    GET  /levels?seconds=<N>     -> list of readings over the last N seconds
    GET  /capture?seconds=<N>    -> WAV audio (16-bit PCM) of the last N seconds
                                     from a rolling raw-sample buffer (real ears,
                                     not just a VU meter -- can be scp'd back and
                                     actually listened to or analyzed)
    POST /passthrough {"on": true|false} -> toggle audible routing (metering
                                             always continues regardless)
    POST /notify {"message": str, "title": str} -> macOS user notification
                                             (osascript display notification)
    POST /exit                   -> unloads the LaunchAgent (`launchctl
                                     bootout`) so the bridge actually stays
                                     down -- a bare process exit would just
                                     get relaunched by KeepAlive

Device-churn handling: this process does NOT crash or need a relaunch when
the S-1 disappears (unplugged, powered off, USB drops) -- a supervisor loop
watches for the device vanishing/reappearing, tears the stream down and
rebuilds it automatically, and /status.device_present reflects ground truth
at all times. The stale-callback and boot-race self-restart logic below was
proven on the T-8's identical USB Audio Class 2.0 CoreAudio path; it is
carried over unchanged as sound defensive engineering, not yet
independently hardware-confirmed on the S-1 specifically.
"""
import sounddevice as sd
import numpy as np
import json
import os
import subprocess
import time
import sys
import threading
import wave
import io
from collections import deque
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs

STATUS_FILE = "/tmp/s1_status.json"
STATUS_FILE_WRITE_INTERVAL = 0.1  # off the audio thread -- see _status_file_writer_loop
ALLOWED_ORIGINS = {
    "https://t8live.fyi",
    "http://localhost:4321",
    "http://127.0.0.1:4321",
}
SAMPLERATE = 44100
SILENCE_THRESHOLD = 0.01
WRITE_INTERVAL = 0.1     # resolution of the in-memory ring buffer
RING_BUFFER_SECONDS = 30
RAW_BUFFER_SECONDS = 15  # how much raw audio /capture can look back over
                          # (~15s of 44.1kHz stereo float32 is ~10MB, trivial)
HTTP_PORT = 8738
LAUNCHD_LABEL = "com.catcam.s1helper.audiobridge"
DEVICE_POLL_INTERVAL = 1.0  # how often the supervisor checks device presence
DEVICE_ACTIVATION_GRACE_SECONDS = 2.0  # wait this long after a device first
                                        # appears before opening a stream --
                                        # CoreAudio needs a moment to finish
                                        # activating a freshly re-plugged
                                        # device internally (T-8 finding,
                                        # carried over as a general CoreAudio
                                        # property, not S-1-specific)
CALLBACK_STALE_SECONDS = 3.0  # if no callback fires for this long, force a rebuild
                               # (PortAudio doesn't always cleanly flag a stream as
                               # closed/stopped when a USB device vanishes mid-stream --
                               # confirmed on the T-8's hardware; carried over defensively)
BOOT_DETECT_TIMEOUT_SECONDS = 45.0  # see _BOOT_RETRY_ENV below
_BOOT_RETRY_ENV = "S1_BRIDGE_BOOT_RETRY_DONE"

_last_callback_time = [time.time()]

_start_time = time.time()
_ring_lock = threading.Lock()
_ring = deque()  # each item: {"ts", "peak", "rms", "playing"}

_raw_lock = threading.Lock()
_raw_buffer = deque()  # each item: (ts_of_chunk_end, ndarray[frames, channels] float32)

_state_lock = threading.Lock()
_state = {
    "device_present": False,
    "passthrough": True,
}


def find_device(name_substr, want_input=None):
    """Returns device index, or None if not currently present (does not raise)."""
    for i, d in enumerate(sd.query_devices()):
        if name_substr.lower() in d['name'].lower():
            if want_input is True and d['max_input_channels'] == 0:
                continue
            if want_input is False and d['max_output_channels'] == 0:
                continue
            return i
    return None


def _record_reading(peak, rms):
    """Called from the real-time audio callback -- must stay allocation-light
    and I/O-free. Only touches the in-memory ring buffer; STATUS_FILE is
    written separately by _status_file_writer_loop() on its own thread, not
    here (a synchronous disk write from the callback risked missing the
    ~5.8ms per-block deadline under any disk contention)."""
    now = time.time()
    with _state_lock:
        device_present = _state["device_present"]
        passthrough = _state["passthrough"]
    reading = {
        "ts": now,
        "peak": round(peak, 6),
        "rms": round(rms, 6),
        "playing": peak > SILENCE_THRESHOLD,
        "device_present": device_present,
        "passthrough": passthrough,
    }
    with _ring_lock:
        _ring.append(reading)
        cutoff = now - RING_BUFFER_SECONDS
        while _ring and _ring[0]["ts"] < cutoff:
            _ring.popleft()
    return reading


def _status_file_writer_loop():
    """Mirrors latest_status() to STATUS_FILE on its own low-rate thread,
    off the real-time audio callback."""
    while True:
        with open(STATUS_FILE, "w") as f:
            json.dump(latest_status(), f)
        time.sleep(STATUS_FILE_WRITE_INTERVAL)


def latest_status():
    """device_present/passthrough always reflect CURRENT supervisor state --
    never frozen. peak/rms/playing come from the last ring-buffer reading if
    one exists (naturally goes stale/zero when there's no live callback,
    which is correct: no device means no new audio to report), else zeroed."""
    with _ring_lock:
        last_reading = dict(_ring[-1]) if _ring else None
    with _state_lock:
        device_present = _state["device_present"]
        passthrough = _state["passthrough"]

    if last_reading is None:
        return {
            "ts": time.time(), "peak": 0.0, "rms": 0.0, "playing": False,
            "device_present": device_present, "passthrough": passthrough,
        }
    last_reading["device_present"] = device_present
    last_reading["passthrough"] = passthrough
    if not device_present:
        last_reading["peak"] = 0.0
        last_reading["rms"] = 0.0
        last_reading["playing"] = False
    return last_reading


def levels_since(seconds):
    cutoff = time.time() - seconds
    with _ring_lock:
        return [dict(r) for r in _ring if r["ts"] >= cutoff]


def _append_raw(indata):
    now = time.time()
    with _raw_lock:
        _raw_buffer.append((now, indata.copy()))
        cutoff = now - RAW_BUFFER_SECONDS
        while _raw_buffer and _raw_buffer[0][0] < cutoff:
            _raw_buffer.popleft()


def capture_wav_bytes(seconds):
    """Concatenate the last `seconds` of raw audio from the ring buffer and
    return it encoded as 16-bit PCM WAV bytes."""
    cutoff = time.time() - seconds
    with _raw_lock:
        chunks = [chunk for ts, chunk in _raw_buffer if ts >= cutoff]
    if not chunks:
        chunks = [np.zeros((1, 2), dtype='float32')]
    audio = np.concatenate(chunks, axis=0)
    # float32 [-1, 1] -> int16 PCM
    clipped = np.clip(audio, -1.0, 1.0)
    pcm16 = (clipped * 32767).astype(np.int16)

    buf = io.BytesIO()
    with wave.open(buf, "wb") as wf:
        wf.setnchannels(pcm16.shape[1])
        wf.setsampwidth(2)  # 16-bit
        wf.setframerate(SAMPLERATE)
        wf.writeframes(pcm16.tobytes())
    return buf.getvalue()


def set_passthrough(on: bool):
    with _state_lock:
        _state["passthrough"] = bool(on)


def set_device_present(present: bool):
    with _state_lock:
        _state["device_present"] = bool(present)


def get_passthrough() -> bool:
    with _state_lock:
        return _state["passthrough"]


def _applescript_quote(s: str) -> str:
    """Escape a string for embedding in a double-quoted AppleScript literal."""
    return s.replace("\\", "\\\\").replace('"', '\\"')


def send_mac_notification(title: str, message: str) -> bool:
    """Best-effort macOS user notification via osascript. Never raises --
    a failed notification shouldn't break the caller's flow, just log it."""
    script = (
        f'display notification "{_applescript_quote(message)}" '
        f'with title "{_applescript_quote(title)}" sound name "Glass"'
    )
    try:
        subprocess.run(["osascript", "-e", script], timeout=5, check=False,
                        capture_output=True)
        return True
    except Exception as e:
        print(f"notify failed: {e}", file=sys.stderr)
        return False


class Handler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        pass  # silence default request logging to stderr

    def _cors(self):
        # Only reflect back an Access-Control-Allow-Origin for the specific
        # origins that legitimately need this (the t8live REPL, dev and
        # prod) -- a bare "*" would let ANY page open in the same browser
        # read /capture (raw audio) or fire /notify, since this API has
        # no other auth and localhost/127.0.0.1 offers no origin isolation.
        origin = self.headers.get("Origin")
        if origin in ALLOWED_ORIGINS:
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")

    def do_OPTIONS(self):
        # Preflight response: needed both for standard CORS preflights and
        # for Chrome's Private Network Access check (a public HTTPS page
        # fetching a loopback address sends this before the real request).
        self.send_response(204)
        self._cors()
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Allow-Private-Network", "true")
        self.send_header("Content-Length", "0")
        self.end_headers()

    def _send_json(self, obj, code=200):
        body = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self._cors()
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        parsed = urlparse(self.path)
        qs = parse_qs(parsed.query)

        if parsed.path == "/health":
            self._send_json({"status": "ok", "uptime": round(time.time() - _start_time, 1)})
        elif parsed.path == "/status":
            self._send_json(latest_status())
        elif parsed.path == "/levels":
            seconds = float(qs.get("seconds", ["10"])[0])
            self._send_json(levels_since(seconds))
        elif parsed.path == "/capture":
            seconds = min(float(qs.get("seconds", ["3"])[0]), RAW_BUFFER_SECONDS)
            wav_bytes = capture_wav_bytes(seconds)
            self.send_response(200)
            self.send_header("Content-Type", "audio/wav")
            self.send_header("Content-Length", str(len(wav_bytes)))
            self._cors()
            self.end_headers()
            self.wfile.write(wav_bytes)
        else:
            self._send_json({"error": "not found", "path": parsed.path}, code=404)

    def do_POST(self):
        parsed = urlparse(self.path)
        if parsed.path == "/passthrough":
            length = int(self.headers.get("Content-Length", 0))
            body = self.rfile.read(length) if length else b"{}"
            try:
                payload = json.loads(body)
            except json.JSONDecodeError:
                payload = {}
            on = bool(payload.get("on", True))
            set_passthrough(on)
            self._send_json({"passthrough": on})
        elif parsed.path == "/notify":
            length = int(self.headers.get("Content-Length", 0))
            body = self.rfile.read(length) if length else b"{}"
            try:
                payload = json.loads(body)
            except json.JSONDecodeError:
                payload = {}
            message = str(payload.get("message", ""))
            title = str(payload.get("title", "S-1"))
            sent = send_mac_notification(title, message)
            self._send_json({"sent": sent})
        elif parsed.path == "/exit":
            self._send_json({"exiting": True})
            threading.Thread(target=_exit_via_launchctl, daemon=True).start()
        else:
            self._send_json({"error": "not found", "path": parsed.path}, code=404)


def _exit_via_launchctl():
    """Runs off the request-handling thread so /exit's HTTP response reaches
    the client before the process goes down. A bare process exit isn't
    enough -- KeepAlive=true in the LaunchAgent plist means launchd would
    just relaunch it immediately, so this unloads the service itself via
    `launchctl bootout`, same as stopping it manually."""
    time.sleep(0.3)
    subprocess.run(
        ["launchctl", "bootout", f"gui/{os.getuid()}/{LAUNCHD_LABEL}"],
        capture_output=True,
    )


def run_http_server():
    server = ThreadingHTTPServer(("127.0.0.1", HTTP_PORT), Handler)
    print(f"HTTP API on http://127.0.0.1:{HTTP_PORT}  (/health /status /levels /passthrough)",
          file=sys.stderr)
    server.serve_forever()


def make_callback():
    last_write = [0.0]

    def callback(indata, outdata, frames, time_info, status):
        _last_callback_time[0] = time.time()
        if status:
            print(status, file=sys.stderr)
        if get_passthrough():
            outdata[:] = indata
        else:
            outdata[:] = 0
        _append_raw(indata)
        now = time.time()
        if now - last_write[0] >= WRITE_INTERVAL:
            last_write[0] = now
            peak = float(np.max(np.abs(indata)))
            rms = float(np.sqrt(np.mean(indata.astype(np.float64) ** 2)))
            _record_reading(peak, rms)

    return callback


def _open_stream(in_idx, out_idx):
    stream = sd.Stream(device=(in_idx, out_idx), samplerate=SAMPLERATE,
                        channels=2, blocksize=256, callback=make_callback())
    stream.start()
    _last_callback_time[0] = time.time()
    return stream


def _self_restart():
    """PortAudio terminate+initialize alone wasn't enough to recover from
    some post-unplug/replug states on the T-8's identical CoreAudio path
    (confirmed there: repeated -10863/-9986 errors persisted even after
    reinit, and stream.stop()/close() themselves can hang indefinitely on a
    wedged AUHAL device). Full process restart via os.execv replaces the
    running process image in place -- same PID, same parent, so the TCC
    grant (tied to the python3 executable's own bundle, see module
    docstring) is unaffected. execve() terminates every thread in the
    process immediately, including a hung one, so this is called WITHOUT
    waiting for stream teardown to finish -- there is nothing left to clean
    up once the process image is replaced.

    sys.argv does NOT include interpreter flags like -u, so a naive
    execv(sys.executable, [sys.executable] + sys.argv) would silently drop
    unbuffered mode on every restart (confirmed on the T-8 bridge). Re-adding
    -u explicitly here keeps every generation unbuffered."""
    print(f"self-restarting process (PID stays the same, TCC grant preserved)", file=sys.stderr)
    os.execv(sys.executable, [sys.executable, "-u"] + sys.argv)


def _close_stream_best_effort(stream):
    """Fire-and-forget: try to close cleanly, but don't let a hang here
    block anything -- runs in a daemon thread that the caller doesn't wait
    on. If it never completes, that's fine (see _self_restart)."""
    def _do_close():
        try:
            stream.stop()
            stream.close()
        except Exception as e:
            print(f"Error closing stream (non-blocking): {e}", file=sys.stderr)
    threading.Thread(target=_do_close, daemon=True).start()


def supervisor_loop(input_name="S-1", output_name="Speakers"):
    """Owns the stream lifecycle: opens it when the S-1 appears, tears it
    down when it disappears (unplug, power off), and self-restarts the
    whole process on any failure rather than trying to recover in-process.
    input_name="S-1" reads the S-1's own audio output as it arrives at the
    Mac (a class-compliant USB Audio Class 2.0 device, 2 in/2 out);
    output_name="Speakers" routes passthrough to the Mac's built-in output
    so it's audible, same pattern as the T-8 bridge.

    This restart-on-any-failure strategy, and the boot-race workaround
    below, were both proven necessary on the T-8's identical CoreAudio/
    PortAudio path (see roland-t8's audio_bridge.py supervisor_loop
    docstring for the full hardware evidence) and are carried over here
    unchanged as defensive engineering -- not yet independently
    hardware-confirmed to recur on the S-1, but there's no reason to expect
    the underlying CoreAudio/PortAudio behavior to differ by device."""
    stream = None
    was_present = False
    ever_present = False
    boot_retry_done = os.environ.get(_BOOT_RETRY_ENV) == "1"
    while True:
        in_idx = find_device(input_name, want_input=True)
        out_idx = find_device(output_name, want_input=False)
        present = in_idx is not None and out_idx is not None
        if present:
            ever_present = True

        if (not boot_retry_done and not ever_present and stream is None
                and (time.time() - _start_time) > BOOT_DETECT_TIMEOUT_SECONDS):
            print(f"Device never detected {BOOT_DETECT_TIMEOUT_SECONDS}s after process start "
                  "-- likely a boot-time PortAudio/coreaudiod race, self-restarting once",
                  file=sys.stderr)
            os.environ[_BOOT_RETRY_ENV] = "1"
            _self_restart()

        if present and stream is None:
            if not was_present:
                # Device shows up in enumeration before CoreAudio finishes
                # its own internal activation handshake for it -- give it
                # a moment before the first open attempt.
                print(f"Device just appeared -- waiting {DEVICE_ACTIVATION_GRACE_SECONDS}s for "
                      f"CoreAudio activation to settle", file=sys.stderr)
                time.sleep(DEVICE_ACTIVATION_GRACE_SECONDS)
            try:
                stream = _open_stream(in_idx, out_idx)
                set_device_present(True)
                print(f"Stream (re)opened: input={in_idx} output={out_idx}", file=sys.stderr)
            except Exception as e:
                print(f"Failed to open stream: {e}", file=sys.stderr)
                set_device_present(False)
                _self_restart()

        elif not present and stream is not None:
            print("Device no longer present -- tearing down stream", file=sys.stderr)
            _close_stream_best_effort(stream)
            stream = None
            set_device_present(False)

        elif stream is not None:
            stale = (time.time() - _last_callback_time[0]) > CALLBACK_STALE_SECONDS
            if stale:
                print("Callback stale (device likely vanished mid-stream) -- self-restarting",
                      file=sys.stderr)
                set_device_present(False)
                _close_stream_best_effort(stream)
                _self_restart()
            # Check the stream hasn't silently errored out from under us.
            elif stream.closed or (hasattr(stream, "stopped") and stream.stopped):
                print("Stream unexpectedly closed/stopped -- will reopen", file=sys.stderr)
                stream = None
                set_device_present(False)
            else:
                set_device_present(True)

        else:
            set_device_present(False)

        was_present = present
        time.sleep(DEVICE_POLL_INTERVAL)


def main():
    http_thread = threading.Thread(target=run_http_server, daemon=True)
    http_thread.start()
    status_writer_thread = threading.Thread(target=_status_file_writer_loop, daemon=True)
    status_writer_thread.start()
    print("Running. Ctrl-C to stop. Device supervisor active (survives unplug).",
          file=sys.stderr)
    supervisor_loop()


if __name__ == "__main__":
    main()
