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

  // 1) bundled
  const root = getExtensionRoot();
  if (root) {
    try {
      dirs.push(path.join(root, "bin", isWin() ? "win" : "mac"));
    } catch (e) {}
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
  return isWin() ? [name + ".exe", name] : [name];
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

/** Availability snapshot for the UI. */
export const checkBinaries = (): BinStatus[] => {
  const names: BinName[] = ["ffmpeg", "ffprobe", "aubio", "rubberband"];
  return names.map((n) => {
    const p = getBinary(n);
    return { name: n, found: !!p, path: p || "" };
  });
};
