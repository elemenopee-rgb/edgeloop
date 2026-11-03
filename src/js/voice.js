import { VOICE_CUE_CATALOG } from './voice-cues.js';

// Audio cues are local to this browser tab. Selecting a folder makes temporary
// object URLs; no audio is uploaded or copied into browser storage.
const audioByCue = new Map();
const audioQueue = [];
let activeAudio = null;
let activeToken = 0;
let activeUrl = '';
let micSpeakingUntil = 0;

function stopCurrentAudio() {
    activeToken += 1;
    if (activeAudio) {
        activeAudio.onended = null;
        activeAudio.onerror = null;
        activeAudio.pause();
        activeAudio.currentTime = 0;
        activeAudio = null;
    }
    activeUrl = '';
}

function playUrl(url, token) {
    if (!url || token !== activeToken) return;
    const audio = new Audio(url);
    activeAudio = audio;
    activeUrl = url;
    const done = () => {
        if (token !== activeToken) return;
        activeAudio = null;
        activeUrl = '';
        micSpeakingUntil = Date.now() + MIC_SPEECH_TAIL_MS;
        playNext();
    };
    audio.onended = done;
    audio.onerror = done;
    audio.play().catch(done);
}

function playNext() {
    if (activeAudio || audioQueue.length === 0) return;
    const next = audioQueue.shift();
    playUrl(next.url, activeToken);
}

function queueCue(cueId, urgent = false) {
    const variants = audioByCue.get(cueId);
    if (!variants?.length) return false;
    const variant = variants[Math.floor(Math.random() * variants.length)];
    if (urgent) {
        audioQueue.length = 0;
        stopCurrentAudio();
        const token = activeToken;
        playUrl(variant.url, token);
        return true;
    }
    if (audioQueue.some((item) => item.cueId === cueId) || activeAudio && activeAudio.dataset?.cueId === cueId) return true;
    audioQueue.push({ cueId, url: variant.url });
    playNext();
    return true;
}

function cueIdForPrompt(text) {
    const prompt = String(text || '').replace(/^\s*"|"\s*$/g, '').trim();
    if (!prompt) return '';
    // The app renders the current phrase lists into its hidden Session Setup
    // editor at boot. Matching those lines lets customised phrases and tokens
    // resolve to the right cue without changing the session/event logic.
    for (const field of document.querySelectorAll('[data-voice-cue]')) {
        const id = field.getAttribute('data-voice-cue');
        for (const raw of String(field.value || '').split(/\r?\n/)) {
            const template = raw.trim();
            if (!template) continue;
            const escaped = template.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
                .replace(/\\\{(?:hr|maxHr|minHr|edges|minutes|done|need|hold)\\\}/g, '\\d+');
            if (new RegExp(`^${escaped}$`, 'i').test(prompt)) return id;
        }
    }
    // The factory phrases remain available even before Session Setup is opened.
    for (const cue of VOICE_CUE_CATALOG) {
        for (const template of cue.lines || []) {
            const escaped = String(template).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
                .replace(/\\\{(?:hr|maxHr|minHr|edges|minutes|done|need|hold)\\\}/g, '\\d+');
            if (new RegExp(`^${escaped}$`, 'i').test(prompt)) return cue.id;
        }
    }
    return '';
}

function releaseAllAudio() {
    stopCurrentAudio();
    audioQueue.length = 0;
    for (const variants of audioByCue.values()) {
        for (const item of variants) URL.revokeObjectURL(item.url);
    }
    audioByCue.clear();
}

function relativeName(file) {
    return file.webkitRelativePath || file.name || '';
}

function cueForFile(file) {
    const parts = relativeName(file).split('/').filter(Boolean);
    const known = new Set(VOICE_CUE_CATALOG.map((cue) => cue.id));
    // Preferred layout: audio-folder/<cue-id>/<variation>.wav
    for (const part of parts.slice(0, -1)) if (known.has(part)) return part;
    // Also accept audio-folder/<cue-id>_2.wav (or -2 / __2).
    const stem = parts.at(-1)?.replace(/\.[^.]+$/, '') || '';
    return [...known].find((id) => new RegExp(`^${id}(?:[_-].*)?$`, 'i').test(stem)) || '';
}

function renderAudioCueStatus(root, message = '') {
    if (!root) return;
    const status = root.querySelector('#audioCueStatus');
    const list = root.querySelector('#audioCueList');
    if (status) status.textContent = message || `${audioByCue.size} of ${VOICE_CUE_CATALOG.length} cue folders have audio loaded. Select the folder again after reloading the page.`;
    if (!list) return;
    list.replaceChildren();
    for (const cue of VOICE_CUE_CATALOG) {
        const count = audioByCue.get(cue.id)?.length || 0;
        if (!count) continue;
        const row = document.createElement('div');
        row.className = 'flex items-center justify-between gap-2 text-[10px] text-slate-300';
        const label = document.createElement('span');
        label.textContent = `${cue.label} · ${count} variation${count === 1 ? '' : 's'}`;
        const preview = document.createElement('button');
        preview.type = 'button';
        preview.className = 'text-sky-300 hover:text-white';
        preview.textContent = 'Preview';
        preview.addEventListener('click', () => queueCue(cue.id, true));
        row.append(label, preview);
        list.appendChild(row);
    }
}

function installAudioCuePicker() {
    const section = document.getElementById('paramsAudioSection');
    if (!section || section.querySelector('#audioCueManager')) return;
    const panel = document.createElement('section');
    panel.id = 'audioCueManager';
    panel.className = 'mt-3 p-3 rounded-xl border border-sky-900 bg-slate-950 space-y-2';
    panel.innerHTML = `
      <div>
        <p class="text-[10px] font-bold uppercase tracking-wider text-sky-300">Local audio cues</p>
        <p class="text-[10px] text-slate-400 leading-snug mt-1">Choose a folder on your computer. Put variations in folders named for cue IDs (for example <code>edge/one.wav</code>, <code>edge/two.wav</code>). Audio stays on your device and is not uploaded. The folder must be selected again after a reload.</p>
      </div>
      <div class="flex flex-wrap gap-2">
        <button id="audioCueChoose" type="button" class="min-h-[2.75rem] px-3 rounded-lg bg-sky-700 hover:bg-sky-600 text-white text-xs font-bold">Choose audio folder</button>
        <button id="audioCueClear" type="button" class="min-h-[2.75rem] px-3 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold">Clear audio</button>
        <input id="audioCueFolderInput" type="file" accept="audio/*,.wav,.mp3,.ogg,.m4a,.aac,.flac,.webm" webkitdirectory directory multiple class="hidden">
      </div>
      <p id="audioCueStatus" role="status" aria-live="polite" class="text-[10px] text-slate-300"></p>
      <div id="audioCueList" class="space-y-1"></div>`;
    section.prepend(panel);
    const input = panel.querySelector('#audioCueFolderInput');
    panel.querySelector('#audioCueChoose')?.addEventListener('click', () => input?.click());
    panel.querySelector('#audioCueClear')?.addEventListener('click', () => {
        releaseAllAudio();
        renderAudioCueStatus(panel, 'Local audio cleared.');
    });
    input?.addEventListener('change', () => {
        releaseAllAudio();
        const rejected = [];
        for (const file of Array.from(input.files || [])) {
            if (!(file.type.startsWith('audio/') || /\.(wav|mp3|ogg|m4a|aac|flac|webm)$/i.test(file.name))) continue;
            const cueId = cueForFile(file);
            if (!cueId) { rejected.push(file.name); continue; }
            const variants = audioByCue.get(cueId) || [];
            variants.push({ name: file.name, url: URL.createObjectURL(file) });
            audioByCue.set(cueId, variants);
        }
        const summary = rejected.length
            ? `Loaded ${audioByCue.size} cue folders. Ignored ${rejected.length} file(s) without a matching cue folder/name.`
            : '';
        renderAudioCueStatus(panel, summary);
        input.value = '';
    });
    renderAudioCueStatus(panel);
}

if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', installAudioCuePicker, { once: true });
    else installAudioCuePicker();
}
if (typeof window !== 'undefined') window.addEventListener('pagehide', releaseAllAudio, { once: true });

// Existing app API: cue text is still painted on screen, but the voice output
// is now a matching local audio variation. No browser speech synthesis is used.
export function speakPrompt(enabled, text) {
    if (!enabled) return;
    const cueId = cueIdForPrompt(text);
    if (cueId) queueCue(cueId);
}

export function speakNow(text) {
    const cueId = cueIdForPrompt(text);
    if (cueId) queueCue(cueId, true);
    else cancelSpeech();
}

export function cancelSpeech() {
    stopCurrentAudio();
    audioQueue.length = 0;
}

export function listSpeechVoices() { return []; }

export function setMindgamePrompt(text, visible) {
    const box = document.getElementById('mindgameContainer');
    const el = document.getElementById('mindgamePromptText');
    if (el && text) el.textContent = `"${text}"`;
    if (box) box.classList.toggle('hidden', !visible);
}

// Optional microphone arousal monitor. Local cue playback holds the last
// microphone sample during the clip and its short tail, just as TTS did.
export const MIC_CAPTURE_CONSTRAINTS = Object.freeze({ echoCancellation: { ideal: true }, noiseSuppression: { ideal: false }, autoGainControl: { ideal: false }, channelCount: { ideal: 1 } });
export const MIC_PROCESSING_LABELS = Object.freeze({ noiseSuppression: 'noise suppression', autoGainControl: 'automatic gain control', echoCancellation: 'echo cancellation' });
export function describeMicProcessing(settings) {
    const s = settings && typeof settings === 'object' ? settings : {};
    const active = ['noiseSuppression', 'autoGainControl'].filter((key) => s[key] !== false);
    const unknown = active.filter((key) => s[key] === undefined);
    const names = active.map((key) => MIC_PROCESSING_LABELS[key]).join(' and ');
    const message = !active.length ? 'Browser audio processing is off. The meter shows real room loudness.'
        : unknown.length === active.length ? `This browser will not say whether ${names} are on, so assume they are: they flatten a build-up, and your gate is calibrated against a processed signal.`
            : `Your browser refused to switch off ${names}. It flattens a build-up, so calibrate the gate against what this meter actually shows.`;
    return { clean: active.length === 0, active, unknown, message };
}
export function clearMicBoost(state) {
    if (!state) return;
    state.micBoost = state.micBoostHeld = state.micApplied = state.micLastLevel = state.micSpeechAt = state.micHoldSince = 0;
}
export async function startMicMonitor(state, { onLost = null } = {}) {
    stopMicMonitor(state);
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('Microphone not supported in this browser');
    const AudioCtor = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtor) throw new Error('Web Audio not supported in this browser');
    const audioCtx = new AudioCtor();
    try { if (audioCtx.state !== 'running') await audioCtx.resume(); } catch {}
    let stream;
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: MIC_CAPTURE_CONSTRAINTS, video: false }); }
    catch (error) { audioCtx.close().catch(() => {}); throw error; }
    const source = audioCtx.createMediaStreamSource(stream);
    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = 1024;
    analyser.smoothingTimeConstant = 0.65;
    source.connect(analyser);
    Object.assign(state, { micStream: stream, micAudioCtx: audioCtx, micAnalyser: analyser, micProcessing: describeMicProcessing(stream.getAudioTracks?.()[0]?.getSettings?.()) });
    clearMicBoost(state);
    const track = stream.getAudioTracks?.()[0];
    if (track) {
        const lost = (message) => { stopMicMonitor(state); onLost?.(message); };
        track.onended = () => lost('The microphone stopped (revoked, unplugged or taken by another app).');
        track.onmute = () => lost('The microphone went silent (muted by the system or another app).');
    }
    try { if (audioCtx.state !== 'running') await audioCtx.resume(); } catch {}
}
export function stopMicMonitor(state) {
    clearMicBoost(state);
    if (state?.micAnimId) { cancelAnimationFrame(state.micAnimId); state.micAnimId = null; }
    if (state?.micStream) {
        state.micStream.getTracks().forEach((track) => { track.onended = null; track.onmute = null; track.stop(); });
        state.micStream = null;
    }
    if (state?.micAudioCtx) { try { state.micAudioCtx.close()?.catch?.(() => {}); } catch {} state.micAudioCtx = null; }
    if (state) { state.micAnalyser = null; state.micProcessing = null; }
}
export const MIC_VOICE_BAND_LO_HZ = 250;
export const MIC_VOICE_BAND_HI_HZ = 4000;
export const MIN_MIC_GATE = 8;
export const MAX_MIC_GATE = 90;
export const DEFAULT_MIC_GATE = 40;
export const MIN_MIC_BOOST_BPM = 0;
export const MAX_MIC_BOOST_BPM = 20;
export const DEFAULT_MIC_BOOST_BPM = 8;
export function clampMicGate(value, fallback = DEFAULT_MIC_GATE) {
    const n = typeof value === 'number' ? Math.round(value) : parseInt(String(value), 10);
    return Number.isFinite(n) ? Math.max(MIN_MIC_GATE, Math.min(MAX_MIC_GATE, n)) : fallback;
}
export function clampMicBoostBpm(value, fallback = DEFAULT_MIC_BOOST_BPM) {
    const n = typeof value === 'number' ? Math.round(value) : parseInt(String(value), 10);
    return Number.isFinite(n) ? Math.max(MIN_MIC_BOOST_BPM, Math.min(MAX_MIC_BOOST_BPM, n)) : fallback;
}
export function micBoostFromLevel(level, gate, maxBpm) {
    const cap = clampMicBoostBpm(maxBpm, 0);
    const lv = typeof level === 'number' ? level : parseInt(String(level), 10);
    const g = clampMicGate(gate);
    return cap <= 0 || !Number.isFinite(lv) || lv <= g ? 0 : Math.round(Math.min(1, (lv - g) / Math.max(1, 100 - g)) * cap);
}
export function micBoostedHr({ sensorHr, micBoost = 0, heldBoost = 0, ceiling, micEnabled = false, pulseFresh = false } = {}) {
    if (!Number.isFinite(sensorHr) || !micEnabled) return sensorHr;
    const boost = pulseFresh ? (Number.isFinite(micBoost) && micBoost > 0 ? micBoost : 0) : (Number.isFinite(heldBoost) && heldBoost > 0 ? heldBoost : 0);
    return boost <= 0 || !Number.isFinite(ceiling) || sensorHr >= ceiling ? sensorHr : Math.min(ceiling, sensorHr + boost);
}
export const MIC_SPEECH_TAIL_MS = 700;
export const MIC_SPEECH_MAX_HOLD_MS = 10000;
export function micSampleSuppressed({ speaking = false, lastSpeechAt = 0, now = 0, tailMs = MIC_SPEECH_TAIL_MS } = {}) {
    if (speaking) return true;
    const last = Number.isFinite(lastSpeechAt) ? lastSpeechAt : 0;
    return last > 0 && now >= last && now - last < Math.max(0, Number(tailMs) || 0);
}
export function voiceBandLevel(freqBytes, sampleRate, fftSize) {
    if (!freqBytes?.length) return 0;
    const binHz = (Number.isFinite(sampleRate) && sampleRate > 0 ? sampleRate : 44100) / (Number.isFinite(fftSize) && fftSize > 0 ? fftSize : freqBytes.length * 2);
    let sum = 0, count = 0;
    for (let i = 0; i < freqBytes.length; i++) {
        const hz = i * binHz, mag = freqBytes[i];
        if (hz >= MIC_VOICE_BAND_LO_HZ && hz <= MIC_VOICE_BAND_HI_HZ && Number.isFinite(mag)) { sum += mag; count++; }
    }
    return count ? Math.min(100, Math.round(sum / count / 2.55)) : 0;
}
export function sampleMicLevel(state, now = Date.now()) {
    const speaking = Boolean(activeAudio && !activeAudio.paused && !activeAudio.ended);
    if (speaking) state.micSpeechAt = now;
    const held = Number.isFinite(state.micLastLevel) ? state.micLastLevel : 0;
    if (speaking || now < micSpeakingUntil || micSampleSuppressed({ lastSpeechAt: state.micSpeechAt, now })) {
        if (!state.micHoldSince) state.micHoldSince = now;
        if (now - state.micHoldSince > MIC_SPEECH_MAX_HOLD_MS) { state.micLastLevel = 0; return 0; }
        return held;
    }
    state.micHoldSince = 0;
    const analyser = state.micAnalyser;
    if (!analyser) { state.micLastLevel = 0; return 0; }
    const data = new Uint8Array(analyser.frequencyBinCount);
    analyser.getByteFrequencyData(data);
    const level = voiceBandLevel(data, state.micAudioCtx?.sampleRate || 44100, analyser.fftSize);
    state.micLastLevel = level;
    return level;
}
