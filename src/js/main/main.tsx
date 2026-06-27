import { useEffect, useState } from "react";
import { evalTS, subscribeBackgroundColor } from "../lib/utils/bolt";
import {
  analyzeClip,
  timeStretch,
  BinaryMissingError,
  NOTE_NAMES,
  pitchClassShift,
  noteMatchShift,
  tempoMatchSpeed,
  type AnalysisResult,
  type StretchQuality,
} from "../lib/audio";
import { checkBinaries, clearBinaryCache, type BinStatus } from "../lib/binaries";
import "./main.scss";

// --- bridge return shapes (mirror src/jsx/ppro/ppro.ts) ---
type SelectedClipInfo = {
  found: boolean;
  source: "timeline" | "project" | "none";
  name: string;
  path: string;
  startSeconds: number;
  mediaType: string;
  error: string;
};

type Clip = { info: SelectedClipInfo; analysis: AnalysisResult };

const inCEP = typeof window !== "undefined" && !!(window as any).cep;

const confidenceLabel: Record<string, string> = {
  alta: "alta confiança",
  media: "confiança média",
  baixa: "baixa confiança",
};

const fmtCents = (c: number) => (c > 0 ? `+${c}` : `${c}`);
const fmtSt = (n: number) => (n > 0 ? `+${n} st` : `${n} st`);
const noteValid = (n: string) => !!n && n !== "—";

export const App = () => {
  const [bgColor, setBgColor] = useState("#1e1e1e");

  // selection
  const [clip, setClip] = useState<SelectedClipInfo | null>(null);
  const [selecting, setSelecting] = useState(false);

  // binaries
  const [bins, setBins] = useState<BinStatus[]>([]);

  // analysis
  const [analyzing, setAnalyzing] = useState(false);
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [markersMsg, setMarkersMsg] = useState("");

  // tom (target note)
  const [targetNote, setTargetNote] = useState(0); // pitch class 0=C..11=B
  const [applyingTom, setApplyingTom] = useState(false);
  const [tomMsg, setTomMsg] = useState("");

  // stretch
  const [speed, setSpeed] = useState(1.25);
  const [quality, setQuality] = useState<StretchQuality>("hq");
  const [pitchIndependent, setPitchIndependent] = useState(false);
  const [semitones, setSemitones] = useState(0);
  const [processing, setProcessing] = useState(false);
  const [processMsg, setProcessMsg] = useState("");

  // match with reference
  const [ref, setRef] = useState<Clip | null>(null);
  const [target, setTarget] = useState<Clip | null>(null);
  const [settingRef, setSettingRef] = useState(false);
  const [settingTarget, setSettingTarget] = useState(false);
  const [matching, setMatching] = useState<"" | "tom" | "bpm" | "both">("");
  const [matchMsg, setMatchMsg] = useState("");

  // global error
  const [error, setError] = useState("");

  useEffect(() => {
    if (inCEP) {
      subscribeBackgroundColor(setBgColor);
      setBins(checkBinaries());
      refreshSelection();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const missing = bins.filter((b) => !b.found);
  const binFound = (name: string) => bins.find((b) => b.name === name)?.found ?? false;
  const rbReady = binFound("rubberband");

  const handleBinaryError = (e: unknown) => {
    setError(e instanceof Error ? e.message : String(e));
  };

  const grabAndAnalyze = async (): Promise<Clip | null> => {
    const info = (await evalTS("getSelectedClipInfo")) as SelectedClipInfo;
    if (!info.found) {
      setError(info.error || "Nenhum clipe selecionado.");
      return null;
    }
    const analysis = await analyzeClip(info.path);
    return { info, analysis };
  };

  const offsetFor = (info: SelectedClipInfo) =>
    info.source === "timeline" ? info.startSeconds : 0;

  const refreshSelection = async () => {
    setSelecting(true);
    setError("");
    setMarkersMsg("");
    try {
      const info = (await evalTS("getSelectedClipInfo")) as SelectedClipInfo;
      setClip(info);
      setAnalysis(null);
      if (!info.found && info.error) setError(info.error);
    } catch (e) {
      handleBinaryError(e);
    } finally {
      setSelecting(false);
    }
  };

  const runAnalysis = async () => {
    if (!clip?.found) return;
    setAnalyzing(true);
    setError("");
    setMarkersMsg("");
    setTomMsg("");
    setAnalysis(null);
    try {
      const res = await analyzeClip(clip.path);
      setAnalysis(res);
      if (noteValid(res.note.note)) setTargetNote(((res.note.midi % 12) + 12) % 12);
    } catch (e) {
      handleBinaryError(e);
    } finally {
      setAnalyzing(false);
    }
  };

  const createMarkers = async () => {
    if (!clip?.found || !analysis) return;
    setMarkersMsg("");
    setError("");
    try {
      const res = (await evalTS(
        "createBeatMarkers",
        analysis.bpm.beats,
        offsetFor(clip),
        "Beat"
      )) as { created: number; error: string };
      setMarkersMsg(res.error ? `⚠ ${res.error}` : `✓ ${res.created} markers criados.`);
    } catch (e) {
      handleBinaryError(e);
    }
  };

  // --- manual stretch ---
  const process = async () => {
    if (!clip?.found) return;
    setProcessing(true);
    setProcessMsg("");
    setError("");
    try {
      const { output } = await timeStretch(clip.path, {
        speed,
        quality,
        pitchIndependent: quality === "hq" && pitchIndependent,
        pitchSemitones: semitones,
      });
      await reimport(output, offsetFor(clip), setProcessMsg);
    } catch (e) {
      handleBinaryError(e);
    } finally {
      setProcessing(false);
    }
  };

  // --- apply target note (barra de tom) ---
  const applyTom = async () => {
    if (!clip?.found || !analysis || !noteValid(analysis.note.note)) return;
    const shift = pitchClassShift(analysis.note.midi, targetNote);
    setTomMsg("");
    setError("");
    if (shift === 0) {
      setTomMsg(`Já está em ${NOTE_NAMES[targetNote]} — nada a transpor.`);
      return;
    }
    setApplyingTom(true);
    try {
      const { output } = await timeStretch(clip.path, {
        speed: 1,
        quality: "hq",
        pitchIndependent: true,
        pitchSemitones: shift,
      });
      await reimport(output, offsetFor(clip), setTomMsg);
    } catch (e) {
      handleBinaryError(e);
    } finally {
      setApplyingTom(false);
    }
  };

  // --- reference / target ---
  const captureRef = async () => {
    setSettingRef(true);
    setError("");
    setMatchMsg("");
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
    setError("");
    setMatchMsg("");
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
    setMatchMsg("");
    setError("");

    const doTom = kind === "tom" || kind === "both";
    const doBpm = kind === "bpm" || kind === "both";
    const shift = doTom ? tomShift : 0;
    const sp = doBpm ? bpmSpeed : 1;

    if (doTom && shift === 0 && (!doBpm || Math.abs(sp - 1) < 0.001)) {
      setMatchMsg("Alvo já está casado com a referência — nada a fazer.");
      return;
    }
    if (kind === "bpm" && Math.abs(sp - 1) < 0.001) {
      setMatchMsg("BPM já está igual — nada a fazer.");
      return;
    }

    setMatching(kind);
    try {
      const { output } = await timeStretch(target.info.path, {
        speed: sp,
        quality: "hq",
        pitchIndependent: doTom && shift !== 0,
        pitchSemitones: shift,
      });
      await reimport(output, offsetFor(target.info), setMatchMsg);
    } catch (e) {
      handleBinaryError(e);
    } finally {
      setMatching("");
    }
  };

  // shared: reimport + insert, write status into the given setter
  const reimport = async (
    output: string,
    offset: number,
    setMsg: (s: string) => void
  ) => {
    const imp = (await evalTS("importAndInsert", output, offset, true)) as {
      success: boolean;
      name: string;
      inserted: boolean;
      error: string;
    };
    if (!imp.success) setMsg(`⚠ Processado, mas falhou ao reimportar: ${imp.error}`);
    else if (imp.inserted) setMsg("✓ Reimportado e inserido na timeline.");
    else setMsg("✓ Reimportado no projeto (sem sequência ativa p/ inserir).");
  };

  const recheckBinaries = () => {
    clearBinaryCache();
    setBins(checkBinaries());
    setError("");
  };

  const curPc = analysis && noteValid(analysis.note.note)
    ? ((analysis.note.midi % 12) + 12) % 12
    : -1;
  const tomShiftPreview =
    analysis && noteValid(analysis.note.note)
      ? pitchClassShift(analysis.note.midi, targetNote)
      : 0;

  return (
    <div className="app" style={{ backgroundColor: bgColor }}>
      <header className="topbar">
        <span className="brand">Fly Audio Toolkit</span>
        <span className="sub">galeguei</span>
      </header>

      {!inCEP && (
        <div className="banner warn">
          Preview no navegador — análise e processamento só funcionam dentro do
          Premiere Pro.
        </div>
      )}

      {missing.length > 0 && (
        <div className="banner error">
          Binários ausentes: <b>{missing.map((m) => m.name).join(", ")}</b>.
          <button className="link" onClick={recheckBinaries}>
            verificar novamente
          </button>
        </div>
      )}

      {error && (
        <div className="banner error">
          {error}
          <button className="link" onClick={() => setError("")}>
            ✕
          </button>
        </div>
      )}

      {/* ---- Selection ---- */}
      <section className="card">
        <div className="clip-row">
          <div className="clip-info">
            {clip?.found ? (
              <>
                <div className="clip-name" title={clip.path}>
                  {clip.name}
                </div>
                <div className="clip-meta">
                  {clip.source === "timeline" ? "timeline" : "project panel"}
                  {clip.mediaType ? ` · ${clip.mediaType}` : ""}
                </div>
              </>
            ) : (
              <div className="clip-name muted">Nenhum clipe selecionado</div>
            )}
          </div>
          <button className="btn" onClick={refreshSelection} disabled={selecting}>
            {selecting ? "…" : "Atualizar seleção"}
          </button>
        </div>
      </section>

      {/* ---- Analysis ---- */}
      <section className="card">
        <h2>Análise</h2>
        <button
          className="btn primary block"
          onClick={runAnalysis}
          disabled={!clip?.found || analyzing}
        >
          {analyzing ? "Analisando…" : "Analisar áudio"}
        </button>

        {analysis && (
          <div className="results">
            <div className="result-line">
              <span className="label">BPM</span>
              <span className="value">{analysis.bpm.bpm || "—"}</span>
              <Badge level={analysis.bpm.confidence} />
            </div>
            <div className="result-line">
              <span className="label">Nota</span>
              <span className="value">
                {analysis.note.note}
                {analysis.note.frequency
                  ? ` · ${analysis.note.frequency} Hz · ${fmtCents(analysis.note.cents)} cents`
                  : ""}
              </span>
              <Badge level={analysis.note.confidence} />
            </div>
            <button
              className="btn block"
              onClick={createMarkers}
              disabled={!analysis.bpm.beats.length}
            >
              Criar markers de batida ({analysis.bpm.beats.length})
            </button>
            {markersMsg && <div className="msg">{markersMsg}</div>}
          </div>
        )}
      </section>

      {/* ---- Tom (target note) ---- */}
      <section className="card">
        <h2>Tom</h2>
        {!analysis || !noteValid(analysis.note.note) ? (
          <div className="note-hint">
            Analise um clipe com tom detectável para escolher a nota alvo.
          </div>
        ) : (
          <>
            <div className="note-bar">
              {NOTE_NAMES.map((nm, i) => (
                <button
                  key={nm}
                  className={`note-cell ${targetNote === i ? "active" : ""} ${
                    curPc === i ? "current" : ""
                  }`}
                  onClick={() => setTargetNote(i)}
                  title={curPc === i ? "nota atual" : ""}
                >
                  {nm}
                </button>
              ))}
            </div>
            <div className="tom-preview">
              {analysis.note.note} → {NOTE_NAMES[targetNote]}{" "}
              <span className="shift">({fmtSt(tomShiftPreview)})</span>
            </div>
            <button
              className="btn primary block"
              onClick={applyTom}
              disabled={!rbReady || applyingTom}
            >
              {applyingTom ? "Aplicando…" : "Aplicar tom (Rubber Band)"}
            </button>
            {tomMsg && <div className="msg">{tomMsg}</div>}
          </>
        )}
      </section>

      {/* ---- Time-stretch ---- */}
      <section className="card">
        <h2>Time-stretch</h2>
        <div className="control">
          <label>
            Velocidade <span className="speed-val">{speed.toFixed(2)}x</span>
          </label>
          <div className="slider-row">
            <input
              type="range"
              min={0.5}
              max={2}
              step={0.01}
              value={speed}
              onChange={(e) => setSpeed(parseFloat(e.target.value))}
            />
            <input
              type="number"
              className="num"
              min={0.1}
              max={8}
              step={0.05}
              value={speed}
              onChange={(e) => setSpeed(parseFloat(e.target.value) || 1)}
            />
          </div>
        </div>

        <div className="control">
          <label>Qualidade</label>
          <div className="radio-row">
            <label className="radio">
              <input
                type="radio"
                name="quality"
                checked={quality === "fast"}
                onChange={() => setQuality("fast")}
              />
              Rápido <span className="hint">(ffmpeg)</span>
            </label>
            <label className="radio">
              <input
                type="radio"
                name="quality"
                checked={quality === "hq"}
                onChange={() => setQuality("hq")}
              />
              Alta qualidade <span className="hint">(Rubber Band)</span>
            </label>
          </div>
        </div>

        <div className="control">
          <label
            className={`checkbox ${quality !== "hq" ? "disabled" : ""}`}
            title={quality !== "hq" ? "Disponível apenas no modo Alta qualidade" : ""}
          >
            <input
              type="checkbox"
              disabled={quality !== "hq"}
              checked={pitchIndependent}
              onChange={(e) => setPitchIndependent(e.target.checked)}
            />
            Alterar pitch independente
          </label>
          {quality === "hq" && pitchIndependent && (
            <div className="semitones">
              <span>Semitons</span>
              <input
                type="number"
                className="num"
                min={-24}
                max={24}
                step={1}
                value={semitones}
                onChange={(e) => setSemitones(parseInt(e.target.value) || 0)}
              />
            </div>
          )}
        </div>

        {quality === "fast" && (
          <div className="note-hint">
            Modo rápido preserva o pitch mas pode introduzir artefatos em
            stretches grandes. Para drones/SFX tonais use Alta qualidade.
          </div>
        )}

        <button
          className="btn primary block"
          onClick={process}
          disabled={
            !clip?.found ||
            processing ||
            (quality === "hq" && !rbReady) ||
            (quality === "fast" && !binFound("ffmpeg"))
          }
        >
          {processing ? "Processando…" : "Processar e reimportar"}
        </button>
        {processMsg && <div className="msg">{processMsg}</div>}
      </section>

      {/* ---- Match with reference ---- */}
      <section className="card">
        <h2>Casar com referência</h2>

        <div className="ref-row">
          <button className="btn" onClick={captureRef} disabled={settingRef}>
            {settingRef ? "…" : "Definir referência"}
          </button>
          <ClipChip clip={ref} placeholder="defina o tom/BPM de referência" />
        </div>
        <div className="ref-row">
          <button className="btn" onClick={captureTarget} disabled={settingTarget}>
            {settingTarget ? "…" : "Definir alvo"}
          </button>
          <ClipChip clip={target} placeholder="o áudio que será modificado" />
        </div>

        {ref && target && (
          <div className="note-hint">
            {canMatchTom
              ? `Tom: ${target.analysis.note.note} → ${ref.analysis.note.note} (${fmtSt(tomShift)})`
              : "Tom: indisponível (nota não detectada)"}
            {"  ·  "}
            {canMatchBpm
              ? `BPM: ${target.analysis.bpm.bpm} → ${ref.analysis.bpm.bpm} (${bpmSpeed}x)`
              : "BPM: indisponível"}
          </div>
        )}

        <div className="match-buttons">
          <button
            className="btn primary"
            onClick={() => match("tom")}
            disabled={!canMatchTom || matching !== ""}
          >
            {matching === "tom" ? "…" : "Igualar tom"}
          </button>
          <button
            className="btn primary"
            onClick={() => match("bpm")}
            disabled={!canMatchBpm || matching !== ""}
          >
            {matching === "bpm" ? "…" : "Igualar BPM"}
          </button>
          <button
            className="btn primary"
            onClick={() => match("both")}
            disabled={!(canMatchTom && canMatchBpm) || matching !== ""}
          >
            {matching === "both" ? "…" : "Tom + BPM"}
          </button>
        </div>
        {matchMsg && <div className="msg">{matchMsg}</div>}
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
