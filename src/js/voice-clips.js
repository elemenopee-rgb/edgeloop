// Recorded audio clips for cues. The wearer picks one local library folder;
// each subfolder named after a cue id (edge/, encourage/, forceOrgasm/ ...)
// holds that cue's clips and one is chosen at random when the cue fires.
// Files stay in the browser: they are never uploaded, and the handles are
// gone after a reload, so the folder has to be picked again.

export const AUDIO_EXTENSIONS = ['mp3', 'wav', 'ogg', 'oga', 'm4a', 'aac', 'flac', 'webm', 'opus'];

export function isAudioFile(file) {
    if (!file) return false;
    if (typeof file.type === 'string' && file.type.startsWith('audio/')) return true;
    const m = /\.([a-z0-9]+)$/i.exec(file.name || '');
    return Boolean(m && AUDIO_EXTENSIONS.includes(m[1].toLowerCase()));
}

// Map cue id -> audio files, from a folder picked with webkitdirectory.
// The cue folder is the directory directly above the file inside the picked
// library (library/edge/clip.mp3), matched case-insensitively. If the
// wearer picks a cue folder itself (edge/clip.mp3) that works too.
export function groupClipsByCue(files, cueIds) {
    const byLower = new Map(cueIds.map((id) => [id.toLowerCase(), id]));
    const groups = {};
    for (const file of Array.from(files || [])) {
        if (!isAudioFile(file)) continue;
        const parts = String(file.webkitRelativePath || '').split('/').filter(Boolean);
        if (parts.length < 2) continue;
        const id = byLower.get(parts[parts.length - 2].toLowerCase());
        if (!id) continue;
        (groups[id] ||= []).push(file);
    }
    return groups;
}

// Random clip, avoiding an immediate repeat when there is a choice.
export function pickClip(clips, last = null, rand = Math.random) {
    if (!Array.isArray(clips) || clips.length === 0) return null;
    const pool = clips.length > 1 ? clips.filter((c) => c !== last) : clips;
    return pool[Math.min(pool.length - 1, Math.floor(rand() * pool.length))];
}

let library = {};
let lastByCue = {};
let current = null;
let currentUrl = '';
let queuedPlay = null;

export function setClipLibrary(groups) {
    stopClip();
    library = groups || {};
    lastByCue = {};
}

export function clipCounts() {
    const out = {};
    for (const [id, list] of Object.entries(library)) out[id] = list.length;
    return out;
}

export function hasClips(cueId) {
    return Boolean(library[cueId] && library[cueId].length);
}

export function isClipPlaying() {
    return Boolean(current && !current.paused && !current.ended);
}

function release() {
    if (currentUrl) URL.revokeObjectURL(currentUrl);
    currentUrl = '';
    current = null;
}

export function stopClip() {
    queuedPlay = null;
    if (current) {
        try {
            current.pause();
        } catch (e) { /* already stopped */ }
    }
    release();
}

function start(file) {
    const url = URL.createObjectURL(file);
    const audio = new Audio(url);
    current = audio;
    currentUrl = url;
    const done = () => {
        if (current !== audio) return;
        release();
        if (queuedPlay) {
            const next = queuedPlay;
            queuedPlay = null;
            start(next);
        }
    };
    audio.onended = done;
    audio.onerror = done;
    audio.play().catch(done);
}

// Play a random clip for the cue. Returns false when the cue has no clips
// (the caller then falls back to speech). `urgent` cuts whatever is playing;
// otherwise one cue may wait and a newer one replaces it.
export function playCueClip(cueId, { urgent = false } = {}) {
    const clips = library[cueId];
    if (!clips || !clips.length) return false;
    const file = pickClip(clips, lastByCue[cueId]);
    lastByCue[cueId] = file;
    if (isClipPlaying() && !urgent) {
        queuedPlay = file;
        return true;
    }
    stopClip();
    start(file);
    return true;
}
