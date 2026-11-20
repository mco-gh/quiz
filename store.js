// Settings and the host's quizzes live in this browser's localStorage and
// nowhere else. If storage is blocked the app still works for the visit.
import { SAMPLES } from './samples.js';

const SETTINGS = 'quiz.settings.v1';
const QUIZZES = 'quiz.quizzes.v1';

const DEFAULTS = Object.freeze({
  name: '',
  avatar: '',
  lang: '',            // interface language; empty means "guess from the browser"
  apiKey: '',
  sound: true,
  // The host's last choices, offered again next time.
  mode: 'live',        // 'live' (everyone together) or 'self' (each at their own pace)
  seconds: 20,
  shuffleQ: false,
  shuffleA: false,
  difficulty: 'medium',
  count: 10,
  check: true,
});

const read = (key) => { try { return JSON.parse(localStorage.getItem(key)); } catch { return null; } };
const write = (key, value) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch {} };

export function loadSettings() {
  const saved = read(SETTINGS) ?? {};
  const s = { ...DEFAULTS };
  for (const k of Object.keys(DEFAULTS)) if (typeof saved[k] === typeof DEFAULTS[k]) s[k] = saved[k];
  return s;
}
export const saveSettings = (settings) => write(SETTINGS, settings);

export function clearAll() {
  try { localStorage.removeItem(SETTINGS); localStorage.removeItem(QUIZZES); } catch {}
  return { ...DEFAULTS };
}

// ── Quizzes ──
// { id, title, emoji, topic, difficulty, lang, questions: [{ q, a: [4], c, flag? }], updated }

/** Only keep what a quiz should contain, whatever was stored or imported. */
export function sanitize(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const text = (s, max) => String(s ?? '').trim().slice(0, max);
  const questions = (Array.isArray(raw.questions) ? raw.questions : []).map((q) => {
    const a = (Array.isArray(q?.a) ? q.a : []).slice(0, 4).map((s) => text(s, 120));
    const c = Number(q?.c);
    if (!text(q?.q, 300) || a.length !== 4 || a.some((s) => !s) || !(c >= 0 && c < 4)) return null;
    return { q: text(q.q, 300), a, c: Math.floor(c), ...(q.flag ? { flag: true } : {}) };
  }).filter(Boolean).slice(0, 50);
  return {
    id: typeof raw.id === 'string' && raw.id ? raw.id.slice(0, 64) : crypto.randomUUID(),
    title: text(raw.title, 60) || '…',
    emoji: [...text(raw.emoji, 16)].slice(0, 2).join('') || '❓',
    topic: text(raw.topic, 120),
    difficulty: ['easy', 'medium', 'hard'].includes(raw.difficulty) ? raw.difficulty : 'medium',
    lang: ['en', 'fr', 'es', 'de'].includes(raw.lang) ? raw.lang : 'en',
    questions,
    updated: Number(raw.updated) || Date.now(),
  };
}

export function loadQuizzes(uiLang) {
  const saved = read(QUIZZES);
  if (Array.isArray(saved)) return saved.map(sanitize).filter(Boolean);
  // First visit: start with a sample in the visitor's language, so there's
  // something to host straight away, even without an API key.
  const sample = SAMPLES[uiLang] ?? SAMPLES.en;
  const quizzes = [sanitize({ ...sample, id: crypto.randomUUID(), updated: Date.now() })];
  write(QUIZZES, quizzes);
  return quizzes;
}

export const saveQuizzes = (quizzes) => write(QUIZZES, quizzes);
