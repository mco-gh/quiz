// The fun bits: screen changes, confetti, little synthesized sounds and
// numbers that count up. Everything respects "reduce motion", and sounds can
// be turned off in Settings.

const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');

/**
 * Change what's on screen inside a view transition when the browser has them,
 * then move focus to `focus` so keyboard and screen reader users follow along.
 */
// Changes are queued: two messages can arrive back to back (say, "welcome"
// then "here's the leaderboard"), and when transitions overlap, a newer one
// can apply its update before an older one. Each change waits only until the
// previous one has updated the page, not for its animation to finish.
// A transition that hasn't updated the page yet is skipped (which makes it
// update straight away), so a page that isn't drawing frames, like a phone
// with its screen off, never holds up the next change.
let queue = Promise.resolve();
let pending = null;

const settle = (promise, ms) => Promise.race([promise.catch(() => {}), new Promise((r) => setTimeout(r, ms))]);

export function swap(update, focus) {
  const done = () => { const el = typeof focus === 'function' ? focus() : focus; el?.focus?.({ preventScroll: true }); };
  const run = async () => {
    if (pending) {
      pending.skipTransition();
      await settle(pending.updateCallbackDone, 1000);
      pending = null;
    }
    if (!document.startViewTransition || reduceMotion.matches || document.visibilityState !== 'visible') {
      update();
      done();
      return { finished: Promise.resolve() };
    }
    let applied = false;
    const transition = document.startViewTransition(() => { applied = true; update(); });
    transition.ready.catch(() => {});      // a skipped transition rejects this; that's fine
    pending = transition;
    // A page that isn't drawing frames would wait forever to take its snapshot: give up on the animation.
    setTimeout(() => { if (!applied) transition.skipTransition(); }, 400);
    transition.updateCallbackDone.finally(() => { if (pending === transition) pending = null; }).catch(() => {});
    // Wrapped, so the queue moves on once this change is under way rather than when its animation ends.
    return { finished: transition.finished.catch(() => {}).finally(done) };
  };
  const started = queue.then(run);
  queue = started.then(() => {}, () => {});
  return started.then((t) => t.finished);
}

// Older browsers without sibling-index(): number children by hand so the CSS
// stagger still works.
const hasSiblingIndex = CSS.supports?.('animation-delay: calc(sibling-index() * 0.1s)');
export function numberChildren(parent) {
  if (hasSiblingIndex || !parent) return;
  [...parent.children].forEach((el, i) => el.style.setProperty('--sibling-index', i + 1));
}

/** Count a number up from `from` to `to` in the element. */
export function countUp(el, from, to, format = String, ms = 900) {
  if (reduceMotion.matches || from === to) { el.textContent = format(to); return; }
  const start = performance.now();
  const step = (now) => {
    const t = Math.min(1, (now - start) / ms);
    const eased = 1 - (1 - t) ** 3;
    el.textContent = format(Math.round(from + (to - from) * eased));
    if (t < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

// ── Confetti ──
const COLORS = ['#ff4f8b', '#7b3ff2', '#ffc63a', '#18c29c', '#2fa8ff', '#ff8a3d'];
let canvas = null;
let pieces = [];
let raf = 0;

export function confetti(amount = 160) {
  if (reduceMotion.matches) return;
  if (!canvas) {
    canvas = Object.assign(document.createElement('canvas'), { className: 'confetti' });
    canvas.setAttribute('aria-hidden', 'true');
    document.body.append(canvas);
  }
  const w = (canvas.width = innerWidth * devicePixelRatio);
  const h = (canvas.height = innerHeight * devicePixelRatio);
  for (let i = 0; i < amount; i++) {
    const fromLeft = i % 2 === 0;
    pieces.push({
      x: fromLeft ? 0 : w, y: h * (0.55 + Math.random() * 0.3),
      vx: (fromLeft ? 1 : -1) * (6 + Math.random() * 12) * devicePixelRatio,
      vy: -(14 + Math.random() * 14) * devicePixelRatio,
      size: (6 + Math.random() * 8) * devicePixelRatio,
      spin: Math.random() * Math.PI, vs: (Math.random() - 0.5) * 0.3,
      color: COLORS[i % COLORS.length], round: Math.random() < 0.3, life: 0,
    });
  }
  if (!raf) raf = requestAnimationFrame(draw);
}

function draw() {
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const g = 0.45 * devicePixelRatio;
  pieces = pieces.filter((p) => p.y < canvas.height + 40 && p.life < 400);
  for (const p of pieces) {
    p.life++;
    p.vy += g;
    p.vx *= 0.985;
    p.x += p.vx;
    p.y += p.vy;
    p.spin += p.vs;
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(p.spin);
    ctx.fillStyle = p.color;
    if (p.round) { ctx.beginPath(); ctx.arc(0, 0, p.size / 2, 0, Math.PI * 2); ctx.fill(); }
    else ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2 * (0.4 + Math.abs(Math.sin(p.spin))));
    ctx.restore();
  }
  raf = pieces.length ? requestAnimationFrame(draw) : 0;
  if (!raf) ctx.clearRect(0, 0, canvas.width, canvas.height);
}

// ── Sounds ──
let audio = null;
let soundOn = true;
export const setSound = (on) => { soundOn = on; };

/** Call from a click or key press: browsers only start audio after a gesture. */
export function unlockAudio() {
  if (audio) { if (audio.state === 'suspended') audio.resume().catch(() => {}); return; }
  try { audio = new AudioContext(); } catch {}
}

function tone(freq, start, length, { type = 'sine', gain = 0.12, slide = 0 } = {}) {
  const t = audio.currentTime + start;
  const osc = audio.createOscillator();
  const amp = audio.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  if (slide) osc.frequency.exponentialRampToValueAtTime(freq * slide, t + length);
  amp.gain.setValueAtTime(0.0001, t);
  amp.gain.exponentialRampToValueAtTime(gain, t + 0.015);
  amp.gain.exponentialRampToValueAtTime(0.0001, t + length);
  osc.connect(amp).connect(audio.destination);
  osc.start(t);
  osc.stop(t + length + 0.05);
}

const SOUNDS = {
  pop: () => tone(660, 0, 0.12, { type: 'triangle', slide: 1.6 }),
  tick: () => tone(1200, 0, 0.05, { type: 'square', gain: 0.03 }),
  count: () => tone(523, 0, 0.18, { type: 'triangle' }),
  go: () => { tone(523, 0, 0.12, { type: 'triangle' }); tone(784, 0.1, 0.25, { type: 'triangle' }); },
  lock: () => tone(880, 0, 0.08, { type: 'sine', gain: 0.08 }),
  right: () => { tone(659, 0, 0.12, { type: 'triangle' }); tone(988, 0.1, 0.3, { type: 'triangle' }); },
  wrong: () => tone(220, 0, 0.35, { type: 'sawtooth', gain: 0.05, slide: 0.7 }),
  reveal: () => tone(392, 0, 0.3, { type: 'triangle', slide: 1.5 }),
  fanfare: () => [523, 659, 784, 1047, 784, 1047].forEach((f, i) => tone(f, i * 0.13, i === 5 ? 0.6 : 0.16, { type: 'triangle', gain: 0.1 })),
};

export function play(name) {
  if (!soundOn || !audio || audio.state !== 'running') return;
  try { SOUNDS[name]?.(); } catch {}
}
