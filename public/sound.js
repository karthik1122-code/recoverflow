// The soundbox voice: a two-note chime made with Web Audio, then the amount spoken aloud.
// Browsers only allow sound after a person clicks or presses a key, so call these from a user action.
let ctx = null;
const audio = () => {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
  }
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  return ctx;
};

function note(ac, freq, start, length, gain) {
  const osc = ac.createOscillator();
  const overtone = ac.createOscillator();
  const env = ac.createGain();
  osc.type = 'sine'; osc.frequency.value = freq;
  overtone.type = 'sine'; overtone.frequency.value = freq * 2.01;
  const mix = ac.createGain(); mix.gain.value = 0.18;
  overtone.connect(mix).connect(env);
  osc.connect(env).connect(ac.destination);
  env.gain.setValueAtTime(0.0001, start);
  env.gain.exponentialRampToValueAtTime(gain, start + 0.012);
  env.gain.exponentialRampToValueAtTime(0.0001, start + length);
  osc.start(start); overtone.start(start);
  osc.stop(start + length + 0.05); overtone.stop(start + length + 0.05);
}

/** Bright rising two-note "received" chime. Returns its length in seconds (0 if sound is unavailable). */
export function chime() {
  const ac = audio();
  if (!ac) return 0;
  const t = ac.currentTime + 0.02;
  note(ac, 1046.5, t, 0.35, 0.22);        // C6
  note(ac, 1568.0, t + 0.13, 0.7, 0.2);   // G6
  return 0.75;
}

/** A short low tone for a failed payment. */
export function thud() {
  const ac = audio();
  if (!ac) return;
  note(ac, 220, ac.currentTime + 0.01, 0.25, 0.12);
}

export const canSpeak = () => 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window;

/** Speak a sentence in an Indian English voice when the device has one. Resolves when finished. */
export function speak(text, { rate = 0.98 } = {}) {
  return new Promise(resolve => {
    if (!canSpeak()) { resolve(); return; }
    const u = new SpeechSynthesisUtterance(text);
    const voices = speechSynthesis.getVoices();
    u.voice = voices.find(v => v.lang === 'en-IN') || voices.find(v => /en[-_]/.test(v.lang)) || null;
    u.lang = u.voice?.lang || 'en-IN';
    u.rate = rate;
    u.onend = u.onerror = () => resolve();
    speechSynthesis.cancel();
    speechSynthesis.speak(u);
    setTimeout(resolve, 6000); // some browsers never fire onend
  });
}

/** Chime, then announce "<amount> rupees recovered", the way a counter soundbox announces a payment. */
export async function announce(rupees, who) {
  const wait = chime();
  await new Promise(r => setTimeout(r, wait * 600));
  await speak(`${Math.round(rupees)} rupees recovered${who ? ` from ${who}` : ''}`);
}
