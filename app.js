// Quiz: the page controller. Wires the start screen, the host's library,
// quiz creation and editing, game options and settings to the pieces that do
// the work: host.js (the host's browser runs the game), player.js (a phone),
// net.js (the links between them) and ai.js (Claude writes the questions).
import { LANGUAGES, getLanguage, guessLanguage, setUiLanguage, t } from './languages/index.js';
import { loadSettings, saveSettings, clearAll, loadQuizzes, saveQuizzes, sanitize } from './store.js';
import { cleanCode, isFullCode } from './net.js';
import { $, h, showScreen, toast, showError, confirmAction, LETTERS, AVATARS, num } from './ui.js';
import { setSound, unlockAudio, play, swap } from './fx.js';
import * as host from './host.js';
import * as player from './player.js';

let settings = loadSettings();
if (!getLanguage(settings.lang)) settings.lang = guessLanguage().code;
let quizzes = loadQuizzes(settings.lang);
setSound(settings.sound);

const save = () => saveSettings(settings);
const hasKey = () => settings.apiKey.startsWith('sk-');
const codeFromUrl = () => cleanCode(decodeURIComponent(location.hash.slice(1)));
const TINTS = 6;
const tintOf = (id) => [...id].reduce((sum, ch) => sum + ch.charCodeAt(0), 0) % TINTS;
const plural = (key, n) => t(`${key}.${new Intl.PluralRules(settings.lang).select(n) === 'one' ? 'one' : 'other'}`, { n: num(n) });

// Browsers only allow sound after the person has tapped or typed something.
addEventListener('pointerdown', unlockAudio, { capture: true });
addEventListener('keydown', unlockAudio, { capture: true });

// ── Start screen and joining ───────────────────────────────────────────────

$('join-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const code = cleanCode($('join-code').value);
  if (!isFullCode(code)) {
    $('join-code').setCustomValidity(t('join.bad'));
    $('join-code').reportValidity();
    return;
  }
  location.hash = code;            // → showProfile() via hashchange
});
$('join-code').addEventListener('input', () => $('join-code').setCustomValidity(''));

function route() {
  const code = codeFromUrl();
  if (isFullCode(code)) showProfile(code);
  else showScreen('home');
}
addEventListener('hashchange', () => { if ($('play').hidden && $('stage').hidden) route(); });

function showProfile(code) {
  $('profile-code').textContent = code.toUpperCase();
  $('player-name').value = settings.name;
  if (!AVATARS.includes(settings.avatar)) settings.avatar = AVATARS[Math.floor(Math.random() * AVATARS.length)];
  $('avatars').replaceChildren(...AVATARS.map((emoji) => h('label', {},
    h('input', { type: 'radio', name: 'avatar', value: emoji, checked: emoji === settings.avatar }),
    h('span', { 'aria-hidden': 'true' }, emoji),
    h('span', { className: 'visually-hidden' }, emoji))));
  showError('profile-error', '');
  showScreen('profile', settings.name ? 'profile-go' : 'player-name');
}

$('avatars').addEventListener('change', (event) => { if (event.target.name === 'avatar') play('pop'); });

$('profile-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const name = $('player-name').value.replace(/\s+/g, ' ').trim();
  if (!name) return $('player-name').reportValidity();
  settings.name = name;
  settings.avatar = new FormData($('profile-form')).get('avatar') ?? settings.avatar;
  save();
  player.joinGame({
    code: codeFromUrl(), name, avatar: settings.avatar,
    onExit: () => { history.replaceState(null, '', location.pathname); showScreen('home'); },
  });
});

$('p-next').addEventListener('click', player.nextSelf);
$('p-leave').addEventListener('click', player.leaveGame);
$('p-home').addEventListener('click', player.leaveGame);
$('p-rejoin').addEventListener('click', player.rejoin);

for (const button of document.querySelectorAll('[data-back]')) {
  button.addEventListener('click', () => {
    if (button.dataset.back === 'home') history.replaceState(null, '', location.pathname);
    showScreen(button.dataset.back);
  });
}

// ── Library ────────────────────────────────────────────────────────────────

$('go-library').addEventListener('click', () => { renderLibrary(); showScreen('library'); });

function quizMeta(quiz) {
  return [plural('meta.questions', quiz.questions.length), t(`diff.${quiz.difficulty}`), getLanguage(quiz.lang)?.name].filter(Boolean).join(' · ');
}

function renderLibrary() {
  $('library-empty').hidden = quizzes.length > 0;
  const iconButton = (label, emoji, onClick) => {
    const b = h('button', { type: 'button', className: 'icon-btn small', title: label, 'aria-label': label }, h('span', { 'aria-hidden': 'true' }, emoji));
    b.addEventListener('click', onClick);
    return b;
  };
  $('quiz-grid').replaceChildren(...quizzes.map((quiz) => {
    const flags = quiz.questions.filter((q) => q.flag).length;
    const hostButton = h('button', { type: 'button', className: 'btn primary small' }, h('span', { 'aria-hidden': 'true' }, '▶'), t('library.host'));
    hostButton.addEventListener('click', () => openSetup(quiz));
    return h('li', { className: `quiz-card tint-${tintOf(quiz.id)}`, style: { viewTransitionName: `quiz-${quiz.id.replace(/[^a-z0-9]/gi, '')}` } },
      h('span', { className: 'quiz-emoji', 'aria-hidden': 'true' }, quiz.emoji),
      h('h2', {}, quiz.title),
      h('p', { className: 'help' }, quizMeta(quiz)),
      flags ? h('p', { className: 'flag-badge' }, `⚠️ ${plural('library.flags', flags)}`) : null,
      h('div', { className: 'card-actions' },
        hostButton,
        h('span', { className: 'spacer' }),
        iconButton(t('library.edit'), '✏️', () => openEditor(quiz, false)),
        iconButton(t('library.copy'), '📄', () => duplicate(quiz)),
        iconButton(t('library.export'), '📤', () => exportQuiz(quiz)),
        iconButton(t('library.delete'), '🗑️', () => removeQuiz(quiz))));
  }));
}

function storeQuiz(quiz) {
  const i = quizzes.findIndex((q) => q.id === quiz.id);
  quiz.updated = Date.now();
  if (i >= 0) quizzes[i] = quiz; else quizzes.unshift(quiz);
  saveQuizzes(quizzes);
}

function duplicate(quiz) {
  const copy = sanitize({ ...structuredClone(quiz), id: crypto.randomUUID(), title: t('library.copyOf', { title: quiz.title }).slice(0, 60) });
  const i = quizzes.indexOf(quiz);
  quizzes.splice(i + 1, 0, copy);
  saveQuizzes(quizzes);
  swap(renderLibrary);
}

function exportQuiz(quiz) {
  const { id, ...rest } = quiz;
  const blob = new Blob([JSON.stringify({ app: 'mco.dev/quiz', ...rest }, null, 2)], { type: 'application/json' });
  const slug = quiz.title.toLowerCase().normalize('NFD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'quiz';
  const a = h('a', { href: URL.createObjectURL(blob), download: `${slug}.quiz.json` });
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

async function removeQuiz(quiz) {
  if (!(await confirmAction({ title: t('delete.title', { title: quiz.title }), text: t('delete.text'), yes: t('library.delete') }))) return;
  quizzes = quizzes.filter((q) => q !== quiz);
  saveQuizzes(quizzes);
  swap(renderLibrary);
}

$('import-file').addEventListener('change', async (event) => {
  const file = event.target.files?.[0];
  event.target.value = '';
  if (!file) return;
  let added = 0;
  try {
    const data = JSON.parse(await file.text());
    for (const raw of Array.isArray(data) ? data : [data]) {
      const quiz = sanitize({ ...raw, id: crypto.randomUUID() });
      if (quiz?.questions.length) { quizzes.unshift(quiz); added++; }
    }
  } catch {}
  if (!added) return toast(t('import.bad'));
  saveQuizzes(quizzes);
  renderLibrary();
  toast(plural('import.done', added));
});

$('new-blank').addEventListener('click', () => openEditor(sanitize({
  title: '', emoji: '🎯', topic: '', difficulty: settings.difficulty, lang: settings.lang,
  questions: [],
}), true));

// ── Create with AI ─────────────────────────────────────────────────────────

let quizLang = settings.lang;

$('new-ai').addEventListener('click', () => {
  quizLang = settings.lang;
  renderCreate();
  showError('create-error', '');
  showScreen('create', 'topic');
});

function renderCreate() {
  for (const input of document.querySelectorAll('input[name="difficulty"]')) input.checked = input.value === settings.difficulty;
  $('count').value = settings.count;
  $('count-out').textContent = num(settings.count);
  $('check').checked = settings.check;
  $('quiz-lang').replaceChildren(...LANGUAGES.map((language) => h('label', {},
    h('input', { type: 'radio', name: 'quiz-lang', value: language.code, checked: language.code === quizLang }),
    h('span', { className: 'flag', 'aria-hidden': 'true' }, language.flag), language.name)));
  $('topic-ideas').setAttribute('aria-label', t('create.ideas'));
  $('topic-ideas').replaceChildren(...t('create.ideaList').split('|').map((idea) => {
    const b = h('button', { type: 'button', className: 'idea' }, idea);
    b.addEventListener('click', () => { $('topic').value = idea; $('topic').focus(); });
    return b;
  }));
  renderKeyPill();
}

function renderKeyPill() {
  $('key-pill').dataset.ready = String(hasKey());
  $('key-pill-text').textContent = t(hasKey() ? 'key.on' : 'key.off');
}

$('count').addEventListener('input', () => { $('count-out').textContent = num(Number($('count').value)); });
$('quiz-lang').addEventListener('change', (event) => { quizLang = event.target.value; });

function aiMessage(error) {
  console.warn(error);
  return t(`ai.${error?.kind ?? 'bad'}`);
}

$('create-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const topic = $('topic').value.trim();
  if (!topic) return $('topic').reportValidity();
  settings.difficulty = new FormData($('create-form')).get('difficulty') ?? 'medium';
  settings.count = Number($('count').value);
  settings.check = $('check').checked;
  save();
  if (!hasKey()) {
    showError('create-error', t('key.needed'));
    $('settings').showModal();
    return;
  }
  showError('create-error', '');
  const language = getLanguage(quizLang);
  setThinking(t('create.writing'));
  try {
    const { writeQuiz, checkQuiz } = await import('./ai.js');
    const written = await writeQuiz({ apiKey: settings.apiKey, topic, difficulty: settings.difficulty, count: settings.count, language: language.english });
    let flagged = [];
    if (settings.check) {
      setThinking(t('create.checking'));
      try { flagged = await checkQuiz({ apiKey: settings.apiKey, questions: written.questions }); } catch (error) { toast(aiMessage(error)); }
    }
    const quiz = sanitize({
      ...written, topic, difficulty: settings.difficulty, lang: quizLang,
      questions: written.questions.map((q, i) => ({ ...q, flag: flagged.includes(i) })),
    });
    setThinking(null);
    play('right');
    openEditor(quiz, true, settings.check ? flagged.length : null);
  } catch (error) {
    setThinking(null);
    showError('create-error', aiMessage(error));
  }
});

function setThinking(text) {
  $('thinking').hidden = !text;
  $('create-form').hidden = Boolean(text);
  if (text) $('thinking-text').textContent = text;
}

// ── Edit a quiz ────────────────────────────────────────────────────────────

let editing = null;   // { quiz, isNew, dirty }

function openEditor(quiz, isNew, checked = null) {
  editing = { quiz: structuredClone(quiz), isNew, dirty: isNew };
  $('quiz-title').value = quiz.title;
  $('quiz-emoji').value = quiz.emoji;
  $('editor-heading').textContent = t(isNew ? 'editor.new' : 'editor.title');
  const note = $('flag-note');
  if (checked === null) note.hidden = true;
  else {
    note.hidden = false;
    note.dataset.ok = String(checked === 0);
    note.textContent = checked === 0 ? t('editor.allGood') : plural('editor.flagged', checked);
  }
  if (!quiz.questions.length) quiz.questions.push(blankQuestion());
  renderQuestions(quiz.questions);
  showScreen('editor', isNew && !quiz.title ? 'quiz-title' : 'editor-heading');
}

const blankQuestion = () => ({ q: '', a: ['', '', '', ''], c: 0 });

function questionCard(question, index) {
  const name = `c-${index}-${Math.random().toString(36).slice(2, 7)}`;
  const replace = h('button', { type: 'button', className: 'btn small ghost', hidden: !(hasKey() && editing.quiz.topic) },
    h('span', { 'aria-hidden': 'true' }, '✨'), t('editor.replace'));
  const remove = h('button', { type: 'button', className: 'btn small ghost danger-text' }, h('span', { 'aria-hidden': 'true' }, '🗑️'), t('editor.remove'));
  const li = h('li', { className: 'q-card card', dataset: { flag: String(Boolean(question.flag)) } },
    h('div', { className: 'q-card-head' },
      h('span', { className: 'q-index' }, num(index + 1)),
      question.flag ? h('span', { className: 'flag-badge' }, `⚠️ ${t('editor.check')}`) : null,
      h('span', { className: 'spacer' }), replace, remove),
    h('label', { className: 'field' },
      h('span', { className: 'visually-hidden' }, t('editor.question')),
      h('textarea', { className: 'q-input', rows: 2, maxLength: 300, required: true, placeholder: t('editor.question'), value: question.q })),
    h('fieldset', { className: 'answers' },
      h('legend', { className: 'help' }, t('editor.pick')),
      ...question.a.map((answer, i) => h('div', { className: `answer-row c${i}` },
        h('label', { className: 'right-pick', title: t('editor.correct') },
          h('input', { type: 'radio', name, value: String(i), checked: i === question.c, required: true, 'aria-label': t('editor.correctN', { letter: LETTERS[i] }) }),
          h('span', { 'aria-hidden': 'true' }, LETTERS[i])),
        h('input', { type: 'text', className: 'a-input', maxLength: 120, required: true, value: answer, 'aria-label': t('editor.answerN', { letter: LETTERS[i] }), placeholder: t('editor.answerN', { letter: LETTERS[i] }) })))));
  remove.addEventListener('click', () => {
    const all = readQuestions();
    if (all.length <= 1) return toast(t('editor.needOne'));
    all.splice(index, 1);
    editing.dirty = true;
    swap(() => renderQuestions(all));
  });
  replace.addEventListener('click', () => replaceQuestion(index, replace));
  return li;
}

function renderQuestions(list) {
  $('questions').replaceChildren(...list.map(questionCard));
  $('add-ai').hidden = !(hasKey() && editing.quiz.topic);
}

function readQuestions() {
  return [...$('questions').children].map((li, index) => {
    const checked = li.querySelector('input[type="radio"]:checked');
    return {
      q: li.querySelector('.q-input').value.trim(),
      a: [...li.querySelectorAll('.a-input')].map((input) => input.value.trim()),
      c: checked ? Number(checked.value) : 0,
      flag: li.dataset.flag === 'true' && editing.quiz.questions[index]?.flag,
    };
  });
}

$('editor-form').addEventListener('input', (event) => {
  editing.dirty = true;
  // Editing a flagged question counts as checking it.
  const card = event.target.closest('.q-card');
  if (card?.dataset.flag === 'true') { card.dataset.flag = 'false'; card.querySelector('.flag-badge')?.remove(); }
});

async function aiQuestion(button) {
  const all = readQuestions();
  button.disabled = true;
  button.classList.add('busy');
  try {
    const { writeQuestion } = await import('./ai.js');
    return { all, fresh: await writeQuestion({ apiKey: settings.apiKey, topic: editing.quiz.topic, difficulty: editing.quiz.difficulty, language: getLanguage(editing.quiz.lang)?.english ?? 'English', avoid: all.map((q) => q.q).filter(Boolean) }) };
  } catch (error) {
    toast(aiMessage(error));
    return null;
  } finally {
    button.disabled = false;
    button.classList.remove('busy');
  }
}

async function replaceQuestion(index, button) {
  const got = await aiQuestion(button);
  if (!got) return;
  got.all[index] = got.fresh;
  editing.quiz.questions = got.all;
  editing.dirty = true;
  swap(() => renderQuestions(got.all));
}

$('add-ai').addEventListener('click', async () => {
  const got = await aiQuestion($('add-ai'));
  if (!got) return;
  got.all.push(got.fresh);
  editing.quiz.questions = got.all;
  editing.dirty = true;
  renderQuestions(got.all);
  $('questions').lastElementChild.scrollIntoView({ behavior: 'smooth', block: 'center' });
});

$('add-question').addEventListener('click', () => {
  const all = readQuestions();
  all.push(blankQuestion());
  editing.quiz.questions = all;
  renderQuestions(all);
  const last = $('questions').lastElementChild;
  last.scrollIntoView({ behavior: 'smooth', block: 'center' });
  last.querySelector('textarea').focus({ preventScroll: true });
});

$('editor-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const quiz = sanitize({
    ...editing.quiz,
    title: $('quiz-title').value,
    emoji: $('quiz-emoji').value,
    questions: readQuestions(),
  });
  storeQuiz(quiz);
  editing = null;
  renderLibrary();
  showScreen('library');
  toast(t('editor.saved'));
});

$('editor-back').addEventListener('click', async () => {
  if (editing?.dirty && !(await confirmAction({ title: t('editor.discard'), yes: t('editor.discardYes') }))) return;
  editing = null;
  renderLibrary();
  showScreen('library');
});

// ── Game options and hosting ───────────────────────────────────────────────

let hosting = null;   // the quiz chosen on the setup screen

function openSetup(quiz) {
  if (!quiz.questions.length) return openEditor(quiz, false);
  hosting = quiz;
  $('setup-emoji').textContent = quiz.emoji;
  $('setup-name').textContent = quiz.title;
  $('setup-meta').textContent = quizMeta(quiz);
  for (const input of document.querySelectorAll('input[name="mode"]')) input.checked = input.value === settings.mode;
  $('seconds').replaceChildren(...[10, 20, 30, 45, 60].map((s) => h('label', {},
    h('input', { type: 'radio', name: 'seconds', value: String(s), checked: s === settings.seconds }),
    t('setup.secondsN', { n: num(s) }))));
  $('shuffle-q').checked = settings.shuffleQ;
  $('shuffle-a').checked = settings.shuffleA;
  $('open-room').disabled = false;
  showError('setup-error', '');
  showScreen('setup', 'setup-heading');
}

$('setup-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const form = new FormData($('setup-form'));
  settings.mode = form.get('mode') === 'self' ? 'self' : 'live';
  settings.seconds = Number(form.get('seconds')) || 20;
  settings.shuffleQ = $('shuffle-q').checked;
  settings.shuffleA = $('shuffle-a').checked;
  save();
  $('open-room').disabled = true;
  syncSoundButton();
  host.startHosting({
    quiz: hosting,
    opts: { mode: settings.mode, seconds: settings.seconds, shuffleQ: settings.shuffleQ, shuffleA: settings.shuffleA },
    onExit: () => { renderLibrary(); showScreen('library'); },
  });
});

$('stage-end').addEventListener('click', host.endGame);
$('start-game').addEventListener('click', host.startGame);
$('h-skip').addEventListener('click', host.closeQuestion);
$('h-next').addEventListener('click', host.afterReveal);
$('h-board-next').addEventListener('click', host.nextQuestion);
$('h-again').addEventListener('click', host.playAgain);
$('h-done').addEventListener('click', host.closeRoom);
$('h-dash-end').addEventListener('click', host.finishSelf);
$('copy-link').addEventListener('click', host.copyJoinLink);

function syncSoundButton() {
  $('stage-sound').setAttribute('aria-pressed', String(settings.sound));
  $('sound-on').checked = settings.sound;
}
function setSoundOn(on) {
  settings.sound = on;
  setSound(on);
  save();
  syncSoundButton();
}
$('stage-sound').addEventListener('click', () => setSoundOn(!settings.sound));

// ── Settings ───────────────────────────────────────────────────────────────

function buildUiLanguagePicker() {
  $('ui-lang').replaceChildren(...LANGUAGES.map((language) => h('label', {},
    h('input', { type: 'radio', name: 'ui-lang', value: language.code, checked: language.code === settings.lang }),
    h('span', { className: 'flag', 'aria-hidden': 'true' }, language.flag), language.name)));
}

$('ui-lang').addEventListener('change', (event) => {
  settings.lang = event.target.value;
  save();
  applyLanguage();
});

function applyLanguage() {
  setUiLanguage(settings.lang);
  $('toggle-key').textContent = t($('api-key').type === 'password' ? 'settings.show' : 'settings.hide');
  renderLibrary();
  if (!$('create').hidden) renderCreate();
  renderKeyPill();
}

$('api-key').addEventListener('change', () => {
  const key = $('api-key').value.trim();
  if (key === settings.apiKey) return;
  settings.apiKey = key;
  save();
  renderKeyPill();
  if (key && !hasKey()) toast(t('key.odd'));
  if (editing) renderQuestions(readQuestions());
});
// "change" also fires when the dialog closes with the field focused, so Done and Esc both keep what was typed.
$('settings').addEventListener('close', () => $('api-key').dispatchEvent(new Event('change')));

$('toggle-key').addEventListener('click', () => {
  $('api-key').type = $('api-key').type === 'password' ? 'text' : 'password';
  $('toggle-key').textContent = t($('api-key').type === 'password' ? 'settings.show' : 'settings.hide');
});

$('sound-on').addEventListener('change', () => setSoundOn($('sound-on').checked));

$('forget').addEventListener('click', async () => {
  $('settings').close();
  if (!(await confirmAction({ title: t('forget.title'), text: t('settings.forgetHelp'), yes: t('settings.forget') }))) return;
  clearAll();
  try { localStorage.removeItem('quiz-scheme'); } catch {}
  location.reload();
});

// Appearance: Light (the default), Dark or System, saved in this browser. The choice is written
// to <meta name="color-scheme">, which the stylesheet follows.
{
  const schemeMeta = document.querySelector('meta[name="color-scheme"]');
  for (const input of document.querySelectorAll('input[name="scheme"]')) {
    input.checked = input.value === schemeMeta.content;
    input.addEventListener('change', () => {
      schemeMeta.content = input.value;
      try {
        // Saved even when it's System: with nothing saved, the app starts in Light.
        localStorage.setItem('quiz-scheme', input.value);
      } catch { /* the choice still applies for this visit */ }
    });
  }
}

// Older browsers without invoker commands: do by hand what command/commandfor declare.
if (!('commandForElement' in HTMLButtonElement.prototype)) {
  document.addEventListener('click', (event) => {
    const button = event.target.closest('button[command="show-modal"]');
    if (button) document.getElementById(button.getAttribute('commandfor'))?.showModal();
  });
}
// Older browsers without closedby: close the dialogs on a click outside them.
if (!('closedBy' in HTMLDialogElement.prototype)) {
  const outside = (e, dialog) => {
    const r = dialog.getBoundingClientRect();
    return e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom;
  };
  for (const dialog of document.querySelectorAll('dialog[closedby="any"]')) {
    let pressedOutside = false;
    dialog.addEventListener('pointerdown', (e) => { pressedOutside = outside(e, dialog); });
    dialog.addEventListener('pointerup', (e) => { if (pressedOutside && outside(e, dialog)) dialog.close(); });
  }
}

// ── Boot ───────────────────────────────────────────────────────────────────
$('api-key').value = settings.apiKey;
$('sound-on').checked = settings.sound;
buildUiLanguagePicker();
applyLanguage();
syncSoundButton();
for (const screen of document.querySelectorAll('.screen')) screen.hidden = screen.id !== 'home';
route();
