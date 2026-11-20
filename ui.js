// Small helpers shared by the host and player screens.
import { swap, numberChildren } from './fx.js';
import { t } from './languages/index.js';

export const $ = (id) => document.getElementById(id);

/** Make an element: h('li', { className: 'x' }, child, 'text', …). */
export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k === 'style') for (const [prop, value] of Object.entries(v)) {
      if (prop.startsWith('--')) el.style.setProperty(prop, value);
      else el.style[prop] = value;
    }
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k in el && !k.startsWith('aria')) el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  el.append(...children.flat().filter((c) => c != null && c !== false));
  return el;
}

/** Show one top-level screen. The screen's heading takes focus. */
export function showScreen(id, focusId) {
  const next = $(id);
  if (!next.hidden && !focusId) return Promise.resolve();
  return swap(() => {
    for (const screen of document.querySelectorAll('.screen')) screen.hidden = screen !== next;
    scrollTo(0, 0);
  }, () => $(focusId) ?? next.querySelector('h1[tabindex], h2[tabindex]'));
}

/** Show one phase inside a screen (host big screen or player phone). */
export function showPhase(screenId, phaseId, focusId, update) {
  const screen = $(screenId);
  return swap(() => {
    if (screen.hidden) for (const s of document.querySelectorAll('.screen')) s.hidden = s !== screen;
    for (const phase of screen.querySelectorAll(':scope > .phase')) phase.hidden = phase.id !== phaseId;
    update?.();
    for (const list of $(phaseId).querySelectorAll('[data-stagger]')) numberChildren(list);
  }, () => (focusId ? $(focusId) : null));
}

let toastTimer = 0;
export function toast(message) {
  const el = $('toast');
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 3500);
}

export function showError(id, message) {
  const el = $(id);
  el.textContent = message ?? '';
  el.hidden = !message;
}

/** Ask a yes/no question in a modal dialog. Resolves true for yes. */
export function confirmAction({ title, text = '', yes }) {
  const dialog = $('confirm');
  $('confirm-title').textContent = title;
  $('confirm-text').textContent = text;
  $('confirm-text').hidden = !text;
  $('confirm-yes').textContent = yes;
  dialog.returnValue = '';
  dialog.showModal();
  return new Promise((resolve) => {
    dialog.addEventListener('close', () => { resolve(dialog.returnValue === 'yes'); dialog.returnValue = ''; }, { once: true });
  });
}

export const LETTERS = ['A', 'B', 'C', 'D'];
export const AVATARS = ['🦊', '🐼', '🐸', '🐙', '🦄', '🐯', '🐨', '🐵', '🦁', '🐧', '🐢', '🦖', '🐝', '🐳', '🦉', '🐰', '🐶', '🐱', '🦩', '🐲'];

/** Format a score for the current language. */
export const num = (n) => new Intl.NumberFormat(document.documentElement.lang).format(n);

/** "3 of 10" style question counter. */
export const qCount = (n, of) => t('q.count', { n, of });

/** Build the QR code for a link as an SVG (light squares on the code's own background). */
export function qrSvg(text) {
  /* global qrcode */
  if (typeof qrcode !== 'function') return null;
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  const n = qr.getModuleCount();
  let d = '';
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) d += `M${c} ${r}h1v1h-1z`;
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', `-2 -2 ${n + 4} ${n + 4}`);
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('shape-rendering', 'crispEdges');
  svg.innerHTML = `<rect x="-2" y="-2" width="${n + 4}" height="${n + 4}" fill="#fff" stroke="none"/><path d="${d}" fill="#24184a" stroke="none"/>`;
  return svg;
}
