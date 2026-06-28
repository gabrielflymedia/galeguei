# Roadmap — Beat Match

Painel CEP (bolt-cep) para Premiere Pro: análise de BPM/tom, time-stretch com
preservação de pitch e matching tom/BPM entre clipes.

---

## Estado atual

Funciona **local no Windows** (`npm run dev`): análise de BPM/tom (com selo de
confiança), card **Transform** unificado (tempo + pitch numa passada de Rubber
Band, substituindo o clipe no lugar, na track certa, só na região in/out),
**casar com referência** (Key/BPM/Both), **clip markers** na mídia, UI verde com
ícones lucide + **manual bilíngue** (EN/PT) e toasts.

Binários: `aubio`/`rubberband` de Windows **bundled** em `src/bin/win/`;
`ffmpeg`/`ffprobe` vêm do PATH. O resolver acha `bin/{win,mac}` primeiro.

> Pendência conhecida: clipes com **velocidade alterada** (speed ≠ 100%) — aí
> `out − in` ≠ duração na timeline; fora do escopo atual.

---

## 🎯 Próximo grande passo: distribuição (ZXP)

ZXP = zip **assinado** da pasta da extensão. É **possível** — a arquitetura já é
amigável (resolver prioriza `bin/` bundled, `copyAssets:["bin"]` inclui no build,
e um ZXP assinado **dispensa o PlayerDebugMode**). O que falta é empacotamento,
não arquitetura.

### O que falta hoje
- [ ] **ffmpeg/ffprobe não estão bundled** — hoje dependem do PATH. Num ZXP na
      máquina do usuário não existem → bundlar em `bin/win` (e `bin/mac`).
- [ ] **Só existe `bin/win`** — falta `bin/mac` (builds estáticos).
- [ ] **Certificado placeholder** em `cep.config.ts > zxp` (`org: "Company"`,
      `password: "password"`) → cert real (self-signed serve p/ instalar via
      aescripts ZXP installer).

### Gargalos de verdade (ordem de dor)
- [ ] **Licença (o mais sério).** `rubberband` e `aubio` são **GPL**; ffmpeg é
      LGPL/GPL. Distribuir embutido num plugin **fechado** dispara obrigações de
      GPL. Pra produto comercial fechado: licença comercial do Rubber Band
      (Breakfast Quay), trocar aubio por algo permissivo e usar build **LGPL** do
      ffmpeg — **ou** assumir o plugin como GPL/open.
- [ ] **macOS chato:** o zip perde o **bit de execução** (`chmod 755` em runtime)
      e o **Gatekeeper/quarantine** bloqueia binário não-assinado (notarizar ou
      `xattr -dr com.apple.quarantine`). E precisa de **builds estáticos** (no
      brew, ffmpeg/rubberband linkam dylibs e o aubio é script Python).
- [ ] **Tamanho:** ffmpeg estático é gordo (~50–90 MB) × 2 plataformas.

### Caminhos possíveis
| Caminho | Esforço | Observação |
|---|---|---|
| **ZXP só Windows** | baixo | bundlar ffmpeg/ffprobe em `bin/win`, cert real, `npm run zxp`. Atende o uso interno (Windows). |
| **ZXP nativo cross-platform** | médio-alto | + builds estáticos Mac, chmod runtime, notarização/quarantine, nó da licença GPL. |
| **Rewrite em WASM** (aubiojs + soundtouch/rubberband-wasm + decode via Web Audio) | médio | **zero binário**, idêntico Mac+Win, tudo no ZXP, sem assinar/chmod/quarantine, licença mais leve. Stretch um tico abaixo do R3 nativo. **Recomendado p/ distribuição pública.** |

### Tarefas de empacotamento (caminho nativo)
- [ ] Bundlar `ffmpeg`/`ffprobe` em `bin/win` (+ `bin/mac` estáticos).
- [ ] Runtime: `fs.chmodSync(0o755)` nos binários no 1º uso (Mac/Linux).
- [ ] macOS: tratar quarantine (notarizar ou `xattr -dr`).
- [ ] Cert real em `cep.config.ts > zxp`; `npm run zxp` → `dist/zxp`.
- [ ] (opcional) Script `fetch-binaries` p/ baixar builds por OS e enxugar o repo.

### Tarefas (caminho WASM)
- [ ] Reescrever a camada DSP (`audio.ts`): `aubiojs` (BPM/tom/onset) +
      `rubberband-wasm`/SoundTouchJS (stretch+pitch) + decode via Web Audio do
      Chromium do CEP. UI e ExtendScript ficam praticamente iguais.

---

## 🎚️ Matching de tom — comportamento

- "Melhor harmonização" = **uníssono pelo menor deslocamento** (mesma classe de
  nota, no máx ±6 semitons, sem saltar oitava).
- [ ] (opcional) Modo "intervalo consonante" (3ª/5ª) ou "encaixar em escala".

---

## 💡 Backlog / ideias

- [ ] Suporte a clipes com velocidade alterada (speed ≠ 100%).
- [ ] Toggle de markers **clipe ↔ sequência**.
- [ ] Análise em lote (vários clipes).
- [ ] Detecção de tom polifônico (acordes) — fora do escopo do aubio mono.
- [ ] Preview/waveform no painel.
- [ ] Persistir ref/alvo entre sessões.
- [ ] CI (build no push).

---

## Dev quickstart

```bash
npm install
npm run dev      # HMR em :3333 (painel carrega dentro do Premiere)
npm run build    # build de produção (já symlinkado no CEP)
```

Pré-requisitos de binários:
- **Windows**: `aubio`/`rubberband` já vêm bundled em `src/bin/win/`;
  `ffmpeg`/`ffprobe` precisam estar no PATH (ex.: `winget install ffmpeg`). O
  aubio no Windows não tem comando unificado — `binaries.ts` mapeia pros exes
  (`aubiotrack`/`aubiopitch`/`aubioonset`) e o BPM é derivado das batidas.
- **macOS** (dev): `brew install ffmpeg aubio rubberband`.

Painel: **Window ▸ Extensions ▸ Beat Match**.
