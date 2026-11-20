// Language registry.
//
// To add a language: create ./<code>.js (copy en.js), then add it to the
// import list and the LANGUAGES array below. The interface text, the picker
// in Settings and the quiz-language choice all come from this list.
import en from './en.js';
import fr from './fr.js';
import es from './es.js';
import de from './de.js';

export const LANGUAGES = [en, fr, es, de];
export const DEFAULT_LANGUAGE = en;

export const getLanguage = (code) => LANGUAGES.find((l) => l.code === code);

/** Best match for the browser's preferred languages. */
export function guessLanguage() {
  for (const tag of navigator.languages ?? [navigator.language ?? '']) {
    const hit = getLanguage(tag.toLowerCase().split('-')[0]);
    if (hit) return hit;
  }
  return DEFAULT_LANGUAGE;
}

let ui = DEFAULT_LANGUAGE;

/** Look up interface text in the current language, filling {placeholders}. */
export function t(key, vars = {}) {
  const text = ui.strings[key] ?? DEFAULT_LANGUAGE.strings[key] ?? key;
  return text.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? '');
}

/** 1st, 1er, 1.º, 1. … in the current language. */
export const ordinal = (n) => (ui.ordinal ?? DEFAULT_LANGUAGE.ordinal)(n);

/** Switch the interface language and re-render every tagged element. */
export function setUiLanguage(code, root = document) {
  ui = getLanguage(code) ?? DEFAULT_LANGUAGE;
  document.documentElement.lang = ui.code;
  for (const el of root.querySelectorAll('[data-i18n]')) el.textContent = t(el.dataset.i18n);
  for (const el of root.querySelectorAll('[data-i18n-label]')) el.setAttribute('aria-label', t(el.dataset.i18nLabel));
  for (const el of root.querySelectorAll('[data-i18n-placeholder]')) el.placeholder = t(el.dataset.i18nPlaceholder);
  // Text with a link inside: the string marks where the element's <a> goes with {link}.
  for (const el of root.querySelectorAll('[data-i18n-link]')) {
    const link = el.querySelector('a');
    const [before = '', after = ''] = t(el.dataset.i18nLink).split('{link}');
    el.replaceChildren(before, link, after);
  }
}
