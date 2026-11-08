const KEY = 'tc.sound';

export function soundEnabled() {
  try {
    return localStorage.getItem(KEY) !== 'off';
  } catch {
    return true;
  }
}

export function setSoundEnabled(on: boolean) {
  try {
    localStorage.setItem(KEY, on ? 'on' : 'off');
  } catch {
    /* storage unavailable */
  }
}

/** One shared context: re-creating it per sound leaves suspended contexts behind on autoplay policies. */
let ctx: AudioContext | null = null;

function audio(): AudioContext | null {
  try {
    ctx ??= new AudioContext();
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

/** Warm up audio on the first user gesture so later notifications are not blocked by autoplay rules. */
export function primeSound() {
  audio();
  if (typeof window !== 'undefined') {
    window.removeEventListener('pointerdown', primeSound);
    window.removeEventListener('keydown', primeSound);
  }
}
if (typeof window !== 'undefined') {
  window.addEventListener('pointerdown', primeSound);
  window.addEventListener('keydown', primeSound);
}

function tone(start: number, freq: number, gainValue: number) {
  const ac = audio();
  if (!ac) return;
  const osc = ac.createOscillator();
  const gain = ac.createGain();
  osc.type = 'sine';
  osc.frequency.value = freq;
  osc.connect(gain);
  gain.connect(ac.destination);
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(gainValue, start + 0.015);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.22);
  osc.start(start);
  osc.stop(start + 0.23);
}

/** Soft two-note chime for any incoming message. */
export function playMessageSound() {
  if (!soundEnabled()) return;
  const ac = audio();
  if (!ac) return;
  tone(ac.currentTime, 660, 0.05);
  tone(ac.currentTime + 0.09, 880, 0.04);
}

/** Slightly brighter triple chime for a new @mention. */
export function playMentionSound() {
  if (!soundEnabled()) return;
  const ac = audio();
  if (!ac) return;
  tone(ac.currentTime, 700, 0.07);
  tone(ac.currentTime + 0.1, 930, 0.07);
  tone(ac.currentTime + 0.2, 1180, 0.05);
}
