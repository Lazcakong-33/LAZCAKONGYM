import { triggerCapacitorHaptics } from './nativeNotifications.ts';

let audioCtx: AudioContext | null = null;
let keepAliveAudioEl: HTMLAudioElement | null = null;
let keepAliveOsc: OscillatorNode | null = null;
let releaseTimeoutId: ReturnType<typeof setTimeout> | null = null;

interface TrackedAudioNode {
  stop?: () => void;
  disconnect?: () => void;
}

let activeAudioNodes: TrackedAudioNode[] = [];

function clearScheduledAudioRelease() {
  if (releaseTimeoutId !== null) {
    clearTimeout(releaseTimeoutId);
    releaseTimeoutId = null;
  }
}

/**
 * Releases all Web Audio / HTMLAudio resources created by the rest timer or set feedback.
 * Closing the AudioContext immediately returns Android Audio Focus to background apps
 * (e.g., YouTube / Spotify) so their volume recovers without closing LazcaKong Gym.
 */
export function releaseTimerAudioResources(): void {
  clearScheduledAudioRelease();

  if (activeAudioNodes.length > 0) {
    const nodesToClean = activeAudioNodes;
    activeAudioNodes = [];
    for (const node of nodesToClean) {
      try {
        node.stop?.();
      } catch {}
      try {
        node.disconnect?.();
      } catch {}
    }
  }

  try {
    if (keepAliveOsc) {
      keepAliveOsc.stop();
      keepAliveOsc.disconnect();
      keepAliveOsc = null;
    }
  } catch {
    keepAliveOsc = null;
  }

  try {
    if (keepAliveAudioEl) {
      keepAliveAudioEl.pause();
      keepAliveAudioEl.removeAttribute('src');
      keepAliveAudioEl.load();
      keepAliveAudioEl = null;
    }
  } catch {
    keepAliveAudioEl = null;
  }

  if (audioCtx) {
    const ctxToClose = audioCtx;
    audioCtx = null;
    try {
      if (ctxToClose.state !== 'closed' && typeof ctxToClose.close === 'function') {
        void ctxToClose.close().catch(() => {});
      }
    } catch {}
  }
}

function scheduleTimerAudioRelease(delayMs: number) {
  clearScheduledAudioRelease();
  releaseTimeoutId = setTimeout(() => {
    releaseTimeoutId = null;
    releaseTimerAudioResources();
  }, Math.max(50, delayMs));
}

export function hasOpenTimerAudioResources(): boolean {
  return Boolean(
    (audioCtx && audioCtx.state !== 'closed') ||
      keepAliveOsc ||
      keepAliveAudioEl ||
      activeAudioNodes.length > 0
  );
}

export function getAudioContext(): AudioContext {
  if (!audioCtx || audioCtx.state === 'closed') {
    const AudioContextClass =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    audioCtx = new AudioContextClass();
  }
  if (audioCtx.state === 'suspended') {
    audioCtx.resume().catch(() => {});
  }
  return audioCtx;
}

/**
 * Kept for backwards import compatibility. Deliberately a no-op so starting,
 * pausing, resuming, or focusing the rest timer never grabs Android Audio Focus.
 */
export function resumeAudio() {
  // No-op: rest countdown must never open or resume AudioContext proactively.
}

/**
 * Deprecated silent audio keep-alive. Previously kept an AudioContext oscillator,
 * looped silent WAV <audio>, and MediaSession alive during rests, which caused
 * Android/Honor OS to duck YouTube for the entire workout. Now strictly a no-op.
 */
export function startSilentAudioKeepAlive(_exerciseName?: string) {
  // Deliberately no-op to preserve external media volume (YouTube/Spotify) on Android.
}

/**
 * Stops and releases all timer audio resources immediately.
 */
export function stopSilentAudioKeepAlive() {
  releaseTimerAudioResources();
}

/**
 * Short acoustic beep for series completion (only invoked when soundEnabled === true).
 * Immediately closes AudioContext right after the tone finishes.
 */
export function playBeep(isHighTone = false) {
  try {
    clearScheduledAudioRelease();
    const ctx = getAudioContext();
    if (ctx.state === 'suspended') {
      ctx.resume().catch(() => {});
    }

    const durationSec = isHighTone ? 0.35 : 0.18;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'triangle';
    osc.frequency.setValueAtTime(isHighTone ? 1200 : 750, ctx.currentTime);

    gain.gain.setValueAtTime(0.2, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + durationSec);

    osc.connect(gain);
    gain.connect(ctx.destination);

    activeAudioNodes.push(osc, gain);
    osc.onended = () => {
      try {
        osc.disconnect();
        gain.disconnect();
      } catch {}
    };

    osc.start();
    osc.stop(ctx.currentTime + durationSec);
    scheduleTimerAudioRelease(Math.ceil(durationSec * 1000) + 120);
  } catch (err) {
    console.warn('Audio play failed:', err);
  }
}

/**
 * Kept as exported helper for compatibility, no longer invoked during countdown ticks
 * so no AudioContext is opened before 00:00.
 */
export function playCountdownTick(secondsLeft: number) {
  try {
    clearScheduledAudioRelease();
    const ctx = getAudioContext();
    if (ctx.state === 'suspended') {
      ctx.resume().catch(() => {});
    }

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    const baseFreq = secondsLeft === 1 ? 1046.5 : 880;
    osc.type = 'sine';
    osc.frequency.setValueAtTime(baseFreq, ctx.currentTime);

    gain.gain.setValueAtTime(0.35, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.14);

    osc.connect(gain);
    gain.connect(ctx.destination);

    activeAudioNodes.push(osc, gain);
    osc.start();
    osc.stop(ctx.currentTime + 0.14);
    scheduleTimerAudioRelease(240);
  } catch (err) {
    console.warn('Countdown tick audio failed:', err);
  }
}

/**
 * Plays a single, unmistakable final chime when the rest timer reaches 00:00
 * (only when the athlete chose "Pitido final" / soundEnabled === true),
 * then immediately closes AudioContext so external media volume recovers.
 */
export function playRestCompleteAlarm() {
  try {
    clearScheduledAudioRelease();
    const ctx = getAudioContext();
    if (ctx.state === 'suspended') {
      ctx.resume().catch(() => {});
    }

    const notes = [
      { freq: 659.25, time: 0.0, dur: 0.15 },
      { freq: 880.0, time: 0.15, dur: 0.17 },
      { freq: 1046.5, time: 0.32, dur: 0.42 },
    ];

    notes.forEach((n) => {
      const startTime = ctx.currentTime + n.time;

      const osc1 = ctx.createOscillator();
      const gain1 = ctx.createGain();
      osc1.type = 'sine';
      osc1.frequency.setValueAtTime(n.freq, startTime);
      gain1.gain.setValueAtTime(0.68, startTime);
      gain1.gain.setValueAtTime(0.68, startTime + n.dur * 0.45);
      gain1.gain.exponentialRampToValueAtTime(0.001, startTime + n.dur);
      osc1.connect(gain1);
      gain1.connect(ctx.destination);
      osc1.start(startTime);
      osc1.stop(startTime + n.dur);

      const osc2 = ctx.createOscillator();
      const gain2 = ctx.createGain();
      osc2.type = 'triangle';
      osc2.frequency.setValueAtTime(n.freq, startTime);
      gain2.gain.setValueAtTime(0.27, startTime);
      gain2.gain.setValueAtTime(0.27, startTime + n.dur * 0.45);
      gain2.gain.exponentialRampToValueAtTime(0.001, startTime + n.dur);
      osc2.connect(gain2);
      gain2.connect(ctx.destination);
      osc2.start(startTime);
      osc2.stop(startTime + n.dur);

      activeAudioNodes.push(osc1, gain1, osc2, gain2);
    });

    // Release AudioContext right after the final note completes (~850ms)
    scheduleTimerAudioRelease(880);
  } catch (err) {
    console.warn('Alarm audio failed:', err);
  }
}

/**
 * Patrón único de vibración solicitado al finalizar el descanso (00:00):
 * 600 ms vibración, 250 ms pausa, 600 ms vibración, 250 ms pausa, 600 ms vibración.
 */
export const REST_COMPLETE_VIBRATION_PATTERN: number[] = [600, 250, 600, 250, 600];

export const INTENSE_REST_VIBRATION_PATTERN: number[] = REST_COMPLETE_VIBRATION_PATTERN;

/**
 * Cancela cualquier vibración en curso cuando el atleta salta o cancela el descanso.
 */
export function cancelDeviceVibration(): void {
  try {
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
      navigator.vibrate(0);
    }
  } catch {}
}

/**
 * Invoca el motor háptico nativo de Capacitor (@capacitor/haptics) si la app corre
 * empaquetada en Android/iOS, además de la API estándar navigator.vibrate.
 */
export async function triggerNativeAndWebVibration(
  pattern: number[] = REST_COMPLETE_VIBRATION_PATTERN
): Promise<void> {
  try {
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
      navigator.vibrate(pattern);
    }
  } catch {}

  try {
    const win = typeof window !== 'undefined' ? (window as any) : undefined;
    const cap = win?.Capacitor;
    const isNative = Boolean(
      cap && (typeof cap.isNativePlatform === 'function' ? cap.isNativePlatform() : cap.isNative)
    );
    if (isNative) {
      const handled = await triggerCapacitorHaptics(pattern);
      if (handled) return;
    }

    const capHaptics =
      win?.Capacitor?.Plugins?.Haptics || win?.Plugins?.Haptics || null;

    if (capHaptics) {
      const pulseDurations = pattern.filter((_, idx) => idx % 2 === 0);
      for (let i = 0; i < pulseDurations.length; i++) {
        const duration = pulseDurations[i];
        if (typeof capHaptics.vibrate === 'function') {
          await capHaptics.vibrate({ duration: Math.max(300, duration) });
        } else if (typeof capHaptics.impact === 'function') {
          await capHaptics.impact({ style: 'HEAVY' });
        }
        const pauseMs = pattern[i * 2 + 1] || 250;
        if (i < pulseDurations.length - 1) {
          await new Promise((r) => setTimeout(r, duration + pauseMs));
        }
      }
    }
  } catch {}
}

export function vibratePattern(sequence: number[], repeatCount: number) {
  const pattern: number[] = [];
  for (let i = 0; i < repeatCount; i++) {
    pattern.push(...sequence);
  }
  vibrateDevice(pattern);
}

export function vibrateDevice(
  pattern: number[] = REST_COMPLETE_VIBRATION_PATTERN
) {
  void triggerNativeAndWebVibration(pattern);
}

/**
 * Synthesizes an aggressive gorilla chest-beating roar for updates
 */
export function playGorillaRoar() {
  try {
    clearScheduledAudioRelease();
    const ctx = getAudioContext();
    if (ctx.state === 'suspended') {
      ctx.resume().catch(() => {});
    }

    const now = ctx.currentTime;
    const dur = 1.6;

    const osc = ctx.createOscillator();
    const filter = ctx.createBiquadFilter();
    const gain = ctx.createGain();

    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(140, now);
    osc.frequency.exponentialRampToValueAtTime(35, now + dur);

    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(450, now);
    filter.frequency.linearRampToValueAtTime(120, now + dur);

    gain.gain.setValueAtTime(0.95, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + dur);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);

    activeAudioNodes.push(osc, filter, gain);
    osc.start(now);
    osc.stop(now + dur);

    [0.1, 0.35, 0.6, 0.85].forEach((thumpTime, i) => {
      const thumpOsc = ctx.createOscillator();
      const thumpGain = ctx.createGain();
      const tNow = now + thumpTime;

      thumpOsc.type = 'sine';
      thumpOsc.frequency.setValueAtTime(95 - i * 8, tNow);
      thumpOsc.frequency.exponentialRampToValueAtTime(25, tNow + 0.15);

      thumpGain.gain.setValueAtTime(0.85, tNow);
      thumpGain.gain.exponentialRampToValueAtTime(0.001, tNow + 0.15);

      thumpOsc.connect(thumpGain);
      thumpGain.connect(ctx.destination);

      activeAudioNodes.push(thumpOsc, thumpGain);
      thumpOsc.start(tNow);
      thumpOsc.stop(tNow + 0.15);
    });

    scheduleTimerAudioRelease(1750);
  } catch (err) {
    console.warn('Gorilla roar audio failed:', err);
  }
}
