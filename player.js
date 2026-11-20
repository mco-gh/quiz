// A player's phone. It knows nothing about the quiz except what the host
// sends: one question at a time without its answer, then how they did.
import { joinRoom } from './net.js';
import { t, ordinal } from './languages/index.js';
import { $, h, showPhase, LETTERS, num, qCount } from './ui.js';
import { confetti, countUp, play } from './fx.js';

let link = null;
let me = null;          // { code, name, avatar, score, onExit }
let finished = false;   // the host closed the room or removed us: no reconnecting
let current = null;     // the question on screen: { n, answered, timer }
let countTimer = 0;

export function joinGame({ code, name, avatar, onExit }) {
  me = { code, name, avatar, score: 0, onExit };
  connect();
}

function connect() {
  finished = false;
  link?.close();
  showEnded(null);
  $('me-name').textContent = me.name;
  $('me-avatar').textContent = me.avatar;
  $('me-score').textContent = num(me.score);
  showPhase('play', 'p-wait', 'p-wait-title', () => {
    $('p-wait-avatar').textContent = me.avatar;
    $('p-wait-title').textContent = t('p.connecting');
    $('p-wait-quiz').textContent = '';
    $('p-wait-text').textContent = t('p.connectingHelp');
  });
  link = joinRoom({
    code: me.code,
    hello: { name: me.name, avatar: me.avatar },
    on: { message: onMessage, ended: onEnded },
  });
}

export function leaveGame() {
  finished = true;
  clearTimeout(countTimer);
  link?.close();
  link = null;
  const exit = me?.onExit;
  me = null;
  exit?.();
}

export const rejoin = () => { if (me) connect(); };

function onEnded(reason) {
  if (finished || !me) return;
  clearTimeout(countTimer);
  showEnded(reason === 'noroom' ? 'noroom' : 'lost');
}

function showEnded(kind) {
  if (!kind) return;
  const titles = { noroom: 'p.noroom', lost: 'p.lost', closed: 'p.closed', kicked: 'p.kicked' };
  showPhase('play', 'p-ended', 'p-ended-title', () => {
    $('p-ended-title').textContent = t(titles[kind]);
    $('p-ended-help').textContent = t(`${titles[kind]}Help`);
    $('p-rejoin').hidden = kind === 'closed' || kind === 'kicked';
  });
}

function setScore(score) {
  if (score === me.score) return;
  countUp($('me-score'), me.score, score, num);
  me.score = score;
}

function onMessage(message) {
  if (!me) return;
  switch (message.t) {
    case 'welcome': return welcome(message);
    case 'countdown': return countdown(message);
    case 'question': return question(message);
    case 'locked': return locked();
    case 'result': return result(message);
    case 'board': return board(message);
    case 'final': return final(message);
    case 'closed':
    case 'kicked':
      finished = true;
      clearTimeout(countTimer);
      return showEnded(message.t);
    default:
  }
}

function welcome(message) {
  me.name = message.name;
  me.avatar = message.avatar;
  me.mode = message.mode;
  me.title = `${message.emoji} ${message.title}`;
  $('me-name').textContent = me.name;
  $('me-avatar').textContent = me.avatar;
  me.score = message.score;
  $('me-score').textContent = num(me.score);
  play('pop');
  const text = message.mode === 'self' ? 'p.waitSelf' : message.started ? 'p.waitNext' : 'p.waitHost';
  showPhase('play', 'p-wait', 'p-wait-title', () => {
    $('p-wait-avatar').textContent = me.avatar;
    $('p-wait-title').textContent = t('p.in');
    $('p-wait-quiz').textContent = me.title;
    $('p-wait-text').textContent = t(text);
  });
}

function countdown(message) {
  clearTimeout(countTimer);
  let n = 3;
  showPhase('play', 'p-count', null, () => {
    $('p-count-title').textContent = `${message.emoji} ${message.title}`;
    $('p-count-num').textContent = num(n);
  });
  play('count');
  const step = () => {
    n--;
    if (n === 0) return;
    const el = $('p-count-num');
    el.textContent = num(n);
    el.classList.remove('pop');
    void el.offsetWidth;
    el.classList.add('pop');
    play('count');
    countTimer = setTimeout(step, 1000);
  };
  countTimer = setTimeout(step, 1000);
}

function question(message) {
  clearTimeout(countTimer);
  clearTimeout(current?.timer);
  const left = Math.max(0, Number(message.left) || 0);
  current = { n: message.n, answered: false };
  play('go');
  showPhase('play', 'p-question', 'p-q-text', () => {
    $('p-question').lang = message.lang;
    $('p-q-num').textContent = qCount(message.n, message.of);
    $('p-q-text').textContent = message.q;
    $('p-tiles').setAttribute('aria-label', message.q);
    $('p-tiles').replaceChildren(...message.a.map((answer, i) => {
      const button = h('button', { type: 'button', className: `tile c${i}` },
        h('span', { className: 'letter', 'aria-hidden': 'true' }, LETTERS[i]),
        h('span', { className: 'text' }, answer));
      button.addEventListener('click', () => answer_(i, button));
      return button;
    }));
    const bar = $('p-timer');
    bar.style.animation = 'none';
    void bar.offsetWidth;
    bar.style.animation = '';
    bar.style.animationDuration = `${message.seconds}s`;
    bar.style.animationDelay = `${-(message.seconds * 1000 - left)}ms`;
  });
  current.timer = setTimeout(() => {
    if (current?.n !== message.n || current.answered) return;
    current.answered = true;
    for (const b of $('p-tiles').children) b.disabled = true;
    showLocked(t('p.timeUp'), '⏰');
  }, left);
}

function answer_(choice, button) {
  if (!current || current.answered) return;
  current.answered = true;
  clearTimeout(current.timer);
  for (const b of $('p-tiles').children) {
    b.disabled = true;
    if (b !== button) b.dataset.dim = '';
  }
  button.dataset.picked = '';
  link?.send({ t: 'answer', n: current.n, choice });
  play('lock');
  // A moment to see the tap land before the screen changes.
  setTimeout(locked, 350);
}

function locked() {
  // Only while our answer is waiting for its result, and only once.
  if (!current?.answered || !$('p-locked').hidden) return;
  showLocked(t('p.locked'), '🤞');
}

function showLocked(title, emoji) {
  showPhase('play', 'p-locked', 'p-locked-title', () => {
    $('p-locked-title').textContent = title;
    $('p-locked').querySelector('.spin-emoji').textContent = emoji;
  });
}

function result(message) {
  clearTimeout(current?.timer);
  current = null;
  const right = message.right;
  showPhase('play', 'p-result', 'p-result-title', () => {
    const section = $('p-result');
    section.dataset.result = right ? 'right' : 'wrong';
    $('p-result-icon').textContent = right ? '✓' : message.answered ? '✗' : '⏰';
    $('p-result-title').textContent = t(right ? 'p.right' : message.answered ? 'p.wrong' : 'p.noAnswer');
    $('p-gain').textContent = right ? `+${num(message.gained)}` : '';
    $('p-gain').hidden = !right;
    $('p-streak').hidden = !(right && message.streak >= 2);
    $('p-streak').textContent = `🔥 ${t('streak', { n: num(message.streak) })}`;
    $('p-right').hidden = right;
    $('p-right').textContent = t('p.answerWas', { answer: `${LETTERS[message.correct]} · ${message.correctText}` });
    $('p-rank').textContent = t('p.place', { place: ordinal(message.rank), n: num(message.players) });
    $('p-next').hidden = !message.self;
    $('p-next').querySelector('span').textContent = t(message.last ? 'p.finish' : 'p.next');
  }).then(() => setScore(message.score));
  play(right ? 'right' : 'wrong');
  if (right) confetti(40);
  navigator.vibrate?.(right ? 30 : [60, 40, 60]);
}

export function nextSelf() {
  link?.send({ t: 'next' });
}

function board(message) {
  setScore(message.score);
  showPhase('play', 'p-board', 'p-board-title', () => {
    $('p-board-rank').textContent = ordinal(message.rank);
    $('p-board-title').textContent = message.rank === 1 ? t('p.leading') : t('p.place', { place: ordinal(message.rank), n: num(message.players) });
    $('p-board-help').textContent = message.behind
      ? t('p.behind', { n: num(message.behind.by), name: message.behind.name })
      : t('p.watch');
  });
}

function final(message) {
  setScore(message.score);
  const medal = ['🥇', '🥈', '🥉'][message.rank - 1] ?? '🎉';
  showPhase('play', 'p-final', 'p-final-title', () => {
    $('p-medal').textContent = medal;
    $('p-final-title').textContent = message.waiting
      ? t('p.doneSelf')
      : message.rank === 1 ? t('p.won') : t('p.place', { place: ordinal(message.rank), n: num(message.players) });
    $('p-final-score').textContent = t('p.finalScore', { score: num(message.score), right: num(message.correct), of: num(message.of) });
    $('p-podium').replaceChildren(...(message.podium ?? []).map((p, i) =>
      h('li', {}, h('span', { 'aria-hidden': 'true' }, ['🥇', '🥈', '🥉'][i]), h('span', { className: 'avatar', 'aria-hidden': 'true' }, p.avatar), h('span', { className: 'name' }, p.name), h('b', {}, num(p.score)))));
    $('p-podium').hidden = !message.podium?.length;
    $('p-final-help').textContent = message.waiting ? t('p.waitFinal', { place: ordinal(message.rank) }) : '';
    $('p-medal').hidden = Boolean(message.waiting);
  });
  if (!message.waiting) {
    play(message.rank <= 3 ? 'fanfare' : 'right');
    if (message.rank <= 3) confetti();
  }
}
