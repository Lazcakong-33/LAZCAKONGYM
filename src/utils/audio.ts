let audioCtx: AudioContext | null = null;
let keepAliveAudioEl: HTMLAudioElement | null = null;
let keepAliveOsc: OscillatorNode | null = null;

/**
 * Generates a tiny valid 1-second silent WAV file as a base64 Data URI.
 * Playing this via HTMLAudioElement with loop=true during a rest countdown
 * prevents Android/iOS from suspending the browser tab or Service Worker
 * when the user locks the phone screen.
 */
function createSilentWavDataUri(): string {
  const sampleRate = 8000;
  const numSamples = sampleRate; // 1 second
  const buffer = new ArrayBuffer(44 + numSamples * 2);
  const view = new DataView(buffer);

  const writeString = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  };

  writeString(0, 'RIFF');
  view.setUint32(4, 36 + numSamples * 2, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true); // PCM chunk size
  view.setUint16(20, 1, true); // PCM format
  view.setUint16(22, 1, true); // Mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeString(36, 'data');
  view.setUint32(40, numSamples * 2, true);

  // Fill with near-zero imperceptible samples so Android audio mixer doesn't optimize it out
  for (let i = 0; i < numSamples; i++) {
    view.setInt16(44 + i * 2, i % 2 === 0 ? 1 : -1, true);
  }

  let binary = '';
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return 'data:audio/wav;base64,' + btoa(binary);
}

export function getAudioContext(): AudioContext {
  if (!audioCtx) {
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

export function resumeAudio() {
  if (audioCtx && audioCtx.state === 'suspended') {
    audioCtx.resume().catch(() => {});
  }
}

/**
 * Starts an imperceptible background audio keep-alive loop while the rest timer is active.
 * This keeps the JS thread and Web Audio active even when the phone is locked.
 */
export function startSilentAudioKeepAlive(exerciseName?: string) {
  try {
    const ctx = getAudioContext();
    if (ctx.state === 'suspended') {
      ctx.resume().catch(() => {});
    }

    // 1. Web Audio sub-audible oscillator keep-alive
    if (!keepAliveOsc) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(1, ctx.currentTime);
      gain.gain.setValueAtTime(0.0001, ctx.currentTime);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      keepAliveOsc = osc;
    }

    // 2. HTMLAudioElement loop keep-alive (prevents Android/iOS CPU sleep on lock screen)
    if (!keepAliveAudioEl && typeof Audio !== 'undefined') {
      keepAliveAudioEl = new Audio(createSilentWavDataUri());
      keepAliveAudioEl.loop = true;
      keepAliveAudioEl.volume = 0.01;
    }
    if (keepAliveAudioEl && keepAliveAudioEl.paused) {
      keepAliveAudioEl.play().catch(() => {});
    }

    // 3. Register MediaSession so lock screen treats app as active workout timer
    if (typeof navigator !== 'undefined' && 'mediaSession' in navigator && typeof MediaMetadata !== 'undefined') {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: exerciseName ? `Descanso: ${exerciseName}` : 'Temporizador de Descanso Activo',
        artist: 'LAZCAKONGYM',
        album: 'Alerta a los 5s y 0s en Reloj',
      });
    }
  } catch (err) {
    console.warn('Silent audio keep-alive error:', err);
  }
}

/**
 * Stops the background audio keep-alive loop once rest timer completes or is cancelled.
 */
export function stopSilentAudioKeepAlive() {
  try {
    if (keepAliveOsc) {
      keepAliveOsc.stop();
      keepAliveOsc.disconnect();
      keepAliveOsc = null;
    }
  } catch {}

  try {
    if (keepAliveAudioEl) {
      keepAliveAudioEl.pause();
      keepAliveAudioEl.currentTime = 0;
    }
  } catch {}
}

/**
 * Short acoustic beep for series completion or button press
 */
export function playBeep(isHighTone = false) {
  try {
    const ctx = getAudioContext();
    if (ctx.state === 'suspended') {
      ctx.resume().catch(() => {});
    }

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'triangle';
    osc.frequency.setValueAtTime(isHighTone ? 1200 : 750, ctx.currentTime);

    gain.gain.setValueAtTime(0.2, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + (isHighTone ? 0.4 : 0.2));

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start();
    osc.stop(ctx.currentTime + (isHighTone ? 0.4 : 0.2));
  } catch (err) {
    console.warn('Audio play failed:', err);
  }
}

/**
 * Crisp countdown tick for the final 5 seconds of rest (5, 4, 3, 2, 1)
 */
export function playCountdownTick(secondsLeft: number) {
  try {
    const ctx = getAudioContext();
    if (ctx.state === 'suspended') {
      ctx.resume().catch(() => {});
    }

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    // Escalate pitch slightly as countdown approaches 1
    const baseFreq = secondsLeft === 1 ? 1046.5 : 880;
    osc.type = 'sine';
    osc.frequency.setValueAtTime(baseFreq, ctx.currentTime);

    gain.gain.setValueAtTime(0.35, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.14);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start();
    osc.stop(ctx.currentTime + 0.14);
  } catch (err) {
    console.warn('Countdown tick audio failed:', err);
  }
}

/**
 * Loud, unmistakable 4-tone ascending chime for rest completion
 */
export function playRestCompleteAlarm() {
  try {
    const ctx = getAudioContext();
    if (ctx.state === 'suspended') {
      ctx.resume().catch(() => {});
    }

    // Play double fanfare with dual oscillators (sine + square) for maximum volume in noisy gyms
    [0.0, 0.9].forEach((loopOffset) => {
      const notes = [
        { freq: 523.25, time: loopOffset + 0.0, dur: 0.25 },
        { freq: 659.25, time: loopOffset + 0.18, dur: 0.25 },
        { freq: 783.99, time: loopOffset + 0.36, dur: 0.35 },
        { freq: 1046.5, time: loopOffset + 0.58, dur: 0.7 },
      ];

      notes.forEach((n) => {
        const startTime = ctx.currentTime + n.time;

        // Primary Sine wave for rich body
        const osc1 = ctx.createOscillator();
        const gain1 = ctx.createGain();
        osc1.type = 'sine';
        osc1.frequency.setValueAtTime(n.freq, startTime);
        gain1.gain.setValueAtTime(0.85, startTime);
        gain1.gain.exponentialRampToValueAtTime(0.001, startTime + n.dur);
        osc1.connect(gain1);
        gain1.connect(ctx.destination);
        osc1.start(startTime);
        osc1.stop(startTime + n.dur);

        // Secondary Square wave for piercing volume
        const osc2 = ctx.createOscillator();
        const gain2 = ctx.createGain();
        osc2.type = 'square';
        osc2.frequency.setValueAtTime(n.freq, startTime);
        gain2.gain.setValueAtTime(0.45, startTime);
        gain2.gain.exponentialRampToValueAtTime(0.001, startTime + n.dur);
        osc2.connect(gain2);
        gain2.connect(ctx.destination);
        osc2.start(startTime);
        osc2.stop(startTime + n.dur);
      });
    });
  } catch (err) {
    console.warn('Alarm audio failed:', err);
  }
}

/**
 * Patrón de vibración intenso y prolongado de múltiples pulsos para fin de descanso (00:00).
 * Diseñado para sentirse con fuerza tanto en el bolsillo como en smartwatches vinculados.
 */
export const INTENSE_REST_VIBRATION_PATTERN: number[] = [
  500, 120, 500, 120, 700, 150, 500, 120, 900, 150, 1200,
];

/**
 * Invoca el motor háptico nativo de Capacitor (@capacitor/haptics) si la app corre
 * empaquetada en Android/iOS, además de la API estándar navigator.vibrate.
 */
export async function triggerNativeAndWebVibration(
  pattern: number[] = INTENSE_REST_VIBRATION_PATTERN
): Promise<void> {
  // 1. Invocar navigator.vibrate con el patrón completo de múltiples pulsos
  try {
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
      navigator.vibrate(pattern);
    }
  } catch {
    // Ignorar si el navegador bloquea o no soporta navigator.vibrate
  }

  // 2. Compatibilidad con Capacitor Haptics en Android / iOS empaquetado
  try {
    const win = typeof window !== 'undefined' ? (window as any) : undefined;
    const capHaptics =
      win?.Capacitor?.Plugins?.Haptics || win?.Plugins?.Haptics || null;

    if (capHaptics) {
      // Ejecutar ráfaga de pulsos fuertes en el motor háptico nativo
      const pulseDurations = pattern.filter((_, idx) => idx % 2 === 0);
      for (let i = 0; i < pulseDurations.length; i++) {
        const duration = pulseDurations[i];
        if (typeof capHaptics.vibrate === 'function') {
          await capHaptics.vibrate({ duration: Math.max(300, duration) });
        } else if (typeof capHaptics.impact === 'function') {
          await capHaptics.impact({ style: 'HEAVY' });
        }
        const pauseMs = pattern[i * 2 + 1] || 120;
        if (i < pulseDurations.length - 1) {
          await new Promise((r) => setTimeout(r, duration + pauseMs));
        }
      }
    }
  } catch {
    // Fallback silencioso si no está en contenedor Capacitor
  }
}

/**
 * Generates a long repetitive vibration pattern based on a sequence.
 */
export function vibratePattern(sequence: number[], repeatCount: number) {
  const pattern: number[] = [];
  for (let i = 0; i < repeatCount; i++) {
    pattern.push(...sequence);
  }
  vibrateDevice(pattern);
}

export function vibrateDevice(
  pattern: number[] = [300, 100, 300, 100, 500, 120, 700]
) {
  void triggerNativeAndWebVibration(pattern);
}

/**
 * Synthesizes an aggressive gorilla chest-beating roar for updates
 */
export function playGorillaRoar() {
  try {
    const ctx = getAudioContext();
    if (ctx.state === 'suspended') {
      ctx.resume().catch(() => {});
    }

    const now = ctx.currentTime;
    const dur = 1.6;

    // 1. Epic Cinematic Gorilla Growl (Sawtooth + Lowpass sweep)
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

    osc.start(now);
    osc.stop(now + dur);

    // 2. Rhythmic Chest Beats (Thumps)
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

      thumpOsc.start(tNow);
      thumpOsc.stop(tNow + 0.15);
    });
  } catch (err) {
    console.warn('Gorilla roar audio failed:', err);
  }
}
