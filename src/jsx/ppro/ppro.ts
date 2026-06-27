import {
  helloVoid,
  helloError,
  helloStr,
  helloNum,
  helloArrayStr,
  helloObj,
} from "../utils/samples";
export { helloError, helloStr, helloNum, helloArrayStr, helloObj, helloVoid };
import { secondsToTime, findItemByPath } from "./ppro-utils";

export const qeDomFunction = () => {
  if (typeof qe === "undefined") {
    app.enableQE();
  }
  if (qe) {
    qe.name;
    qe.project.getVideoEffectByName("test");
  }
};

export const helloWorld = () => {
  alert("Hello from Premiere Pro.");
};

// ===========================================================================
// Fly Audio Toolkit — ExtendScript bridge
// The JSX side ONLY touches the timeline/project. All DSP happens in Node.
// ===========================================================================

/** Bridge sanity-check used by the panel on load ("hello world"). */
export const ping = (): string => {
  var projName = "";
  try {
    projName = app.project ? app.project.name : "";
  } catch (e) {}
  return "pong:" + projName;
};

const getActiveSequence = (): Sequence | null => {
  try {
    if (app.project && app.project.activeSequence) {
      return app.project.activeSequence;
    }
  } catch (e) {}
  return null;
};

export type SelectedClipInfo = {
  found: boolean;
  source: "timeline" | "project" | "none";
  name: string;
  path: string;
  startSeconds: number;
  mediaType: string;
  error: string;
};

/**
 * Resolves the media path of the currently-selected clip.
 * Priority: timeline selection first, then the Project panel selection.
 */
export const getSelectedClipInfo = (): SelectedClipInfo => {
  const empty: SelectedClipInfo = {
    found: false,
    source: "none",
    name: "",
    path: "",
    startSeconds: 0,
    mediaType: "",
    error: "",
  };

  if (!app.project) {
    empty.error = "Nenhum projeto aberto.";
    return empty;
  }

  // 1) Timeline selection
  const seq = getActiveSequence();
  if (seq) {
    try {
      const selection = seq.getSelection();
      if (selection && selection.length > 0) {
        for (var i = 0; i < selection.length; i++) {
          const clip = selection[i];
          if (clip && clip.projectItem) {
            const path = clip.projectItem.getMediaPath();
            if (path && path.length > 0) {
              return {
                found: true,
                source: "timeline",
                name: clip.name,
                path: path,
                startSeconds: clip.start ? clip.start.seconds : 0,
                mediaType: clip.mediaType,
                error: "",
              };
            }
          }
        }
      }
    } catch (e) {}
  }

  // 2) Project panel selection
  try {
    if (typeof app.getProjectViewIDs === "function") {
      const viewIDs = app.getProjectViewIDs();
      for (var v = 0; v < viewIDs.length; v++) {
        const sel = app.getProjectViewSelection(viewIDs[v]);
        if (sel && sel.length > 0) {
          for (var j = 0; j < sel.length; j++) {
            const item = sel[j];
            const p = item.getMediaPath ? item.getMediaPath() : "";
            if (p && p.length > 0) {
              return {
                found: true,
                source: "project",
                name: item.name,
                path: p,
                startSeconds: 0,
                mediaType: "",
                error: "",
              };
            }
          }
        }
      }
    }
  } catch (e) {}

  empty.error = "Nenhum clipe de áudio selecionado.";
  return empty;
};

/** Convenience helper: just the path (or "" if nothing selected). */
export const getSelectedClipPath = (): string => {
  return getSelectedClipInfo().path;
};

export type SequenceInfo = {
  found: boolean;
  name: string;
  fps: number;
  playheadSeconds: number;
};

export const getCurrentSequenceInfo = (): SequenceInfo => {
  const seq = getActiveSequence();
  if (!seq) {
    return { found: false, name: "", fps: 0, playheadSeconds: 0 };
  }
  var fps = 0;
  var playhead = 0;
  try {
    const settings = seq.getSettings();
    if (settings && settings.videoFrameRate) {
      fps = Math.round((1 / settings.videoFrameRate.seconds) * 1000) / 1000;
    }
  } catch (e) {}
  try {
    const pos = seq.getPlayerPosition();
    if (pos) playhead = pos.seconds;
  } catch (e) {}
  return { found: true, name: seq.name, fps: fps, playheadSeconds: playhead };
};

export type MarkersResult = { created: number; error: string };

/** Drop one sequence marker per timestamp (seconds, from clip start). */
export const createBeatMarkers = (
  timestamps: number[],
  offsetSeconds: number,
  label: string
): MarkersResult => {
  const seq = getActiveSequence();
  if (!seq) return { created: 0, error: "Nenhuma sequência ativa." };
  var markers;
  try {
    markers = seq.getMarkers();
  } catch (e) {
    return { created: 0, error: "Markers indisponíveis nesta sequência." };
  }
  if (!markers) return { created: 0, error: "Markers indisponíveis." };

  const base = typeof offsetSeconds === "number" ? offsetSeconds : 0;
  const name = label && label.length > 0 ? label : "Beat";
  var created = 0;
  for (var i = 0; i < timestamps.length; i++) {
    try {
      markers.createMarker(base + timestamps[i], name, 0, "");
      created++;
    } catch (e) {}
  }
  return { created: created, error: created > 0 ? "" : "Falha ao criar markers." };
};

export type ImportResult = {
  success: boolean;
  name: string;
  inserted: boolean;
  error: string;
};

/**
 * Re-imports a processed file into the Project panel and (optionally) drops it
 * onto the active sequence's first audio track at `atSeconds`.
 */
export const importAndInsert = (
  path: string,
  atSeconds: number,
  insert: boolean
): ImportResult => {
  if (!app.project) {
    return { success: false, name: "", inserted: false, error: "Nenhum projeto aberto." };
  }

  var bin;
  try {
    bin = app.project.getInsertionBin();
  } catch (e) {
    bin = app.project.rootItem;
  }
  if (!bin) bin = app.project.rootItem;

  const ok = app.project.importFiles([path], true, bin, false);
  if (!ok) {
    return { success: false, name: "", inserted: false, error: "Falha ao importar o arquivo." };
  }

  // Locate the freshly-imported item by its media path.
  var imported = findItemByPath(bin, path);
  if (!imported) imported = findItemByPath(app.project.rootItem, path);

  if (!imported) {
    return { success: true, name: "", inserted: false, error: "" };
  }

  var inserted = false;
  if (insert) {
    const seq = getActiveSequence();
    if (seq) {
      try {
        const track = seq.audioTracks[0];
        if (track) {
          const time = secondsToTime(typeof atSeconds === "number" ? atSeconds : 0);
          inserted = track.overwriteClip(imported, time);
        }
      } catch (e) {}
    }
  }

  return { success: true, name: imported.name, inserted: inserted, error: "" };
};
