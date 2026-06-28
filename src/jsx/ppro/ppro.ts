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
  /** Source in/out points (seconds into the media file) the clip actually uses. */
  inSeconds: number;
  outSeconds: number;
  /** Length of the used region (outSeconds - inSeconds). 0 = whole file. */
  durationSeconds: number;
  /** Audio track index of the selected clip (-1 = unknown / project panel). */
  trackIndex: number;
  nodeId: string;
  mediaType: string;
  error: string;
};

/** True if two track items refer to the same clip (start/end/name match). */
const sameTrackItem = (a: TrackItem, b: TrackItem): boolean => {
  try {
    return (
      a.start.ticks === b.start.ticks &&
      a.end.ticks === b.end.ticks &&
      a.name === b.name
    );
  } catch (e) {
    return false;
  }
};

/** Index of the audio track holding `clip`, or -1 if not found. */
const audioTrackIndexOf = (seq: Sequence, clip: TrackItem): number => {
  try {
    for (var t = 0; t < seq.audioTracks.numTracks; t++) {
      const track = seq.audioTracks[t];
      for (var c = 0; c < track.clips.numItems; c++) {
        if (sameTrackItem(track.clips[c], clip)) return t;
      }
    }
  } catch (e) {}
  return -1;
};

/**
 * The currently-selected timeline clip, preferring an audio clip in a linked
 * A/V selection (this is an audio tool). Returns null if nothing usable.
 */
const pickSelectedClip = (seq: Sequence): TrackItem | null => {
  try {
    const selection = seq.getSelection();
    if (selection && selection.length > 0) {
      var chosen: TrackItem | null = null;
      for (var i = 0; i < selection.length; i++) {
        const c = selection[i];
        if (c && c.projectItem && c.projectItem.getMediaPath()) {
          if (c.mediaType === "Audio") return c;
          if (!chosen) chosen = c; // fallback to first usable clip
        }
      }
      return chosen;
    }
  } catch (e) {}
  return null;
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
    inSeconds: 0,
    outSeconds: 0,
    durationSeconds: 0,
    trackIndex: -1,
    nodeId: "",
    mediaType: "",
    error: "",
  };

  if (!app.project) {
    empty.error = "No project open.";
    return empty;
  }

  // 1) Timeline selection. Prefer an audio clip (this is an audio tool); a
  // linked A/V selection exposes both, and we want the audio one.
  const seq = getActiveSequence();
  if (seq) {
    try {
      {
        const chosen = pickSelectedClip(seq);
        if (chosen) {
          const path = chosen.projectItem.getMediaPath();
          var inS = 0;
          var outS = 0;
          try {
            inS = chosen.inPoint ? chosen.inPoint.seconds : 0;
            outS = chosen.outPoint ? chosen.outPoint.seconds : 0;
          } catch (e) {}
          const dur = outS > inS ? outS - inS : 0;
          var nodeId = "";
          try {
            nodeId = chosen.projectItem.nodeId || "";
          } catch (e) {}
          return {
            found: true,
            source: "timeline",
            name: chosen.name,
            path: path,
            startSeconds: chosen.start ? chosen.start.seconds : 0,
            inSeconds: inS,
            outSeconds: outS,
            durationSeconds: dur,
            trackIndex: audioTrackIndexOf(seq, chosen),
            nodeId: nodeId,
            mediaType: chosen.mediaType,
            error: "",
          };
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
              var pNodeId = "";
              try {
                pNodeId = item.nodeId || "";
              } catch (e) {}
              return {
                found: true,
                source: "project",
                name: item.name,
                path: p,
                startSeconds: 0,
                inSeconds: 0,
                outSeconds: 0,
                durationSeconds: 0,
                trackIndex: -1,
                nodeId: pNodeId,
                mediaType: "",
                error: "",
              };
            }
          }
        }
      }
    }
  } catch (e) {}

  empty.error = "No audio clip selected.";
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

/**
 * Drop one CLIP marker per timestamp onto the selected clip's media item.
 * Markers live on the clip (projectItem.getMarkers()), so timestamps are in
 * SOURCE time — offset by the clip's inPoint so they land on the used region.
 */
export const createBeatMarkers = (
  timestamps: number[],
  label: string
): MarkersResult => {
  const seq = getActiveSequence();
  if (!seq) return { created: 0, error: "No active sequence." };

  const clip = pickSelectedClip(seq);
  if (!clip || !clip.projectItem) {
    return { created: 0, error: "No clip selected for markers." };
  }

  // Clip markers live on the media item (the source), not the sequence ruler.
  var markers: any = null;
  try {
    markers = clip.projectItem.getMarkers();
  } catch (e) {}
  if (!markers || typeof markers.createMarker !== "function") {
    return { created: 0, error: "Markers unavailable on this clip." };
  }

  // Source-relative base: beats were measured from the clip's inPoint.
  var base = 0;
  try {
    base = clip.inPoint ? clip.inPoint.seconds : 0;
  } catch (e) {}

  const name = label && label.length > 0 ? label : "Beat";
  var created = 0;
  var lastErr = "";
  for (var i = 0; i < timestamps.length; i++) {
    try {
      markers.createMarker(base + timestamps[i], name, 0, "");
      created++;
    } catch (e: any) {
      lastErr = e && e.message ? e.message : String(e);
    }
  }
  return {
    created: created,
    error: created > 0 ? "" : lastErr || "Failed to create markers.",
  };
};

export type ImportResult = {
  success: boolean;
  name: string;
  inserted: boolean;
  error: string;
};

/**
 * Re-imports a processed file into the Project panel and (optionally) overwrites
 * it onto the timeline at `atSeconds` on audio track `trackIndex`. When
 * `trackIndex` is negative (e.g. project-panel source) it defaults to track 0.
 */
export const importAndInsert = (
  path: string,
  atSeconds: number,
  insert: boolean,
  trackIndex: number
): ImportResult => {
  if (!app.project) {
    return { success: false, name: "", inserted: false, error: "No project open." };
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
    return { success: false, name: "", inserted: false, error: "Failed to import the file." };
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
        var idx =
          typeof trackIndex === "number" && trackIndex >= 0 ? trackIndex : 0;
        if (idx >= seq.audioTracks.numTracks) idx = 0;
        const track = seq.audioTracks[idx];
        if (track) {
          const time = secondsToTime(typeof atSeconds === "number" ? atSeconds : 0);
          inserted = track.overwriteClip(imported, time);
        }
      } catch (e) {}
    }
  }

  return { success: true, name: imported.name, inserted: inserted, error: "" };
};
