// The host's browser is the game server. It keeps the questions and answers,
// the clock and the scores, and tells each player only what they need: a
// question without its answer, then whether they got it right. Players are
// timed by the host's own clock, so a tampered phone can't claim a faster
// answer or peek at the right one.
import { hostRoom, newCode } from './net.js';
import { t, ordinal } from './languages/index.js';
import { $, h, showPhase, showScreen, toast, confirmAction, LETTERS, num, qCount, qrSvg, AVATARS } from './ui.js';
import { confetti, countUp, play, swap } from './fx.js';

const POINTS_MIN = 500;           // a right answer at the last moment
const POINTS_MAX = 1000;          // a right answer straight away
const STREAK_STEP = 50;           // bonus per answer in a row after the first…
const STREAK_MAX = 250;           // …up to this much
const GRACE = 700;                // ms allowed for an answer still on its way when time runs out
const COUNTDOWN = 3;

let game = null;

const shuffle = (list) => {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

const players = () => [...game.players.values()];
const connected = () => players().filter((p) => p.connected);
const limitMs = () => game.opts.seconds * 1000;
const total = () => game.order.length;

function points(ms, streak) {
  const left = Math.max(0, 1 - ms / limitMs());
  const bonus = Math.min(STREAK_MAX, Math.max(0, streak - 1) * STREAK_STEP);
  return Math.round(POINTS_MIN + (POINTS_MAX - POINTS_MIN) * left) + bonus;
}

/** Rank everyone by score; equal scores share a place. */
function rankAll() {
  const sorted = players().sort((a, b) => b.score - a.score || a.seq - b.seq);
  sorted.forEach((p, i) => {
    p.prevRank = p.rank ?? i + 1;
    p.rank = i > 0 && sorted[i - 1].score === p.score ? sorted[i - 1].rank : i + 1;
  });
  return sorted;
}

const brief = (p) => ({ name: p.name, avatar: p.avatar, score: p.score });

// The question as players see it: no correct answer.
function questionFor(pos, startedAt) {
  const question = game.quiz.questions[game.order[pos]];
  const perm = game.perms[pos];
  return {
    t: 'question', n: pos + 1, of: total(), q: question.q, a: perm.map((i) => question.a[i]),
    seconds: game.opts.seconds, startedAt, lang: game.quiz.lang,
  };
}
const correctShown = (pos) => game.perms[pos].indexOf(game.quiz.questions[game.order[pos]].c);

/** Send a message to a player and remember it, to resend if they reconnect. */
function tell(p, message) {
  p.last = message;
  game.room.send(p.id, refresh(message));
}
// A question resent later carries the time left, not the time it started.
function refresh(message) {
  if (message.t !== 'question') return message;
  const { startedAt, ...rest } = message;
  return { ...rest, left: Math.max(0, startedAt + limitMs() - Date.now()) };
}

// ── Opening and closing the room ───────────────────────────────────────────

export function startHosting({ quiz, opts, onExit }) {
  const order = quiz.questions.map((_, i) => i);
  game = {
    quiz, opts, onExit,
    code: newCode(),
    order: opts.shuffleQ ? shuffle(order) : order,
    perms: [],
    players: new Map(),
    banned: new Set(),
    seq: 0,
    phase: 'opening',
    pos: -1,
    cur: null,
    timers: new Set(),
  };
  game.perms = game.order.map(() => (opts.shuffleA ? shuffle([0, 1, 2, 3]) : [0, 1, 2, 3]));
  open();
}

function open() {
  game.room = hostRoom({
    code: game.code,
    on: {
      ready: () => {
        if (game.phase !== 'opening') return;
        renderJoinInfo();
        if (game.opts.mode === 'self') { game.phase = 'dash'; showDash(); }
        else { game.phase = 'lobby'; showLobby(); }
      },
      join: onJoin,
      message: onMessage,
      leave: onLeave,
      ended: (reason) => {
        if (reason === 'taken' && game.phase === 'opening') { game.code = newCode(); return open(); }
        if (game.phase === 'opening') {
          toast(t(`err.${reason}`));
          return exit();
        }
        toast(t('host.lost'));
      },
    },
  });
  $('stage-name').textContent = game.quiz.title;
  $('stage-emoji').textContent = game.quiz.emoji;
  $('stage-code').textContent = game.code.toUpperCase();
  updateCount();
  addEventListener('beforeunload', guardUnload);
}

function guardUnload(event) {
  if (game && players().length) event.preventDefault();
}

function later(fn, ms) {
  if (!game) return 0;
  const id = setTimeout(() => { if (!game) return; game.timers.delete(id); fn(); }, ms);
  game.timers.add(id);
  return id;
}
function clearTimers() {
  for (const id of game.timers) clearTimeout(id);
  game.timers.clear();
  clearInterval(game.ticker);
  for (const p of players()) clearTimeout(p.timer);
}

function exit() {
  if (!game) return;
  clearTimers();
  removeEventListener('beforeunload', guardUnload);
  game.room?.close({ t: 'closed' });
  const { onExit } = game;
  game = null;
  onExit?.();
}

export async function endGame() {
  if (!game) return;
  if (players().length && !(await confirmAction({ title: t('end.title'), text: t('end.text'), yes: t('end.yes') }))) return;
  exit();
}

const joinUrl = () => `${location.origin}${location.pathname}#${game.code}`;
const shortUrl = () => `${location.host}${location.pathname}`.replace(/\/$/, '');

function renderJoinInfo() {
  for (const id of ['lobby-url', 'dash-url']) $(id).textContent = shortUrl();
  for (const id of ['lobby-code', 'dash-code']) $(id).textContent = game.code.toUpperCase();
  for (const id of ['qr', 'qr-dash']) {
    const svg = qrSvg(joinUrl());
    $(id).replaceChildren(...(svg ? [svg] : []));
  }
}

export async function copyJoinLink() {
  const tip = $('copy-tip');
  let ok = true;
  try { await navigator.clipboard.writeText(joinUrl()); } catch { ok = false; }
  tip.textContent = t(ok ? 'copied' : 'copyFailed');
  tip.classList.add('show');
  setTimeout(() => tip.classList.remove('show'), 1800);
}

// ── Players coming and going ───────────────────────────────────────────────

function cleanName(raw, id) {
  let name = String(raw ?? '').replace(/\s+/g, ' ').trim().slice(0, 20) || t('player');
  const taken = (n) => players().some((p) => p.id !== id && p.name.toLowerCase() === n.toLowerCase());
  if (taken(name)) {
    let k = 2;
    while (taken(`${name} ${k}`)) k++;
    name = `${name} ${k}`;
  }
  return name;
}

function onJoin(id, hello) {
  if (!game || game.phase === 'opening') return;
  if (game.banned.has(id)) return game.room.kick(id, { t: 'kicked' });
  let p = game.players.get(id);
  const back = Boolean(p);
  if (!p) {
    p = { id, seq: ++game.seq, score: 0, streak: 0, connected: true, correct: 0, last: null };
    game.players.set(id, p);
  }
  p.connected = true;
  p.name = cleanName(hello.name, id);
  p.avatar = AVATARS.includes(hello.avatar) ? hello.avatar : AVATARS[p.seq % AVATARS.length];
  game.room.send(id, { t: 'welcome', name: p.name, avatar: p.avatar, score: p.score, title: game.quiz.title, emoji: game.quiz.emoji, mode: game.opts.mode, started: !['lobby', 'dash'].includes(game.phase) });

  if (back && p.last) {
    // Back after a dropped link or a reload: pick up where they were.
    if (p.last.t === 'question' && game.opts.mode === 'live' && game.cur?.answers.has(id)) game.room.send(id, { t: 'locked' });
    else if (p.last.t === 'question' && game.opts.mode === 'self' && p.q?.closed) selfClose(p);
    else game.room.send(id, refresh(p.last));
  } else if (game.opts.mode === 'self') {
    if (!p.started) startSelf(p);
  } else if (game.phase === 'question') {
    tell(p, questionFor(game.pos, game.cur.startedAt));
  }
  play('pop');
  updateCount();
  if (game.phase === 'lobby') renderLobby();
  if (game.phase === 'dash') renderDash();
}

function onLeave(id) {
  const p = game?.players.get(id);
  if (!p) return;
  p.connected = false;
  if (game.phase === 'lobby') game.players.delete(id);
  updateCount();
  if (game.phase === 'lobby') renderLobby();
  if (game.phase === 'dash') renderDash();
  if (game.phase === 'question' && game.opts.mode === 'live') maybeAllIn();
}

function kick(id) {
  const p = game.players.get(id);
  if (!p) return;
  game.banned.add(id);
  game.room.kick(id, { t: 'kicked' });
  game.players.delete(id);
  toast(t('lobby.kicked', { name: p.name }));
  updateCount();
  renderLobby();
}

function updateCount() {
  $('stage-count').textContent = num(connected().length);
}

function onMessage(id, message) {
  const p = game?.players.get(id);
  if (!p) return;
  if (message.t === 'answer') {
    if (game.opts.mode === 'live') liveAnswer(p, message);
    else selfAnswer(p, message);
  } else if (message.t === 'next' && game.opts.mode === 'self') {
    selfNext(p);
  }
}

// ── Lobby (live) ───────────────────────────────────────────────────────────

function showLobby() {
  showPhase('stage', 'h-lobby', 'lobby-heading', renderLobby);
}

function renderLobby() {
  const list = players();
  $('lobby-count').textContent = num(list.length);
  $('lobby-waiting').hidden = list.length > 0;
  $('lobby-kick-help').hidden = list.length === 0;
  $('start-game').disabled = list.length === 0;
  const chips = $('lobby-players');
  // Keep existing chips so only newcomers animate in.
  const have = new Map([...chips.children].map((li) => [li.dataset.id, li]));
  for (const [id, li] of have) if (!game.players.has(id)) li.remove();
  for (const p of list) {
    if (have.has(p.id)) { have.get(p.id).querySelector('.name').textContent = p.name; continue; }
    const button = h('button', { type: 'button', className: 'player-chip', title: t('lobby.kick', { name: p.name }) },
      h('span', { className: 'avatar', 'aria-hidden': 'true' }, p.avatar), h('span', { className: 'name' }, p.name));
    button.addEventListener('click', () => kick(p.id));
    chips.append(h('li', { dataset: { id: p.id } }, button));
  }
}

export function startGame() {
  if (!game || game.phase !== 'lobby' || !players().length) return;
  game.phase = 'countdown';
  rankAll();
  for (const p of players()) tell(p, { t: 'countdown', title: game.quiz.title, emoji: game.quiz.emoji });
  runCountdown('h-count', 'h-count-num', 'h-count-title', `${game.quiz.emoji} ${game.quiz.title}`, () => ask(0));
}

function runCountdown(phaseId, numId, titleId, title, done) {
  let n = COUNTDOWN;
  showPhase('stage', phaseId, null, () => {
    $(titleId).textContent = title;
    $(numId).textContent = num(n);
  });
  play('count');
  const step = () => {
    n--;
    if (n === 0) { play('go'); return done(); }
    $(numId).textContent = num(n);
    $(numId).classList.remove('pop');
    void $(numId).offsetWidth;   // restart the pop animation
    $(numId).classList.add('pop');
    play('count');
    later(step, 1000);
  };
  later(step, 1000);
}

// ── Questions (live) ───────────────────────────────────────────────────────

function ask(pos) {
  game.phase = 'question';
  game.pos = pos;
  const startedAt = Date.now();
  game.cur = { startedAt, answers: new Map() };
  const message = questionFor(pos, startedAt);
  for (const p of players()) {
    if (p.connected) tell(p, message);
    else p.last = message;
  }
  showPhase('stage', 'h-question', 'h-q-text', () => renderQuestion(message));
  startClock(startedAt);
  later(closeQuestion, limitMs() + GRACE);
}

function renderQuestion(message) {
  const stage = $('h-question');
  stage.dataset.state = 'asking';
  stage.lang = message.lang;
  $('h-q-num').textContent = qCount(message.n, message.of);
  $('h-q-text').textContent = message.q;
  $('h-answered').textContent = '0';
  $('h-skip').hidden = false;
  $('h-next').hidden = true;
  $('h-tiles').replaceChildren(...message.a.map((answer, i) =>
    h('li', { className: `tile c${i}` },
      h('span', { className: 'letter', 'aria-hidden': 'true' }, LETTERS[i]),
      h('span', { className: 'text' }, answer),
      h('span', { className: 'votes' }, h('i'), h('b')))));
}

function startClock(startedAt) {
  const fill = $('h-timer-fill');
  const text = $('h-timer-text');
  const timer = $('h-timer');
  fill.style.animation = 'none';
  void fill.getBoundingClientRect();
  fill.style.animation = '';
  fill.style.animationDuration = `${game.opts.seconds}s`;
  timer.classList.remove('hurry');
  let lastShown = null;
  const tick = () => {
    const left = Math.max(0, Math.ceil((startedAt + limitMs() - Date.now()) / 1000));
    if (left === lastShown) return;
    lastShown = left;
    text.textContent = num(left);
    timer.setAttribute('aria-label', t('stage.left', { n: left }));
    if (left <= 5 && left > 0) { timer.classList.add('hurry'); play('tick'); }
    if (left === 0) clearInterval(game.ticker);
  };
  clearInterval(game.ticker);
  tick();
  game.ticker = setInterval(tick, 200);
}

function liveAnswer(p, message) {
  if (game.phase !== 'question' || message.n !== game.pos + 1 || game.cur.answers.has(p.id)) return;
  const choice = Number(message.choice);
  if (!(choice >= 0 && choice < 4)) return;
  const ms = Date.now() - game.cur.startedAt;
  if (ms > limitMs() + GRACE) return;
  game.cur.answers.set(p.id, { choice: Math.floor(choice), ms: Math.min(ms, limitMs()) });
  game.room.send(p.id, { t: 'locked' });
  $('h-answered').textContent = num(game.cur.answers.size);
  play('lock');
  maybeAllIn();
}

function maybeAllIn() {
  const waiting = connected().filter((p) => !game.cur.answers.has(p.id));
  if (!waiting.length && game.cur.answers.size) later(closeQuestion, 500);
}

/** Time's up (or everyone answered, or the host stopped the clock). */
export function closeQuestion() {
  if (!game || game.phase !== 'question') return;
  game.phase = 'reveal';
  clearTimers();
  const pos = game.pos;
  const correct = correctShown(pos);
  const counts = [0, 0, 0, 0];
  for (const p of players()) {
    const answer = game.cur.answers.get(p.id);
    if (answer) counts[answer.choice]++;
    const right = answer?.choice === correct;
    p.streak = right ? p.streak + 1 : 0;
    p.gained = right ? points(answer.ms, p.streak) : 0;
    p.score += p.gained;
    if (right) p.correct++;
    p.choice = answer?.choice ?? null;
  }
  const ranked = rankAll();
  const last = pos === total() - 1;
  const correctText = game.quiz.questions[game.order[pos]].a[game.quiz.questions[game.order[pos]].c];
  for (const p of ranked) {
    const message = {
      t: 'result', n: pos + 1, of: total(), right: p.choice === correct, answered: p.choice !== null,
      gained: p.gained, score: p.score, streak: p.streak, rank: p.rank, players: ranked.length,
      correct, correctText, last,
    };
    if (p.connected) tell(p, message); else p.last = message;
  }
  renderReveal(counts, correct, last);
  play('reveal');
}

function renderReveal(counts, correct, last) {
  const stage = $('h-question');
  const most = Math.max(1, ...counts);
  swap(() => {
    stage.dataset.state = 'reveal';
    [...$('h-tiles').children].forEach((li, i) => {
      li.dataset.result = i === correct ? 'right' : 'wrong';
      li.style.setProperty('--share', counts[i] / most);
      li.querySelector('.votes b').textContent = num(counts[i]);
      li.querySelector('.votes').setAttribute('aria-label', t('stage.votes', { n: counts[i] }));
    });
    $('h-timer-text').textContent = '✓';
    $('h-skip').hidden = true;
    $('h-next').hidden = false;
    $('h-next-label').textContent = t(last ? 'stage.final' : 'stage.board');
  }, $('h-next'));
}

export function afterReveal() {
  if (!game || game.phase !== 'reveal') return;
  if (game.pos === total() - 1) finish();
  else showBoard();
}

// ── Leaderboard (live) ─────────────────────────────────────────────────────

function rankRow(p, { gain = true } = {}) {
  return h('li', { className: 'rank-row', style: { viewTransitionName: `p${p.seq}` }, dataset: { connected: String(p.connected) } },
    h('span', { className: 'place' }, num(p.rank)),
    h('span', { className: 'avatar', 'aria-hidden': 'true' }, p.avatar),
    h('span', { className: 'name' }, p.name),
    gain && p.gained ? h('span', { className: 'plus' }, `+${num(p.gained)}`) : null,
    gain && p.streak >= 2 ? h('span', { className: 'fire', title: t('streak', { n: p.streak }) }, `🔥${num(p.streak)}`) : null,
    h('b', { className: 'pts' }, num(p.score)));
}

function showBoard() {
  game.phase = 'board';
  const ranked = rankAll();
  // rankAll() moved prevRank along; take the order from before this question.
  const before = [...ranked].sort((a, b) => (a.prevRank - b.prevRank) || (a.seq - b.seq));
  const top = (list) => list.slice(0, 5);
  for (const p of ranked) {
    const ahead = ranked.find((q) => q.rank === p.rank - 1) ?? ranked.filter((q) => q.score > p.score).at(-1);
    const message = { t: 'board', rank: p.rank, score: p.score, players: ranked.length, behind: ahead ? { name: ahead.name, by: ahead.score - p.score } : null };
    if (p.connected) tell(p, message); else p.last = message;
  }
  showPhase('stage', 'h-board', 'h-board-title', () => {
    $('h-ranking').replaceChildren(...top(before).map((p) => rankRow({ ...p, rank: p.prevRank, score: p.score - p.gained }, { gain: false })));
    $('h-board-next').querySelector('span').textContent = t('board.next');
  }).then(() => later(() => {
    swap(() => $('h-ranking').replaceChildren(...top(ranked).map((p) => rankRow(p))));
    for (const [i, li] of [...$('h-ranking').children].entries()) {
      const p = top(ranked)[i];
      countUp(li.querySelector('.pts'), p.score - p.gained, p.score, num);
    }
  }, 500));
}

export function nextQuestion() {
  if (!game || game.phase !== 'board') return;
  ask(game.pos + 1);
}

// ── The end ────────────────────────────────────────────────────────────────

function finish() {
  game.phase = 'final';
  clearTimers();
  const ranked = rankAll();
  const podium = ranked.slice(0, 3).map(brief);
  for (const p of ranked) {
    const message = { t: 'final', rank: p.rank, score: p.score, players: ranked.length, correct: p.correct, of: total(), podium };
    if (p.connected) tell(p, message); else p.last = message;
  }
  showPhase('stage', 'h-final', 'h-final-title', () => {
    // Second place on the left, the winner in the middle, third on the right.
    const order = [ranked[1], ranked[0], ranked[2]];
    $('h-podium').replaceChildren(...order.map((p, i) => p
      ? h('li', { className: `step s${[2, 1, 3][i]}` },
        h('span', { className: 'avatar', 'aria-hidden': 'true' }, p.avatar),
        h('span', { className: 'name' }, p.name),
        h('b', { className: 'pts' }, num(p.score)),
        h('span', { className: 'block' }, ordinal(p.rank)))
      : h('li', { className: 'step empty', 'aria-hidden': 'true' })));
    $('h-final-list').replaceChildren(...ranked.slice(3).map((p) => rankRow(p, { gain: false })));
    $('h-final-list').hidden = ranked.length <= 3;
  }).then(() => { confetti(); play('fanfare'); later(() => confetti(120), 1400); });
}

export function playAgain() {
  if (!game) return;
  clearTimers();
  for (const [id, p] of game.players) if (!p.connected) game.players.delete(id);
  for (const p of players()) Object.assign(p, { score: 0, streak: 0, gained: 0, correct: 0, rank: undefined, prevRank: undefined, started: false, done: false, q: null, last: null });
  if (game.opts.shuffleQ) game.order = shuffle(game.order);
  game.perms = game.order.map(() => (game.opts.shuffleA ? shuffle([0, 1, 2, 3]) : [0, 1, 2, 3]));
  game.pos = -1;
  game.cur = null;
  if (game.opts.mode === 'self') {
    game.phase = 'dash';
    showDash();
    for (const p of connected()) {
      game.room.send(p.id, { t: 'welcome', name: p.name, avatar: p.avatar, score: 0, title: game.quiz.title, emoji: game.quiz.emoji, mode: 'self', started: false });
      startSelf(p);
    }
  } else {
    game.phase = 'lobby';
    for (const p of connected()) game.room.send(p.id, { t: 'welcome', name: p.name, avatar: p.avatar, score: 0, title: game.quiz.title, emoji: game.quiz.emoji, mode: 'live', started: false });
    showLobby();
  }
}

export const closeRoom = exit;

// ── At their own pace ──────────────────────────────────────────────────────
// Each player gets their own clock and moves on when they tap Next. The
// host's screen shows everyone's progress and a live leaderboard.

function showDash() {
  showPhase('stage', 'h-dash', 'h-dash-title', renderDash);
}

function renderDash() {
  if (game.phase !== 'dash') return;
  const ranked = rankAll();
  $('dash-waiting').hidden = ranked.length > 0;
  $('h-dash-end').disabled = ranked.length === 0;
  const rows = ranked.map((p) => {
    const row = rankRow(p, { gain: false });
    const answered = p.done ? total() : (p.pos ?? 0) + (p.q?.closed ? 1 : 0);
    row.append(h('span', { className: 'progress', style: { '--done': answered / total() }, role: 'img', 'aria-label': t('dash.progress', { n: answered, of: total() }) },
      h('i'), p.done ? h('span', { className: 'flag' }, '🏁') : null));
    return row;
  });
  swap(() => $('h-dash-list').replaceChildren(...rows));
}

function startSelf(p) {
  p.started = true;
  p.pos = 0;
  tell(p, { t: 'countdown', title: game.quiz.title, emoji: game.quiz.emoji });
  p.timer = setTimeout(() => { if (game) selfAsk(p, 0); }, COUNTDOWN * 1000);
}

function selfAsk(p, pos) {
  clearTimeout(p.timer);
  p.pos = pos;
  const startedAt = Date.now();
  p.q = { startedAt, closed: false, choice: null, ms: 0 };
  tell(p, questionFor(pos, startedAt));
  p.timer = setTimeout(() => { if (game) selfClose(p); }, limitMs() + GRACE);
  renderDash();
}

function selfAnswer(p, message) {
  if (!p.q || p.q.closed || message.n !== p.pos + 1) return;
  const choice = Number(message.choice);
  if (!(choice >= 0 && choice < 4)) return;
  const ms = Date.now() - p.q.startedAt;
  if (ms > limitMs() + GRACE) return;
  p.q.choice = Math.floor(choice);
  p.q.ms = Math.min(ms, limitMs());
  selfClose(p);
}

function selfClose(p) {
  clearTimeout(p.timer);
  const correct = correctShown(p.pos);
  if (!p.q.closed) {
    p.q.closed = true;
    const right = p.q.choice === correct;
    p.streak = right ? p.streak + 1 : 0;
    p.gained = right ? points(p.q.ms, p.streak) : 0;
    p.score += p.gained;
    if (right) p.correct++;
  }
  const ranked = rankAll();
  const question = game.quiz.questions[game.order[p.pos]];
  tell(p, {
    t: 'result', n: p.pos + 1, of: total(), right: p.q.choice === correct, answered: p.q.choice !== null,
    gained: p.gained, score: p.score, streak: p.streak, rank: p.rank, players: ranked.length,
    correct, correctText: question.a[question.c], last: p.pos === total() - 1, self: true,
  });
  play(p.q.choice === correct ? 'right' : 'lock');
  renderDash();
}

function selfNext(p) {
  if (!p.q?.closed || p.done) return;
  if (p.pos + 1 < total()) return selfAsk(p, p.pos + 1);
  p.done = true;
  const ranked = rankAll();
  tell(p, { t: 'final', rank: p.rank, score: p.score, players: ranked.length, correct: p.correct, of: total(), podium: null, waiting: true });
  renderDash();
}

export function finishSelf() {
  if (!game || game.phase !== 'dash') return;
  for (const p of players()) clearTimeout(p.timer);
  finish();
}
