# Roadmap — Fly Audio Toolkit (galeguei)

Painel CEP (bolt-cep) para Premiere Pro: análise de BPM/nota e time-stretch com
preservação de pitch, mais matching tom/BPM entre clipes.

---

## ✅ Feito (v0.1)

- **Ponte ExtendScript** (`src/jsx/ppro/ppro.ts`) — só toca timeline/projeto:
  `getSelectedClipInfo`, `getCurrentSequenceInfo`, `createBeatMarkers`,
  `importAndInsert`, `ping`.
- **Resolver de binários** (`src/js/lib/binaries.ts`) — procura `bin/{mac,win}`
  bundled → homebrew/usr → PATH; `checkBinaries()` alimenta a UI.
- **Módulo DSP** (`src/js/lib/audio.ts`), desacoplado da UI:
  - F1 BPM (`aubio tempo`) + confiança via regularidade das batidas
  - F2 Nota (`aubio pitch` → mediana → `hzToNote`) + confiança
  - F3 Time-stretch (`ffmpeg atempo` rápido / `rubberband -3` HQ + pitch)
  - markers via `aubio beat`, helpers de match (`pitchClassShift`,
    `noteMatchShift`, `tempoMatchSpeed`) — validados 10/10 isoladamente
- **UI** (`src/js/main/main.tsx`): seleção, análise, **barra de tom** (nota
  alvo C–B), time-stretch, **casar com referência** (definir ref/alvo → igualar
  tom / BPM / tom+BPM), badges de confiança, banners de binário ausente.
- Build limpo (tsc + vite), extensão symlinkada no CEP, `PlayerDebugMode` on,
  Premiere Pro 2026.

---

## 🔧 Próximo: substituição exata na timeline (BUG)

Hoje o reimport tem dois problemas:

1. Processa `getMediaPath()` = **arquivo de mídia inteiro**, não o trecho
   `in/out` que o clipe usa na timeline → o áudio processado não corresponde ao
   que está cortado.
2. Joga na **track A1 fixa** batendo só o `start`, ignorando track e duração
   reais.

**Plano:**
- [ ] Estender `getSelectedClipInfo` para retornar `inPoint`, `outPoint`,
      `durationSeconds`, `trackIndex` (índice da audio track), `nodeId`.
- [ ] DSP: aceitar uma **região** (`-ss inPoint -t (out-in)` no ffmpeg) e
      processar só o trecho usado, em `decodeToWav` / `analyzeClip` / `timeStretch`.
      - Analisar a região (não a mídia inteira) deixa BPM/nota mais precisos.
- [ ] Nova função JSX `replaceClip(path, startSeconds, trackIndex)` (ou estender
      `importAndInsert`) que sobrescreve na **track e start corretos**.
      - Tom (tempo=1): cai milimetricamente em cima (mesmo comprimento).
      - BPM (tempo muda): comprimento muda por definição; entra no start/track certos.
- [ ] **Decisão pendente** — onde colocar o resultado:
      - (A) **Substituir no lugar** (mesma track, mesmo start; original some), ou
      - (B) **Track nova acima** (mantém o original p/ comparar A-B).

---

## 📦 Distribuição: binários no ZXP (Mac + Windows)

**Achado importante (otool/file nos binários do brew):**
- `ffmpeg` → linka **18 dylibs** do `/opt/homebrew/Cellar/...`
- `rubberband` → linka `libsamplerate` + `libsndfile` do homebrew
- `aubio` → na real é um **script Python** (`python3.14`), não um binário

➡️ **Não dá pra copiar os binários do brew pro ZXP** — dependem de libs que não
existem na máquina do usuário, e o aubio nem é binário.

**Conceito:** ZXP = zip assinado da pasta da extensão. Não se "compila" nada;
inclui-se binários **pré-compilados** em `bin/{mac,win}/` (o resolver já os acha
primeiro). Windows roda do mesmo código (child_process é cross-platform, resolver
troca pra `bin/win` + `.exe`) — só precisa dos binários de Windows.

**Pegadinhas macOS:** bit de execução (`chmod +x`, o zip perde) e Gatekeeper
(binário não-assinado bloqueado → assinar/notarizar ou `xattr -d` em runtime).

### Opções (DECISÃO PENDENTE)

- [ ] **(A) WASM/JS puro (sem binário)** — `aubiojs` (WASM) + SoundTouchJS /
      rubberband-wasm + decode via Web Audio nativo do Chromium do CEP.
      Zero bundling, idêntico Mac+Windows, tudo no ZXP, sem assinar nada.
      Qualidade do stretch HQ um pouco abaixo do Rubber Band R3 nativo.
      **(recomendado p/ distribuição)**
- [ ] **(B) Híbrido** — análise em `aubiojs` (mata o problema do Python) +
      bundlar só `ffmpeg` e `rubberband` estáticos. Mantém R3 nativo.
- [ ] **(C) Bundlar tudo nativo** — builds estáticos de ffmpeg + rubberband +
      aubio (C tools) em `bin/{mac,win}`. Melhor qualidade, mais setup
      (sourcing 3×2, chmod runtime, notarização Mac; aubio estático é o chato).
- [ ] **(D) Auto-download no 1º uso** — ZXP leve; baixa o nativo certo por OS no
      primeiro run (precisa hosting + rede).

### Tarefas de empacotamento (qualquer opção nativa)
- [ ] `cep.config.ts`: `copyZipAssets`/`copyAssets` incluindo `bin/`.
- [ ] Runtime: `fs.chmodSync(0o755)` nos binários no primeiro uso (Mac/Linux).
- [ ] macOS: tratar quarantine (notarizar ou `xattr -dr com.apple.quarantine`).
- [ ] Script `fetch-binaries` p/ baixar os builds estáticos certos por OS.
- [ ] Assinatura do ZXP (`npm run zxp`) — preencher `cep.config.ts > zxp`
      (cert/org) no lugar do placeholder.

---

## 🎚️ Matching de tom — comportamento

- "Melhor harmonização" implementado como **uníssono pelo menor deslocamento**
  (mesma classe de nota, no máx ±6 semitons, sem saltar oitava).
- [ ] (opcional) Modo "intervalo consonante" (3ª/5ª) ou "encaixar em escala".

---

## 💡 Backlog / ideias

- [ ] Análise em lote (vários clipes).
- [ ] Detecção de tom polifônico (acordes) — fora do escopo do aubio mono.
- [ ] Preview/waveform no painel.
- [ ] Persistir ref/alvo entre sessões.
- [ ] Inicializar git history + CI (build no push).

---

## Dev quickstart

```bash
npm install
npm run dev      # HMR em :3000 (painel carrega dentro do Premiere)
npm run build    # build de produção (carrega standalone, já symlinkado no CEP)
```

Pré-requisitos locais (dev, macOS): `brew install ffmpeg aubio rubberband`.
Painel: **Window ▸ Extensions ▸ Galeguei**.
