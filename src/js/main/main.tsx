import { useEffect, useRef, useState } from "react";
import { evalTS, subscribeBackgroundColor } from "../lib/utils/bolt";
import { Docs, type DocLang } from "./Docs";
import {
  analyzeClip,
  timeStretch,
  BinaryMissingError,
  NOTE_NAMES,
  pitchClassShift,
  noteMatchShift,
  tempoMatchSpeed,
  type AnalysisResult,
  type AudioRegion,
} from "../lib/audio";
import { checkBinaries, clearBinaryCache, type BinStatus } from "../lib/binaries";
import {
  Activity,
  AudioLines,
  Music2,
  Wand2,
  ArrowUpDown,
  Flag,
  Target,
  GitCompareArrows,
  ArrowRight,
  RefreshCw,
  RotateCcw,
  TriangleAlert,
  CircleAlert,
  CircleCheck,
  Loader2,
  Info,
} from "lucide-react";
import "./main.scss";

// --- bridge return shapes (mirror src/jsx/ppro/ppro.ts) ---
type SelectedClipInfo = {
  found: boolean;
  source: "timeline" | "project" | "none";
  name: string;
  path: string;
  startSeconds: number;
  inSeconds: number;
  outSeconds: number;
  durationSeconds: number;
  trackIndex: number;
  nodeId: string;
  mediaType: string;
  error: string;
};

type Clip = { info: SelectedClipInfo; analysis: AnalysisResult };

const inCEP = typeof window !== "undefined" && !!(window as any).cep;

const confidenceLabel: Record<string, string> = {
  alta: "high",
  media: "mid",
  baixa: "low",
};

const fmtSt = (n: number) => (n > 0 ? `+${n}` : `${n}`);
const noteValid = (n: string) => !!n && n !== "—";

// One-octave keyboard geometry (12 pitch classes).
const WHITE = [0, 2, 4, 5, 7, 9, 11]; // C D E F G A B
const KW = 100 / WHITE.length;
const BLACK = [
  { pc: 1, b: 1 },
  { pc: 3, b: 2 },
  { pc: 6, b: 4 },
  { pc: 8, b: 5 },
  { pc: 10, b: 6 },
];

export const App = () => {
  const [bgColor, setBgColor] = useState("#1e1e1e");

  // selection + analysis (one flow)
  const [clip, setClip] = useState<SelectedClipInfo | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);

  // binaries
  const [bins, setBins] = useState<BinStatus[]>([]);

  // transform: tempo + pitch (one Rubber Band pass)
  const [speed, setSpeed] = useState(1);
  const [pitchMode, setPitchMode] = useState<"nota" | "semitons">("nota");
  const [targetNote, setTargetNote] = useState(0); // pitch class 0=C..11=B
  const [semitones, setSemitones] = useState(0);
  const [processing, setProcessing] = useState(false);

  // match with reference
  const [ref, setRef] = useState<Clip | null>(null);
  const [target, setTarget] = useState<Clip | null>(null);
  const [settingRef, setSettingRef] = useState(false);
  const [settingTarget, setSettingTarget] = useState(false);
  const [matching, setMatching] = useState<"" | "tom" | "bpm" | "both">("");

  // docs + toasts
  const [docs, setDocs] = useState(false);
  const [docLang, setDocLang] = useState<DocLang>("en");
  const toastSeq = useRef(0);
  const [toasts, setToasts] = useState<
    { id: number; kind: "ok" | "warn" | "error"; text: string }[]
  >([]);

  const toast = (kind: "ok" | "warn" | "error", text: string) => {
    const id = ++toastSeq.current;
    setToasts((t) => [...t, { id, kind, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4200);
  };

  useEffect(() => {
    if (inCEP) {
      subscribeBackgroundColor(setBgColor);
      setBins(checkBinaries());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const missing = bins.filter((b) => !b.found);
  const binFound = (name: string) => bins.find((b) => b.name === name)?.found ?? false;
  const rbReady = binFound("rubberband");

  const handleBinaryError = (e: unknown) => {
    toast("error", e instanceof Error ? e.message : String(e));
  };

  const offsetFor = (info: SelectedClipInfo) =>
    info.source === "timeline" ? info.startSeconds : 0;

  // The source slice the timeline clip uses (undefined = whole media file).
  const regionFor = (info: SelectedClipInfo): AudioRegion | undefined =>
    info.source === "timeline" && info.durationSeconds > 0
      ? { startSec: info.inSeconds, durationSec: info.durationSeconds }
      : undefined;

  // single entry point: read the current selection AND analyze it
  const analyze = async () => {
    setAnalyzing(true);
    try {
      const info = (await evalTS("getSelectedClipInfo")) as SelectedClipInfo;
      setClip(info);
      if (!info.found) {
        setAnalysis(null);
        toast("error", info.error || "No audio clip selected.");
        return;
      }
      const res = await analyzeClip(info.path, regionFor(info));
      setAnalysis(res);
      if (noteValid(res.note.note)) setTargetNote(((res.note.midi % 12) + 12) % 12);
    } catch (e) {
      handleBinaryError(e);
    } finally {
      setAnalyzing(false);
    }
  };

  const grabAndAnalyze = async (): Promise<Clip | null> => {
    const info = (await evalTS("getSelectedClipInfo")) as SelectedClipInfo;
    if (!info.found) {
      toast("error", info.error || "No clip selected.");
      return null;
    }
    const a = await analyzeClip(info.path, regionFor(info));
    return { info, analysis: a };
  };

  const createMarkers = async () => {
    if (!clip?.found || !analysis) return;
    try {
      const res = (await evalTS(
        "createBeatMarkers",
        analysis.bpm.beats,
        "Beat"
      )) as { created: number; error: string };
      if (res.error) toast("warn", res.error);
      else toast("ok", `${res.created} beat markers created.`);
    } catch (e) {
      handleBinaryError(e);
    }
  };

  // --- transform: tempo + pitch in one pass ---
  const process = async () => {
    if (!clip?.found) return;
    setProcessing(true);
    try {
      const { output } = await timeStretch(clip.path, {
        speed,
        quality: "hq", // always Rubber Band R3
        pitchIndependent: pitchSt !== 0,
        pitchSemitones: pitchSt,
        region: regionFor(clip),
      });
      await reimport(output, offsetFor(clip), clip.trackIndex);
    } catch (e) {
      handleBinaryError(e);
    } finally {
      setProcessing(false);
    }
  };

  // --- reference / target ---
  const captureRef = async () => {
    setSettingRef(true);
    try {
      const c = await grabAndAnalyze();
      if (c) setRef(c);
    } catch (e) {
      handleBinaryError(e);
    } finally {
      setSettingRef(false);
    }
  };

  const captureTarget = async () => {
    setSettingTarget(true);
    try {
      const c = await grabAndAnalyze();
      if (c) setTarget(c);
    } catch (e) {
      handleBinaryError(e);
    } finally {
      setSettingTarget(false);
    }
  };

  const tomShift =
    ref && target && noteValid(ref.analysis.note.note) && noteValid(target.analysis.note.note)
      ? noteMatchShift(target.analysis.note.midi, ref.analysis.note.midi)
      : 0;
  const bpmSpeed =
    ref && target && ref.analysis.bpm.bpm > 0 && target.analysis.bpm.bpm > 0
      ? tempoMatchSpeed(target.analysis.bpm.bpm, ref.analysis.bpm.bpm)
      : 1;
  const canMatchTom =
    !!ref && !!target && rbReady &&
    noteValid(ref.analysis.note.note) && noteValid(target.analysis.note.note);
  const canMatchBpm =
    !!ref && !!target && rbReady &&
    ref.analysis.bpm.bpm > 0 && target.analysis.bpm.bpm > 0;

  const match = async (kind: "tom" | "bpm" | "both") => {
    if (!ref || !target) return;

    const doTom = kind === "tom" || kind === "both";
    const doBpm = kind === "bpm" || kind === "both";
    const shift = doTom ? tomShift : 0;
    const sp = doBpm ? bpmSpeed : 1;

    if (doTom && shift === 0 && (!doBpm || Math.abs(sp - 1) < 0.001)) {
      toast("warn", "Target already matches the reference — nothing to do.");
      return;
    }
    if (kind === "bpm" && Math.abs(sp - 1) < 0.001) {
      toast("warn", "BPM already matches — nothing to do.");
      return;
    }

    setMatching(kind);
    try {
      const { output } = await timeStretch(target.info.path, {
        speed: sp,
        quality: "hq",
        pitchIndependent: doTom && shift !== 0,
        pitchSemitones: shift,
        region: regionFor(target.info),
      });
      await reimport(output, offsetFor(target.info), target.info.trackIndex);
    } catch (e) {
      handleBinaryError(e);
    } finally {
      setMatching("");
    }
  };

  // shared: reimport + overwrite onto the clip's own track
  const reimport = async (output: string, offset: number, trackIndex: number) => {
    const imp = (await evalTS("importAndInsert", output, offset, true, trackIndex)) as {
      success: boolean;
      name: string;
      inserted: boolean;
      error: string;
    };
    if (!imp.success) toast("warn", `Processed, but reimport failed: ${imp.error}`);
    else if (imp.inserted) toast("ok", "Replaced on timeline.");
    else toast("ok", "Reimported into project (no active sequence).");
  };

  const recheckBinaries = () => {
    clearBinaryCache();
    setBins(checkBinaries());
  };

  const ready = !!clip?.found;
  const hasTom = !!analysis && noteValid(analysis.note.note);
  const curPc = hasTom ? ((analysis!.note.midi % 12) + 12) % 12 : -1;

  // Effective pitch shift (semitones) the transform will apply.
  const pitchSt =
    pitchMode === "nota"
      ? hasTom
        ? pitchClassShift(analysis!.note.midi, targetNote)
        : 0
      : semitones;
  const transformNoop = Math.abs(speed - 1) < 0.001 && pitchSt === 0;
  // Everything goes through Rubber Band (HQ); ffmpeg still decodes/slices.
  const transformReady = rbReady && binFound("ffmpeg");

  if (docs) {
    return <Docs lang={docLang} onLang={setDocLang} onClose={() => setDocs(false)} />;
  }

  return (
    <div className="app" style={{ backgroundColor: bgColor }}>
      <div className="toasts">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.kind}`}>
            {t.kind === "ok" ? (
              <CircleCheck size={14} />
            ) : t.kind === "warn" ? (
              <TriangleAlert size={14} />
            ) : (
              <CircleAlert size={14} />
            )}
            <span>{t.text}</span>
          </div>
        ))}
      </div>

      <header className="topbar">
        <span className="brand">
          <AudioLines size={16} className="brand-icon" />
          Beat&nbsp;Match
        </span>
        <button className="info-btn" onClick={() => setDocs(true)} title="User guide">
          <Info size={16} />
        </button>
      </header>

      {!inCEP && (
        <div className="banner warn">
          <TriangleAlert size={14} />
          Browser preview — analysis and processing only run inside Premiere Pro.
        </div>
      )}

      {missing.length > 0 && (
        <div className="banner error">
          <TriangleAlert size={14} />
          <span>
            Missing binaries: <b>{missing.map((m) => m.name).join(", ")}</b>
          </span>
          <button className="link" onClick={recheckBinaries}>
            <RefreshCw size={11} /> recheck
          </button>
        </div>
      )}

      {/* ---- Analysis ---- */}
      <section className="card">
        <div className="clip-row">
          <AudioLines size={15} className={ready ? "ic" : "ic muted"} />
          <div className="clip-name" title={ready ? clip!.path : ""}>
            {ready ? clip!.name : <span className="muted">No clip selected</span>}
          </div>
        </div>

        <div className="readouts">
          <div className="readout">
            <Activity size={14} className="ic" />
            <span className={`big ${analysis ? "" : "muted"}`}>
              {analysis ? analysis.bpm.bpm || "—" : "—"}
            </span>
            <span className="unit">BPM</span>
            {analysis && <Badge level={analysis.bpm.confidence} />}
          </div>
          <div className="readout">
            <Music2 size={14} className="ic" />
            <span className={`big ${analysis ? "" : "muted"}`}>
              {analysis ? analysis.note.note : "—"}
            </span>
            <span className="unit">key</span>
            {analysis && <Badge level={analysis.note.confidence} />}
          </div>
        </div>

        <div className="btn-group">
          <button className="btn soft" onClick={analyze} disabled={analyzing}>
            {analyzing ? (
              <>
                <Loader2 size={14} className="spin" /> Analyzing…
              </>
            ) : (
              <>
                <Activity size={14} /> {analysis ? "Re-analyze" : "Analyze"}
              </>
            )}
          </button>
          <button
            className="btn soft"
            onClick={createMarkers}
            disabled={!analysis?.bpm.beats.length}
          >
            <Flag size={13} /> Markers
            {analysis?.bpm.beats.length ? ` (${analysis.bpm.beats.length})` : ""}
          </button>
        </div>
      </section>

      {/* ---- Transformar (tempo + pitch, one Rubber Band pass) ---- */}
      <section className="card">
        <h2>
          <Wand2 size={12} /> Transform
        </h2>

        {/* tempo — single row */}
        <div className="ctl-row">
          <label>Speed</label>
          <input
            type="range"
            min={0.5}
            max={2}
            step={0.01}
            value={speed}
            disabled={!ready}
            onChange={(e) => setSpeed(parseFloat(e.target.value))}
          />
          <input
            type="number"
            className="num"
            min={0.1}
            max={8}
            step={0.05}
            value={speed}
            disabled={!ready}
            onChange={(e) => setSpeed(parseFloat(e.target.value) || 1)}
          />
        </div>

        {/* pitch — by note (piano) or raw semitones */}
        <div className="control">
          <div className="segmented">
            <button
              className={`seg ${pitchMode === "nota" ? "active" : ""}`}
              onClick={() => setPitchMode("nota")}
              disabled={!ready}
            >
              <Music2 size={13} /> Note
            </button>
            <button
              className={`seg ${pitchMode === "semitons" ? "active" : ""}`}
              onClick={() => setPitchMode("semitons")}
              disabled={!ready}
            >
              <ArrowUpDown size={13} /> Semitones
            </button>
          </div>

          {pitchMode === "nota" ? (
            <>
              <div className={`piano ${!ready || !hasTom ? "disabled" : ""}`}>
                <div className="whites">
                  {WHITE.map((pc) => (
                    <button
                      key={pc}
                      className={`wkey ${targetNote === pc ? "active" : ""} ${
                        curPc === pc ? "current" : ""
                      }`}
                      onClick={() => setTargetNote(pc)}
                      disabled={!ready || !hasTom}
                      title={curPc === pc ? "nota atual" : NOTE_NAMES[pc]}
                    >
                      <span className="kl">{NOTE_NAMES[pc]}</span>
                      {curPc === pc && <span className="dot" />}
                    </button>
                  ))}
                </div>
                <div className="blacks">
                  {BLACK.map((bk) => (
                    <button
                      key={bk.pc}
                      className={`bkey ${targetNote === bk.pc ? "active" : ""} ${
                        curPc === bk.pc ? "current" : ""
                      }`}
                      style={{
                        left: `${(bk.b - 0.31) * KW}%`,
                        width: `${0.62 * KW}%`,
                      }}
                      onClick={() => setTargetNote(bk.pc)}
                      disabled={!ready || !hasTom}
                      title={curPc === bk.pc ? "nota atual" : NOTE_NAMES[bk.pc]}
                    >
                      {curPc === bk.pc && <span className="dot" />}
                    </button>
                  ))}
                </div>
              </div>

              <div className="transpose">
                {hasTom ? (
                  <>
                    <span className="from">{analysis!.note.note.replace(/\d+$/, "")}</span>
                    <ArrowRight size={14} className="arr" />
                    <span className="to">{NOTE_NAMES[targetNote]}</span>
                    <span className={`delta ${pitchSt === 0 ? "zero" : ""}`}>
                      {pitchSt === 0 ? "no change" : `${fmtSt(pitchSt)} st`}
                    </span>
                    {curPc >= 0 && targetNote !== curPc && (
                      <button
                        className="icon-only reset"
                        title="Back to original key"
                        onClick={() => setTargetNote(curPc)}
                      >
                        <RotateCcw size={13} />
                      </button>
                    )}
                  </>
                ) : (
                  <span className="muted-line">
                    {ready
                      ? "No detectable key — use Semitones."
                      : "Analyze a clip to detect its key."}
                  </span>
                )}
              </div>
            </>
          ) : (
            <div className="ctl-row">
              <label>Semitones</label>
              <input
                type="range"
                min={-12}
                max={12}
                step={1}
                value={semitones}
                disabled={!ready}
                onChange={(e) => setSemitones(parseInt(e.target.value))}
              />
              <input
                type="number"
                className="num"
                min={-24}
                max={24}
                step={1}
                value={semitones}
                disabled={!ready}
                onChange={(e) => setSemitones(parseInt(e.target.value) || 0)}
              />
            </div>
          )}
        </div>

        {/* process */}
        <button
          className="btn primary block"
          onClick={process}
          disabled={!ready || processing || transformNoop || !transformReady}
        >
          {processing ? (
            <>
              <Loader2 size={14} className="spin" /> Processing…
            </>
          ) : (
            <>
              <Wand2 size={14} /> Process &amp; replace
            </>
          )}
        </button>
      </section>

      {/* ---- Match to reference ---- */}
      <section className="card">
        <h2>
          <GitCompareArrows size={12} /> Match to reference
        </h2>

        <div className="ref-group">
          <div className="ref-row">
            <button className="btn ref-btn" onClick={captureRef} disabled={settingRef}>
              {settingRef ? <Loader2 size={13} className="spin" /> : <Target size={13} />}
              Reference
            </button>
            <ClipChip clip={ref} placeholder="the key/BPM to match" />
          </div>
          <div className="ref-row">
            <button
              className="btn ref-btn"
              onClick={captureTarget}
              disabled={settingTarget}
            >
              {settingTarget ? <Loader2 size={13} className="spin" /> : <AudioLines size={13} />}
              Target
            </button>
            <ClipChip clip={target} placeholder="the audio to be modified" />
          </div>
        </div>

        <div className="match-buttons">
          <button
            className="btn soft"
            onClick={() => match("tom")}
            disabled={!canMatchTom || matching !== ""}
          >
            {matching === "tom" ? <Loader2 size={13} className="spin" /> : <Music2 size={13} />}
            Key
          </button>
          <button
            className="btn soft"
            onClick={() => match("bpm")}
            disabled={!canMatchBpm || matching !== ""}
          >
            {matching === "bpm" ? <Loader2 size={13} className="spin" /> : <Activity size={13} />}
            BPM
          </button>
          <button
            className="btn primary"
            onClick={() => match("both")}
            disabled={!(canMatchTom && canMatchBpm) || matching !== ""}
          >
            {matching === "both" ? (
              <Loader2 size={13} className="spin" />
            ) : (
              <GitCompareArrows size={13} />
            )}
            Both
          </button>
        </div>
      </section>
    </div>
  );
};

const Badge = ({ level }: { level: string }) => (
  <span className={`badge ${level}`}>{confidenceLabel[level] || level}</span>
);

const ClipChip = ({ clip, placeholder }: { clip: Clip | null; placeholder: string }) =>
  clip ? (
    <div className="ref-chip">
      <span className="ref-name" title={clip.info.path}>
        {clip.info.name}
      </span>
      <span className="ref-vals">
        {clip.analysis.note.note} · {clip.analysis.bpm.bpm || "—"} BPM
      </span>
    </div>
  ) : (
    <div className="ref-chip empty">{placeholder}</div>
  );
