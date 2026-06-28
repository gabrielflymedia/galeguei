import type { ReactNode } from "react";
import {
  ArrowLeft,
  Languages,
  AudioLines,
  Activity,
  Flag,
  Gauge,
  Music2,
  GitCompareArrows,
  BookOpen,
  Info,
} from "lucide-react";

export type DocLang = "en" | "pt";

type Section = {
  icon: ReactNode;
  anim: "wave" | "markers" | "stretch" | "pitch" | "match" | "none";
  h: string;
  p: string[];
};

// Small CSS-driven illustrations (defined in main.scss).
const Anim = ({ kind }: { kind: Section["anim"] }) => {
  if (kind === "none") return null;
  if (kind === "wave")
    return (
      <div className="anim anim-wave">
        {Array.from({ length: 22 }).map((_, i) => (
          <span key={i} style={{ animationDelay: `${(i % 11) * 0.08}s` }} />
        ))}
      </div>
    );
  if (kind === "markers")
    return (
      <div className="anim anim-markers">
        <span className="line" />
        {[12, 30, 48, 66, 84].map((l, i) => (
          <span key={l} className="flag" style={{ left: `${l}%`, animationDelay: `${i * 0.25}s` }} />
        ))}
      </div>
    );
  if (kind === "stretch")
    return (
      <div className="anim anim-stretch">
        <span className="ghost" />
        <span className="bar" />
      </div>
    );
  if (kind === "pitch")
    return (
      <div className="anim anim-pitch">
        <span className="ln" style={{ top: "20%" }} />
        <span className="ln" style={{ top: "50%" }} />
        <span className="ln" style={{ top: "80%" }} />
        <span className="dot" />
      </div>
    );
  // match
  return (
    <div className="anim anim-match">
      <span className="ref" />
      <span className="tgt" />
    </div>
  );
};

const DOC: Record<DocLang, { back: string; title: string; sections: Section[] }> = {
  en: {
    back: "Back",
    title: "Beat Match — user guide",
    sections: [
      {
        icon: <BookOpen size={15} />,
        anim: "wave",
        h: "What it does",
        p: [
          "Beat Match reads the BPM and musical key of a selected audio clip and lets you re-time or re-pitch it — writing the result back in place on the timeline.",
          "Everything works on the exact in/out region the clip uses, so the processed audio lines up with what's actually cut.",
        ],
      },
      {
        icon: <Activity size={15} />,
        anim: "wave",
        h: "Analyze",
        p: [
          "Select an audio clip on the timeline and hit Analyze audio (it also re-reads the current selection each time).",
          "It detects BPM and key, each with a confidence badge — high, mid or low. Low usually means the clip isn't clearly tonal or rhythmic.",
        ],
      },
      {
        icon: <Flag size={15} />,
        anim: "markers",
        h: "Beat markers",
        p: [
          "After analyzing, Beat markers drops one sequence marker on every detected beat, aligned to the clip's position on the timeline.",
          "Great for cutting other media to the rhythm.",
        ],
      },
      {
        icon: <Gauge size={15} />,
        anim: "stretch",
        h: "Speed (time-stretch)",
        p: [
          "The Speed slider stretches or compresses the clip with Rubber Band while keeping the pitch intact.",
          "1.00× = unchanged · below 1 = slower and longer · above 1 = faster and shorter.",
        ],
      },
      {
        icon: <Music2 size={15} />,
        anim: "pitch",
        h: "Note / Semitones (pitch)",
        p: [
          "Shifting pitch means changing the key. In Note mode, pick a target note on the piano — the amber marker is the current key, and Beat Match finds the smallest shift to land on it.",
          "In Semitones mode you dial the shift by hand. Speed and pitch are applied together in a single Rubber Band pass, and the result replaces the clip in place on its own track.",
        ],
      },
      {
        icon: <GitCompareArrows size={15} />,
        anim: "match",
        h: "Match to reference",
        p: [
          "Set a Reference (the sound you want to match) and a Target (the clip to change).",
          "Then Key, BPM or Both re-pitches / re-times the target so it lines up with the reference.",
        ],
      },
      {
        icon: <Info size={15} />,
        anim: "none",
        h: "Requirements",
        p: [
          "Beat Match needs ffmpeg and ffprobe on your PATH for decoding and region slicing.",
          "aubio and rubberband ship bundled on Windows. If anything is missing, a banner shows at the top of the panel.",
        ],
      },
    ],
  },
  pt: {
    back: "Voltar",
    title: "Beat Match — manual de uso",
    sections: [
      {
        icon: <BookOpen size={15} />,
        anim: "wave",
        h: "O que faz",
        p: [
          "O Beat Match lê o BPM e o tom de um clipe de áudio selecionado e deixa você reesticar ou retransporr — gravando o resultado de volta no lugar, na timeline.",
          "Tudo trabalha exatamente no trecho in/out que o clipe usa, então o áudio processado bate com o que está cortado.",
        ],
      },
      {
        icon: <Activity size={15} />,
        anim: "wave",
        h: "Analisar",
        p: [
          "Selecione um clipe de áudio na timeline e clique em Analyze audio (ele também relê a seleção atual a cada clique).",
          "Detecta BPM e tom, cada um com um selo de confiança — high, mid ou low. Low geralmente quer dizer que o clipe não é claramente tonal ou rítmico.",
        ],
      },
      {
        icon: <Flag size={15} />,
        anim: "markers",
        h: "Markers de batida",
        p: [
          "Depois de analisar, o Beat markers cria um marcador de sequência em cada batida detectada, alinhado à posição do clipe na timeline.",
          "Ótimo para cortar outras mídias no ritmo.",
        ],
      },
      {
        icon: <Gauge size={15} />,
        anim: "stretch",
        h: "Velocidade (time-stretch)",
        p: [
          "O slider de Speed estica ou comprime o clipe com o Rubber Band mantendo o pitch intacto.",
          "1.00× = sem mudança · abaixo de 1 = mais lento e longo · acima de 1 = mais rápido e curto.",
        ],
      },
      {
        icon: <Music2 size={15} />,
        anim: "pitch",
        h: "Note / Semitones (tom)",
        p: [
          "Mudar o pitch é mudar o tom. No modo Note, escolha a nota alvo no piano — o marcador âmbar é o tom atual, e o Beat Match acha o menor deslocamento pra chegar nela.",
          "No modo Semitones você ajusta o deslocamento na mão. Velocidade e tom são aplicados juntos numa única passada do Rubber Band, e o resultado substitui o clipe no lugar, na própria track.",
        ],
      },
      {
        icon: <GitCompareArrows size={15} />,
        anim: "match",
        h: "Casar com referência",
        p: [
          "Defina uma Reference (o som que você quer igualar) e um Target (o clipe a modificar).",
          "Aí Key, BPM ou Both retranspõe / reestica o alvo pra ele casar com a referência.",
        ],
      },
      {
        icon: <Info size={15} />,
        anim: "none",
        h: "Requisitos",
        p: [
          "O Beat Match precisa do ffmpeg e do ffprobe no PATH para decodificar e cortar a região.",
          "aubio e rubberband já vêm embutidos no Windows. Se faltar algo, aparece um aviso no topo do painel.",
        ],
      },
    ],
  },
};

export const Docs = ({
  lang,
  onLang,
  onClose,
}: {
  lang: DocLang;
  onLang: (l: DocLang) => void;
  onClose: () => void;
}) => {
  const d = DOC[lang];
  return (
    <div className="docs">
      <div className="docs-bar">
        <button className="btn ghost" onClick={onClose}>
          <ArrowLeft size={14} /> {d.back}
        </button>
        <button
          className="btn ghost lang"
          onClick={() => onLang(lang === "en" ? "pt" : "en")}
          title="EN / PT"
        >
          <Languages size={14} /> {lang === "en" ? "PT" : "EN"}
        </button>
      </div>

      <div className="docs-scroll">
        <h1 className="docs-title">{d.title}</h1>
        {d.sections.map((s, i) => (
          <section className="doc-sec" key={i}>
            <div className="doc-h">
              <span className="doc-ic">{s.icon}</span>
              {s.h}
            </div>
            <Anim kind={s.anim} />
            {s.p.map((para, k) => (
              <p key={k}>{para}</p>
            ))}
          </section>
        ))}
        <div className="docs-foot">flymedia · Beat Match</div>
      </div>
    </div>
  );
};
