// Audio engine — combines pre-recorded samples (Mixkit, free license)
// with synthesized fallbacks so the app keeps sounding even if the
// samples fail to load (e.g., offline, ad-blocker, etc.).

const SOUND_PREF_KEY = 'chasflip:sound:v1';

// Map of logical name -> public URL (served as static assets by Vite).
const SAMPLE_URLS = {
  'win-tier1': '/sounds/win-tier1.mp3',
  'win-tier2': '/sounds/win-tier2.mp3',
  'win-tier3': '/sounds/win-tier3.mp3',
  'win-tier4': '/sounds/win-tier4.mp3',
  'win-tier5': '/sounds/win-tier5.mp3',
  'win-tier6': '/sounds/win-tier6.mp3',
  deposit:  '/sounds/deposit.mp3',
  launch:   '/sounds/launch.mp3',
};

let _ctx = null;
let _enabled = true;
const _buffers = new Map();      // name -> AudioBuffer (decoded)
const _loading = new Map();      // name -> Promise<AudioBuffer>
let _activeWinSource = null;     // track current win sound to allow overlap-cancel

try {
  if (typeof window !== 'undefined') {
    const stored = window.localStorage.getItem(SOUND_PREF_KEY);
    if (stored === 'off') _enabled = false;
  }
} catch { /* ignore */ }

function getOrCreateContext() {
  if (typeof window === 'undefined') return null;
  if (_ctx) return _ctx;
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return null;
  try {
    _ctx = new Ctx();
  } catch {
    return null;
  }
  return _ctx;
}

async function loadSample(name) {
  if (_buffers.has(name)) return _buffers.get(name);
  if (_loading.has(name)) return _loading.get(name);

  const ctx = getOrCreateContext();
  const url = SAMPLE_URLS[name];
  if (!ctx || !url) return null;

  const promise = (async () => {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Failed to fetch ${url}`);
      const arrayBuffer = await res.arrayBuffer();
      const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
      _buffers.set(name, audioBuffer);
      return audioBuffer;
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn('[sound] load failed for', name, e);
      return null;
    } finally {
      _loading.delete(name);
    }
  })();

  _loading.set(name, promise);
  return promise;
}

function preloadAllSamples() {
  Object.keys(SAMPLE_URLS).forEach((name) => { loadSample(name); });
}

export function prewarmAudio() {
  const ctx = getOrCreateContext();
  if (!ctx) return;
  if (ctx.state === 'suspended') {
    ctx.resume().catch(() => { /* ignore */ });
  }
  preloadAllSamples();
}

export function setSoundEnabled(value) {
  _enabled = !!value;
  try {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(SOUND_PREF_KEY, _enabled ? 'on' : 'off');
    }
  } catch { /* ignore */ }
  if (!_enabled) stopActiveWin();
}

export function isSoundEnabled() {
  return _enabled;
}

function stopActiveWin() {
  if (_activeWinSource) {
    try { _activeWinSource.stop(); } catch { /* ignore */ }
    _activeWinSource = null;
  }
}

function playBuffer(buffer, { volume = 1, trackAsWin = false } = {}) {
  const ctx = getOrCreateContext();
  if (!ctx || !buffer) return null;

  const src = ctx.createBufferSource();
  src.buffer = buffer;

  const gain = ctx.createGain();
  gain.gain.value = volume;

  src.connect(gain).connect(ctx.destination);
  src.start(0);

  if (trackAsWin) {
    stopActiveWin();
    _activeWinSource = src;
    src.onended = () => {
      if (_activeWinSource === src) _activeWinSource = null;
    };
  }
  return src;
}

// -----------------------------------------------------------------------
// Synthesized fallback voices (used when samples not yet loaded)
// -----------------------------------------------------------------------

function makeWhiteNoiseSource(ctx, durationSec) {
  const sampleCount = Math.max(1, Math.floor(ctx.sampleRate * durationSec));
  const buffer = ctx.createBuffer(1, sampleCount, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < sampleCount; i += 1) data[i] = Math.random() * 2 - 1;
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  return src;
}

function bell(ctx, master, freq, startOffset, dur, peak, type = 'sine') {
  const t0 = ctx.currentTime + startOffset;
  const osc = ctx.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);

  const env = ctx.createGain();
  env.gain.setValueAtTime(0, t0);
  env.gain.linearRampToValueAtTime(peak, t0 + 0.006);
  env.gain.exponentialRampToValueAtTime(0.0008, t0 + dur);

  osc.connect(env);
  env.connect(master);
  osc.start(t0);
  osc.stop(t0 + dur + 0.05);
}

function subThump(ctx, master, startOffset = 0, dur = 0.45, peak = 0.36) {
  const t0 = ctx.currentTime + startOffset;
  const osc = ctx.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(95, t0);
  osc.frequency.exponentialRampToValueAtTime(35, t0 + dur);
  const env = ctx.createGain();
  env.gain.setValueAtTime(0, t0);
  env.gain.linearRampToValueAtTime(peak, t0 + 0.01);
  env.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
  osc.connect(env);
  env.connect(master);
  osc.start(t0);
  osc.stop(t0 + dur + 0.05);
}

function fallbackKaChing(ctx, master, intensity = 1) {
  const notes = [
    { f: 880,  type: 'sine',     start: 0.00, dur: 0.55, peak: 0.32 },
    { f: 1320, type: 'sine',     start: 0.06, dur: 0.55, peak: 0.30 },
    { f: 1760, type: 'triangle', start: 0.12, dur: 0.55, peak: 0.24 },
    { f: 2640, type: 'sine',     start: 0.18, dur: 0.55, peak: 0.18 },
  ];
  notes.forEach((n) => bell(ctx, master, n.f, n.start, n.dur, n.peak * intensity, n.type));

  const t0 = ctx.currentTime + 0.03;
  const noise = makeWhiteNoiseSource(ctx, 0.18);
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = 4500;
  bp.Q.value = 7;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(0.18 * intensity, t0 + 0.012);
  g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.18);
  noise.connect(bp);
  bp.connect(g);
  g.connect(master);
  noise.start(t0);
  noise.stop(t0 + 0.20);

  subThump(ctx, master, 0, 0.22, 0.20 * intensity);
}

// -----------------------------------------------------------------------
// Public API
// -----------------------------------------------------------------------

function tierFor(monto) {
  if (monto >= 1_000_000) return 6;
  if (monto >= 100_000)   return 5;
  if (monto >= 10_000)    return 4;
  if (monto >= 1_000)     return 3;
  if (monto >= 100)       return 2;
  return 1;
}

export function playWinSound({ monto = 10, volume = 0.9 } = {}) {
  if (!_enabled) return;
  const ctx = getOrCreateContext();
  if (!ctx) return;
  if (ctx.state === 'suspended') ctx.resume().catch(() => { /* ignore */ });

  const tier = tierFor(monto);
  const sampleName = `win-tier${tier}`;
  const buffer = _buffers.get(sampleName);

  // Higher tiers get a slight extra volume push (still capped).
  const tierVol = Math.min(1.0, volume * (1 + (tier - 1) * 0.04));

  if (buffer) {
    playBuffer(buffer, { volume: tierVol, trackAsWin: true });
    return;
  }

  // Sample not loaded yet — kick off the load and play a synthesized fallback
  // matching the requested tier so the user always hears something.
  loadSample(sampleName);

  const master = ctx.createGain();
  master.gain.value = volume;
  master.connect(ctx.destination);
  const intensity = 0.85 + (tier - 1) * 0.05;
  fallbackKaChing(ctx, master, intensity);
}

export function playDepositSound({ volume = 0.7 } = {}) {
  if (!_enabled) return;
  const ctx = getOrCreateContext();
  if (!ctx) return;
  if (ctx.state === 'suspended') ctx.resume().catch(() => { /* ignore */ });

  const buffer = _buffers.get('deposit');
  if (buffer) {
    playBuffer(buffer, { volume });
    return;
  }
  // Fallback: tiny 3-bell coin clink
  loadSample('deposit');
  const master = ctx.createGain();
  master.gain.value = volume;
  master.connect(ctx.destination);
  bell(ctx, master, 1760, 0.00, 0.16, 0.30, 'sine');
  bell(ctx, master, 2640, 0.05, 0.20, 0.22, 'triangle');
  bell(ctx, master, 1320, 0.10, 0.30, 0.16, 'sine');
}

/**
 * Gentle coin spin tick — solo síntesis: tono grave / cálido, ataque muy suave,
 * sin MP3 tipo "pitido" sci‑fi que cansa cuando el cofre está girando rápido.
 */
export function playFlipTick({ pitchVar = 0.04, volume = 0.14 } = {}) {
  if (!_enabled) return;
  const ctx = getOrCreateContext();
  if (!ctx) return;
  if (ctx.state === 'suspended') ctx.resume().catch(() => { /* ignore */ });

  const t0 = ctx.currentTime;

  const sum = ctx.createGain();
  sum.gain.value = 1;

  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.setValueAtTime(2400, t0);
  lp.Q.value = 0.45;

  const master = ctx.createGain();
  sum.connect(lp);
  lp.connect(master);
  master.connect(ctx.destination);

  const detune = 1 + (Math.random() - 0.5) * pitchVar * 2;
  const base = 565 * Math.max(0.9, Math.min(1.1, detune)); // Hz — banda medio‑grave tranquila

  const peak = Math.min(0.22, volume * 0.36);
  master.gain.setValueAtTime(0.0001, t0);
  master.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t0 + 0.026);
  master.gain.exponentialRampToValueAtTime(0.00035, t0 + 0.172);

  const freqs = [base, base * 1.27];
  const weights = [1, 0.28];

  freqs.forEach((f, i) => {
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(f, t0);
    const w = ctx.createGain();
    w.gain.value = weights[i];
    osc.connect(w).connect(sum);
    osc.start(t0);
    osc.stop(t0 + 0.18);
  });
}

/**
 * Spaceship-launch sound — plays once when the user clicks "Entrar a la arena".
 */
export function playLaunchSound({ volume = 0.85 } = {}) {
  if (!_enabled) return;
  const ctx = getOrCreateContext();
  if (!ctx) return;
  if (ctx.state === 'suspended') ctx.resume().catch(() => { /* ignore */ });

  const buffer = _buffers.get('launch');
  if (buffer) {
    playBuffer(buffer, { volume });
    return;
  }
  // Fallback: synthesized rising sweep + sub-thump
  loadSample('launch');
  const master = ctx.createGain();
  master.gain.value = volume;
  master.connect(ctx.destination);
  const t0 = ctx.currentTime;
  const sweep = ctx.createOscillator();
  sweep.type = 'sawtooth';
  sweep.frequency.setValueAtTime(120, t0);
  sweep.frequency.exponentialRampToValueAtTime(2400, t0 + 1.4);
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 1800;
  const env = ctx.createGain();
  env.gain.setValueAtTime(0, t0);
  env.gain.linearRampToValueAtTime(0.30, t0 + 0.10);
  env.gain.linearRampToValueAtTime(0.18, t0 + 1.2);
  env.gain.exponentialRampToValueAtTime(0.001, t0 + 1.6);
  sweep.connect(lp);
  lp.connect(env);
  env.connect(master);
  sweep.start(t0);
  sweep.stop(t0 + 1.7);
  subThump(ctx, master, 0, 0.5, 0.30);
}
