// ===========================================================================
// Fly Audio Toolkit — DSP layer (Node side, decoupled from the UI)
//
// Everything here shells out to bundled/system binaries:
//   • ffmpeg     → decode to PCM WAV + fast time-stretch (atempo)
//   • aubio      → BPM (tempo), beats, onsets, pitch
//   • rubberband → high-quality time-stretch / pitch-shift
//
// The UI never imports child_process directly — it talks to this module.
// ===========================================================================

import { child_process, fs, os, path } from "./cep/node";
import { getBinary, BinName } from "./binaries";

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/** Thrown when a required binary can't be located. The UI special-cases this. */
export class BinaryMissingError extends Error {
  binary: BinName;
  constructor(binary: BinName) {
    super(
      `Binário "${binary}" não encontrado. Instale-o (Homebrew: brew install ${
        binary === "ffmpeg" || binary === "ffprobe" ? "ffmpeg" : binary
      }) ou inclua um build em bin/.`
    );
    this.name = "BinaryMissingError";
    this.binary = binary;
  }
}

const requireBin = (name: BinName): string => {
  const p = getBinary(name);
  if (!p) throw new BinaryMissingError(name);
  return p;
};

// ---------------------------------------------------------------------------
// Process + temp-file helpers
// ---------------------------------------------------------------------------

type RunResult = { code: number; stdout: string; stderr: string };

const run = (cmd: string, args: string[]): Promise<RunResult> =>
  new Promise((resolve, reject) => {
    let proc: any;
    try {
      proc = child_process.spawn(cmd, args);
    } catch (e: any) {
      reject(new Error("Falha ao iniciar processo: " + (e && e.message ? e.message : e)));
      return;
    }
    let stdout = "";
    let stderr = "";
    if (proc.stdout) proc.stdout.on("data", (d: any) => (stdout += d.toString()));
    if (proc.stderr) proc.stderr.on("data", (d: any) => (stderr += d.toString()));
    proc.on("error", (e: any) => reject(e));
    proc.on("close", (code: number) =>
      resolve({ code: code == null ? -1 : code, stdout, stderr })
    );
  });

let tmpSeq = 0;
const tmpFile = (ext: string): string => {
  tmpSeq++;
  const stamp = `${Date.now()}_${Math.floor(Math.random() * 1e6)}_${tmpSeq}`;
  return path.join(os.tmpdir(), `galeguei_${stamp}${ext}`);
};

const safeUnlink = (file: string): void => {
  try {
    if (file && fs.existsSync(file)) fs.unlinkSync(file);
  } catch (e) {}
};

/** Delete temp files created during analysis. */
export const cleanup = (files: string[]): void => {
  files.forEach(safeUnlink);
};

// ---------------------------------------------------------------------------
// Parsing helpers
// ---------------------------------------------------------------------------

/** Parse a "one timestamp (seconds) per line" aubio output. */
const parseTimes = (stdout: string): number[] => {
  const out: number[] = [];
  stdout.split("\n").forEach((line) => {
    const t = parseFloat(line.trim().split(/\s+/)[0]);
    if (!isNaN(t)) out.push(t);
  });
  return out;
};

const mean = (xs: number[]): number =>
  xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;

const median = (xs: number[]): number => {
  if (!xs.length) return 0;
  const s = xs.slice().sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};

const stddev = (xs: number[]): number => {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(mean(xs.map((x) => (x - m) * (x - m))));
};

const clamp = (x: number, lo: number, hi: number): number =>
  Math.max(lo, Math.min(hi, x));

// ---------------------------------------------------------------------------
// Note conversion
// ---------------------------------------------------------------------------

export const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

export type NoteInfo = { note: string; cents: number; midi: number };

/** Convert a frequency in Hz to the nearest equal-tempered note + cents off. */
export const hzToNote = (hz: number): NoteInfo => {
  if (!hz || hz <= 0) return { note: "—", cents: 0, midi: 0 };
  const midiFloat = 69 + 12 * Math.log(hz / 440) / Math.log(2);
  const midi = Math.round(midiFloat);
  const cents = Math.round((midiFloat - midi) * 100);
  const name = NOTE_NAMES[((midi % 12) + 12) % 12];
  const octave = Math.floor(midi / 12) - 1;
  return { note: name + octave, cents, midi };
};

// ---------------------------------------------------------------------------
// Decode
// ---------------------------------------------------------------------------

/** Decode any input to mono 44.1 kHz 16-bit PCM WAV (temp file). */
export const decodeToWav = async (input: string): Promise<string> => {
  const ffmpeg = requireBin("ffmpeg");
  const out = tmpFile(".wav");
  const res = await run(ffmpeg, [
    "-y",
    "-i",
    input,
    "-ac",
    "1",
    "-ar",
    "44100",
    "-c:a",
    "pcm_s16le",
    out,
  ]);
  if (res.code !== 0 || !fs.existsSync(out)) {
    safeUnlink(out);
    throw new Error("ffmpeg falhou ao decodificar o clipe.\n" + res.stderr.slice(-500));
  }
  return out;
};

// ---------------------------------------------------------------------------
// Analysis
// ---------------------------------------------------------------------------

export type Confidence = "alta" | "media" | "baixa";

export type BpmResult = { bpm: number; confidence: Confidence; beats: number[] };

const detectBeats = async (wav: string): Promise<number[]> => {
  const aubio = requireBin("aubio");
  const res = await run(aubio, ["beat", wav]);
  return parseTimes(res.stdout);
};

/** BPM via `aubio tempo`, with a confidence score from beat regularity. */
export const analyzeBPM = async (wav: string): Promise<BpmResult> => {
  const aubio = requireBin("aubio");
  const res = await run(aubio, ["tempo", wav]);
  const m = res.stdout.match(/([0-9]+(?:\.[0-9]+)?)\s*bpm/i);
  const bpm = m ? Math.round(parseFloat(m[1]) * 100) / 100 : 0;

  // Confidence: how regular are the inter-beat intervals?
  let confidence: Confidence = "baixa";
  let beats: number[] = [];
  try {
    beats = await detectBeats(wav);
    if (beats.length >= 4) {
      const intervals: number[] = [];
      for (let i = 1; i < beats.length; i++) intervals.push(beats[i] - beats[i - 1]);
      const cv = mean(intervals) > 0 ? stddev(intervals) / mean(intervals) : 1;
      confidence = cv < 0.08 ? "alta" : cv < 0.2 ? "media" : "baixa";
    }
  } catch (e) {}

  return { bpm, confidence, beats };
};

export type NoteResult = {
  note: string;
  frequency: number;
  cents: number;
  midi: number;
  confidence: Confidence;
  voicedRatio: number;
};

/** Fundamental note via `aubio pitch` (median of stable voiced frames). */
export const detectNote = async (wav: string): Promise<NoteResult> => {
  const aubio = requireBin("aubio");
  const res = await run(aubio, ["pitch", wav]);

  const freqs: number[] = [];
  let totalFrames = 0;
  res.stdout.split("\n").forEach((line) => {
    const parts = line.trim().split(/\s+/);
    if (parts.length >= 2) {
      totalFrames++;
      const f = parseFloat(parts[1]);
      if (!isNaN(f) && f >= 20 && f <= 5000) freqs.push(f);
    }
  });

  const voicedRatio = totalFrames > 0 ? freqs.length / totalFrames : 0;
  const freq = median(freqs);
  const { note, cents, midi } = hzToNote(freq);

  // Confidence: lots of voiced frames + low spread around the median.
  let confidence: Confidence = "baixa";
  if (freqs.length >= 10) {
    const rel = freq > 0 ? stddev(freqs) / freq : 1;
    if (voicedRatio > 0.6 && rel < 0.05) confidence = "alta";
    else if (voicedRatio > 0.3 && rel < 0.15) confidence = "media";
  }

  return {
    note,
    frequency: Math.round(freq * 100) / 100,
    cents,
    midi,
    confidence,
    voicedRatio: Math.round(voicedRatio * 100) / 100,
  };
};

// ---------------------------------------------------------------------------
// Matching / transposition helpers (pure)
// ---------------------------------------------------------------------------

/**
 * Smallest semitone move (−5..+6) to bring `fromMidi` onto `targetPc`
 * (a pitch class 0=C .. 11=B). Stays within an octave → best harmonization,
 * least pitch-shift artifacting.
 */
export const pitchClassShift = (fromMidi: number, targetPc: number): number => {
  const cur = ((fromMidi % 12) + 12) % 12;
  let d = ((((targetPc % 12) + 12) % 12) - cur + 12) % 12; // 0..11
  if (d > 6) d -= 12;
  return d;
};

/** Smallest semitone move to put `fromMidi` on `toMidi`'s pitch class. */
export const noteMatchShift = (fromMidi: number, toMidi: number): number =>
  pitchClassShift(fromMidi, ((toMidi % 12) + 12) % 12);

/** Speed factor that retempos `fromBpm` to `toBpm` (1 = no change). */
export const tempoMatchSpeed = (fromBpm: number, toBpm: number): number =>
  fromBpm > 0 && toBpm > 0 ? Math.round((toBpm / fromBpm) * 10000) / 10000 : 1;

/** Onset timestamps (seconds) via `aubio onset`. */
export const detectOnsets = async (wav: string): Promise<number[]> => {
  const aubio = requireBin("aubio");
  const res = await run(aubio, ["onset", wav]);
  return parseTimes(res.stdout);
};

export type AnalysisResult = {
  bpm: BpmResult;
  note: NoteResult;
  durationSec: number;
};

const probeDuration = async (wav: string): Promise<number> => {
  const ffprobe = getBinary("ffprobe");
  if (!ffprobe) return 0;
  try {
    const res = await run(ffprobe, [
      "-v",
      "error",
      "-show_entries",
      "format=duration",
      "-of",
      "csv=p=0",
      wav,
    ]);
    const d = parseFloat(res.stdout.trim());
    return isNaN(d) ? 0 : d;
  } catch (e) {
    return 0;
  }
};

/**
 * High-level: decode once, then run BPM + note analysis, then clean up.
 * Returns beats (for marker placement) inside `bpm.beats`.
 */
export const analyzeClip = async (input: string): Promise<AnalysisResult> => {
  const wav = await decodeToWav(input);
  try {
    const bpm = await analyzeBPM(wav);
    const note = await detectNote(wav);
    const durationSec = await probeDuration(wav);
    return { bpm, note, durationSec };
  } finally {
    safeUnlink(wav);
  }
};

// ---------------------------------------------------------------------------
// Time-stretch / pitch-shift
// ---------------------------------------------------------------------------

export type StretchQuality = "fast" | "hq";

export type StretchOptions = {
  /** Playback speed multiplier. 1 = unchanged, 2 = twice as fast/short. */
  speed: number;
  /** "fast" = ffmpeg atempo, "hq" = Rubber Band R3. */
  quality: StretchQuality;
  /** Whether to also shift pitch (only honored in "hq" mode). */
  pitchIndependent: boolean;
  /** Semitones to shift when pitchIndependent is true. */
  pitchSemitones: number;
};

/** Chain atempo filters so we can exceed the per-instance 0.5–2.0 range. */
const buildAtempoChain = (speed: number): string => {
  const parts: string[] = [];
  let remaining = speed;
  while (remaining > 2.0) {
    parts.push("atempo=2.0");
    remaining /= 2.0;
  }
  while (remaining < 0.5) {
    parts.push("atempo=0.5");
    remaining /= 0.5;
  }
  parts.push("atempo=" + Math.round(remaining * 10000) / 10000);
  return parts.join(",");
};

const buildOutputPath = (input: string, opts: StretchOptions): string => {
  const dir = path.dirname(input);
  const ext = path.extname(input);
  const base = path.basename(input, ext);
  let tag = "_galeguei_" + opts.speed + "x";
  if (opts.quality === "hq" && opts.pitchIndependent && opts.pitchSemitones !== 0) {
    const s = opts.pitchSemitones > 0 ? "+" + opts.pitchSemitones : "" + opts.pitchSemitones;
    tag += "_p" + s;
  }
  // Always write WAV so the result is lossless and re-importable.
  return path.join(dir, base + tag + ".wav");
};

export type StretchResult = { output: string; quality: StretchQuality };

/**
 * Time-stretch (and optionally pitch-shift) a file.
 * Output is written next to the source as a WAV and returned.
 */
export const timeStretch = async (
  input: string,
  opts: StretchOptions
): Promise<StretchResult> => {
  const speed = clamp(opts.speed, 0.1, 8);
  let output = buildOutputPath(input, { ...opts, speed });

  // Guard against writing where we lack permission — fall back to tmp.
  let writable = true;
  try {
    fs.accessSync(path.dirname(output), fs.constants.W_OK);
  } catch (e) {
    writable = false;
  }
  if (!writable) output = tmpFile(path.basename(output).replace(/^.*?(_galeguei)/, "$1"));

  if (opts.quality === "hq") {
    const rb = requireBin("rubberband");
    const args = ["-3", "--tempo", String(speed)];
    if (opts.pitchIndependent && opts.pitchSemitones !== 0) {
      args.push("-p", String(opts.pitchSemitones));
    }
    args.push(input, output);
    const res = await run(rb, args);
    if (res.code !== 0 || !fs.existsSync(output)) {
      safeUnlink(output);
      throw new Error("Rubber Band falhou no processamento.\n" + res.stderr.slice(-500));
    }
  } else {
    const ffmpeg = requireBin("ffmpeg");
    const res = await run(ffmpeg, [
      "-y",
      "-i",
      input,
      "-filter:a",
      buildAtempoChain(speed),
      output,
    ]);
    if (res.code !== 0 || !fs.existsSync(output)) {
      safeUnlink(output);
      throw new Error("ffmpeg (atempo) falhou no processamento.\n" + res.stderr.slice(-500));
    }
  }

  return { output, quality: opts.quality };
};
