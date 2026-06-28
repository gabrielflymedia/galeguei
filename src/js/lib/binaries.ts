// ===========================================================================
// Binary resolver — finds ffmpeg / ffprobe / aubio / rubberband.
//
// Resolution order (first hit wins):
//   1. bundled binaries shipped with the extension  (bin/{mac,win}/)
//   2. well-known install dirs (Homebrew, /usr/local, etc.)
//   3. every dir on the user's PATH
//
// Never rely on the PATH alone — CEP panels often launch without the user's
// shell environment, so absolute paths are resolved up-front.
// ===========================================================================

import { fs, os, path } from "./cep/node";

export type BinName = "ffmpeg" | "ffprobe" | "aubio" | "rubberband";

export type BinStatus = {
  name: BinName;
  found: boolean;
  path: string;
};

const isWin = (): boolean => {
  try {
    return os.platform() === "win32";
  } catch (e) {
    return false;
  }
};

const fileExists = (p: string): boolean => {
  try {
    return fs.existsSync(p);
  } catch (e) {
    return false;
  }
};

const getExtensionRoot = (): string => {
  try {
    // @ts-ignore — provided by the CEP node bridge
    return (window.cep_node && window.cep_node.global.__dirname) || "";
  } catch (e) {
    return "";
  }
};

const candidateDirs = (): string[] => {
  const dirs: string[] = [];

  // 1) bundled. __dirname is the panel folder (e.g. dist/cep/main), but the
  // bundled bin/ is copied to dist/cep/bin — so also check one/two levels up.
  const root = getExtensionRoot();
  if (root) {
    const plat = isWin() ? "win" : "mac";
    [
      [root, "bin", plat],
      [root, "..", "bin", plat],
      [root, "..", "..", "bin", plat],
    ].forEach((parts) => {
      try {
        dirs.push(path.join.apply(path, parts as [string, ...string[]]));
      } catch (e) {}
    });
  }

  // 2) common install locations
  if (isWin()) {
    dirs.push(
      "C:\\Program Files\\ffmpeg\\bin",
      "C:\\ffmpeg\\bin",
      "C:\\Program Files\\aubio\\bin"
    );
  } else {
    dirs.push("/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin", "/opt/local/bin");
  }

  // 3) PATH
  try {
    // @ts-ignore — process is available in the CEP node context
    const envPath: string = (typeof process !== "undefined" && process.env && process.env.PATH) || "";
    const sep = isWin() ? ";" : ":";
    envPath.split(sep).forEach((d) => {
      if (d && dirs.indexOf(d) === -1) dirs.push(d);
    });
  } catch (e) {}

  return dirs;
};

const fileNames = (name: BinName): string[] => {
  if (isWin()) {
    // Windows aubio ships as separate tools (aubiopitch.exe, aubiotrack.exe…)
    // with no unified `aubio` binary — use aubiotrack as the stand-in so the
    // availability check reflects reality. See getAubio() for invocation.
    if (name === "aubio") return ["aubiotrack.exe", "aubiopitch.exe"];
    return [name + ".exe", name];
  }
  return [name];
};

export const resolveBinary = (name: BinName): string | null => {
  const dirs = candidateDirs();
  const names = fileNames(name);
  for (let i = 0; i < dirs.length; i++) {
    for (let j = 0; j < names.length; j++) {
      try {
        const full = path.join(dirs[i], names[j]);
        if (fileExists(full)) return full;
      } catch (e) {}
    }
  }
  return null;
};

const cache: { [key: string]: string | null } = {};

/** Cached binary path lookup. Returns the absolute path or null. */
export const getBinary = (name: BinName): string | null => {
  if (Object.prototype.hasOwnProperty.call(cache, name)) return cache[name];
  const resolved = resolveBinary(name);
  cache[name] = resolved;
  return resolved;
};

/** Forget cached lookups (e.g. after the user installs a missing binary). */
export const clearBinaryCache = (): void => {
  for (const k in cache) delete cache[k];
};

// ---------------------------------------------------------------------------
// aubio — platform-aware subcommand resolution
//
// On macOS/Linux aubio exposes a single `aubio <sub>` CLI. The official
// Windows build instead ships one executable per tool and has no `aubio` nor
// `aubiotempo` — so `tempo` reuses `aubiotrack` and callers derive BPM from
// the beat times it prints.
// ---------------------------------------------------------------------------

export type AubioSub = "beat" | "tempo" | "pitch" | "onset" | "notes";

const AUBIO_WIN: { [k in AubioSub]: string } = {
  beat: "aubiotrack",
  tempo: "aubiotrack",
  pitch: "aubiopitch",
  onset: "aubioonset",
  notes: "aubionotes",
};

/**
 * Resolve how to invoke an aubio subcommand on this platform.
 * Returns the executable path plus any leading args (the subcommand on Unix,
 * nothing on Windows), or null if the executable can't be located.
 */
export const getAubio = (
  sub: AubioSub
): { cmd: string; pre: string[] } | null => {
  if (isWin()) {
    const base = AUBIO_WIN[sub];
    const dirs = candidateDirs();
    for (let i = 0; i < dirs.length; i++) {
      try {
        const full = path.join(dirs[i], base + ".exe");
        if (fileExists(full)) return { cmd: full, pre: [] };
      } catch (e) {}
    }
    return null;
  }
  const p = getBinary("aubio");
  return p ? { cmd: p, pre: [sub] } : null;
};

/** Availability snapshot for the UI. */
export const checkBinaries = (): BinStatus[] => {
  const names: BinName[] = ["ffmpeg", "ffprobe", "aubio", "rubberband"];
  return names.map((n) => {
    const p = getBinary(n);
    return { name: n, found: !!p, path: p || "" };
  });
};
