"""Builds the launch video's audio: voiceover (macOS `say`), a generated music bed, and the timeline.

    python3 scripts/video/launch/audio.py [voice]

Writes runs/launch/{vo.wav,music.wav} and web/video/timeline.json (scene timing for the stage page).
Each line's spoken length sets when the next scene starts, so a different voice re-times the video.
"""
import hashlib, json, os, subprocess, sys, urllib.request, wave
import numpy as np

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "../../.."))
OUT = os.path.join(ROOT, "runs/launch")
SR = 48000
LEAD = 1.2  # silence before the first line

def read_wav(path):
    with wave.open(path) as w:
        a = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16).astype(np.float32) / 32768
    return a

def env_key(name):
    """From the environment, else from the repo's .env (gitignored). Never printed."""
    if os.environ.get(name):
        return os.environ[name]
    try:
        for line in open(os.path.join(ROOT, ".env")):
            if line.startswith(name + "="):
                return line.split("=", 1)[1].strip()
    except FileNotFoundError:
        pass
    return None

def elevenlabs(cfg, i, out_mp3):
    """One line through ElevenLabs, with its neighbours as context so the read flows. Cached by content."""
    el = cfg["elevenlabs"]
    lines = cfg["lines"]
    body = {
        "text": lines[i]["text"], "model_id": el["model"], "voice_settings": el["settings"],
        "previous_text": " ".join(l["text"] for l in lines[max(0, i - 2):i]),
        "next_text": " ".join(l["text"] for l in lines[i + 1:i + 3]),
    }
    digest = hashlib.sha256(json.dumps([el["voice_id"], body], sort_keys=True).encode()).hexdigest()[:16]
    cached = os.path.join(OUT, "el", f"{digest}.mp3")
    if not os.path.exists(cached):
        key = env_key("ELEVENLABS_API_KEY")
        req = urllib.request.Request(
            f"https://api.elevenlabs.io/v1/text-to-speech/{el['voice_id']}?output_format=mp3_44100_128",
            data=json.dumps(body).encode(), headers={"xi-api-key": key, "Content-Type": "application/json"})
        os.makedirs(os.path.dirname(cached), exist_ok=True)
        with urllib.request.urlopen(req, timeout=60) as r, open(cached, "wb") as f:
            f.write(r.read())
    subprocess.run(["cp", cached, out_mp3], check=True)

def voiceover(cfg, voice):
    os.makedirs(os.path.join(OUT, "lines"), exist_ok=True)
    use_el = voice == "elevenlabs"
    t, parts, timeline = LEAD, [], []
    for i, line in enumerate(cfg["lines"]):
        aiff = os.path.join(OUT, "lines", f"{i:02d}.{'mp3' if use_el else 'aiff'}")
        wav = os.path.join(OUT, "lines", f"{i:02d}.wav")
        if use_el:
            elevenlabs(cfg, i, aiff)
        else:
            subprocess.run(["say", "-v", voice, "-r", str(cfg["rate"]), "-o", aiff, line["text"]], check=True)
        subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", aiff, "-ac", "1", "-ar", str(SR),
                        "-af", "silenceremove=start_periods=1:start_threshold=-50dB,areverse,silenceremove=start_periods=1:start_threshold=-50dB,areverse",
                        "-sample_fmt", "s16", wav], check=True)
        a = read_wav(wav)
        dur = len(a) / SR
        timeline.append({"id": line["id"], "text": line["text"], "start": round(t, 3), "dur": round(dur, 3)})
        parts.append((t, a))
        t += dur + line.get("gap", 0.5)
    total = t
    vo = np.zeros(int(total * SR) + SR, dtype=np.float32)
    for start, a in parts:
        i = int(start * SR)
        vo[i:i + len(a)] += a
    return vo[: int(total * SR)], timeline, total

# ---------------------------------------------------------------- music: warm pad, pulse after the reveal

def note(midi):
    return 440.0 * 2 ** ((midi - 69) / 12)

def pad_voice(freq, n, sr):
    t = np.arange(n) / sr
    out = np.zeros(n, dtype=np.float32)
    for detune in (-0.12, 0.0, 0.11):  # chorus
        f = freq * 2 ** (detune / 12)
        out += np.sin(2 * np.pi * f * t) + 0.32 * np.sin(2 * np.pi * 2 * f * t) + 0.12 * np.sin(2 * np.pi * 3 * f * t)
    return out / 3

def envelope(n, sr, attack, release):
    e = np.ones(n, dtype=np.float32)
    a, r = int(attack * sr), int(release * sr)
    e[:a] = np.linspace(0, 1, a) ** 2
    e[-r:] *= np.linspace(1, 0, r) ** 1.5
    return e

def music(total, timeline):
    n = int(total * SR)
    out = np.zeros(n, dtype=np.float32)
    reveal = next(x["start"] for x in timeline if x["id"] == "reveal")
    until = next(x["start"] for x in timeline if x["id"] == "until")
    # Before the reveal: sparse, minor colour. After: brighter progression with a pulse.
    pre = [[57, 60, 64, 67], [53, 57, 60, 64], [55, 59, 62, 65], [52, 55, 59, 62]]   # Am7 Fmaj7 G7sus Em7
    post = [[53, 57, 60, 64], [55, 59, 62, 67], [57, 60, 64, 67], [60, 64, 67, 71]]  # Fmaj7 G Am7 Cmaj7
    bar = 4.0
    t = 0.0
    k = 0
    while t < total:
        chords = pre if t < reveal - 0.01 else post
        length = min(bar, (reveal - t) if t < reveal else bar)
        if length < 0.5:
            t += length; continue
        ln = int(length * SR); i = int(t * SR)
        chord = chords[k % len(chords)]
        seg = sum(pad_voice(note(m), ln, SR) for m in chord) / len(chord)
        seg += 0.5 * pad_voice(note(chord[0] - 12), ln, SR)  # bass
        seg *= envelope(ln, SR, min(1.2, length / 3), min(1.6, length / 2.5))
        end = min(n, i + ln)
        out[i:end] += seg[: end - i] * (0.55 if t < reveal else 0.75)
        t += length; k += 1
    # Pulse (soft kick + shaker) from the reveal on.
    beat = 60 / 96
    b = reveal
    while b < total - 2.5:
        i = int(b * SR); m = int(0.25 * SR)
        tt = np.arange(m) / SR
        kick = np.sin(2 * np.pi * (48 + 70 * np.exp(-tt * 30)) * tt) * np.exp(-tt * 14)
        out[i:i + m] += 0.55 * kick[: max(0, min(m, n - i))]
        j = int((b + beat / 2) * SR); h = int(0.06 * SR)
        if j + h < n:
            out[j:j + h] += 0.05 * np.random.default_rng(int(b * 100)).standard_normal(h) * np.exp(-np.arange(h) / SR * 60)
        b += beat
    # Riser into the reveal, and a hit on it.
    rs, re_ = int(until * SR), int(reveal * SR)
    if re_ > rs:
        tt = np.arange(re_ - rs) / SR
        sweep = np.random.default_rng(7).standard_normal(re_ - rs) * 0.18
        sweep = np.convolve(sweep, np.ones(24) / 24, mode="same") * (tt / tt[-1]) ** 2.2
        out[rs:re_] += sweep
    m = int(2.5 * SR); i = re_
    tt = np.arange(m) / SR
    hit = (np.sin(2 * np.pi * 55 * tt) * 0.9 + np.sin(2 * np.pi * 110 * tt) * 0.4) * np.exp(-tt * 2.2)
    out[i:i + m] += 0.7 * hit[: max(0, min(m, n - i))]
    # Simple room: a few feedback taps.
    for d, g in ((0.113, 0.28), (0.197, 0.2), (0.291, 0.14)):
        s = int(d * SR)
        out[s:] += g * out[:-s]
    # Fade in/out, normalise.
    out *= envelope(n, SR, 1.5, 3.0)
    out /= np.max(np.abs(out)) + 1e-9
    return out * 0.9

def write_wav(path, a):
    a = np.clip(a, -1, 1)
    with wave.open(path, "w") as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR)
        w.writeframes((a * 32767).astype(np.int16).tobytes())

def place(offsets_path):
    """Rebuild vo.wav and music.wav with each line at the time its scene actually started in the recording."""
    off = json.load(open(offsets_path))
    tl = json.load(open(os.path.join(ROOT, "web/video/timeline.json")))
    lines = tl["lines"]
    starts = {o["id"]: o["t"] + 0.25 for o in off["scenes"]}  # scenes fire 0.25 s before their line
    total = off["total"]
    vo = np.zeros(int(total * SR) + SR, dtype=np.float32)
    placed = []
    for i, line in enumerate(lines):
        a = read_wav(os.path.join(OUT, "lines", f"{i:02d}.wav"))
        t = starts.get(line["id"], line["start"])
        j = int(t * SR); vo[j:j + len(a)] += a[: max(0, len(vo) - j)]
        placed.append({**line, "start": t})
    vo = vo[: int(total * SR)]
    write_wav(os.path.join(OUT, "vo.wav"), vo)
    write_wav(os.path.join(OUT, "music.wav"), music(total, placed))
    print(f"placed {len(placed)} lines over {total:.1f}s")

if __name__ == "__main__" and len(sys.argv) > 2 and sys.argv[1] == "place":
    place(sys.argv[2]); sys.exit(0)

if __name__ == "__main__":
    cfg = json.load(open(os.path.join(os.path.dirname(__file__), "script.json")))
    voice = sys.argv[1] if len(sys.argv) > 1 else cfg["voice"]
    os.makedirs(OUT, exist_ok=True)
    vo, timeline, total = voiceover(cfg, voice)
    write_wav(os.path.join(OUT, "vo.wav"), vo)
    write_wav(os.path.join(OUT, "music.wav"), music(total, timeline))
    json.dump({"total": round(total, 3), "lines": timeline}, open(os.path.join(ROOT, "web/video/timeline.json"), "w"), indent=1)
    print(f"voice {voice}: {len(timeline)} lines, {total:.1f}s")
    for x in timeline:
        print(f"  {x['start']:6.2f}  {x['dur']:5.2f}  {x['id']}")
