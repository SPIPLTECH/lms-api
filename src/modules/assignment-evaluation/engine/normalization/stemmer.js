'use strict';

// Porter (1980) stemming algorithm. Reduces inflected forms to a shared stem
// so "absorbs", "absorbed" and "absorbing" all compare equal. Stems are not
// real words ("energy" -> "energi"); they are only ever compared with other
// stems produced by this same function.

const STEP2 = {
  ational: 'ate', tional: 'tion', enci: 'ence', anci: 'ance', izer: 'ize', bli: 'ble',
  alli: 'al', entli: 'ent', eli: 'e', ousli: 'ous', ization: 'ize', ation: 'ate',
  ator: 'ate', alism: 'al', iveness: 'ive', fulness: 'ful', ousness: 'ous',
  aliti: 'al', iviti: 'ive', biliti: 'ble', logi: 'log',
};
const STEP3 = { icate: 'ic', ative: '', alize: 'al', iciti: 'ic', ical: 'ic', ful: '', ness: '' };

const c = '[^aeiou]';
const v = '[aeiouy]';
const C = `${c}[^aeiouy]*`;
const V = `${v}[aeiou]*`;
const MGR0 = new RegExp(`^(${C})?${V}${C}`);
const MEQ1 = new RegExp(`^(${C})?${V}${C}(${V})?$`);
const MGR1 = new RegExp(`^(${C})?${V}${C}${V}${C}`);
const S_V = new RegExp(`^(${C})?${v}`);
const CVC = new RegExp(`^${C}${v}[^aeiouwxy]$`);

const STEP2_RE = /^(.+?)(ational|tional|enci|anci|izer|bli|alli|entli|eli|ousli|ization|ation|ator|alism|iveness|fulness|ousness|aliti|iviti|biliti|logi)$/;
const STEP3_RE = /^(.+?)(icate|ative|alize|iciti|ical|ful|ness)$/;
const STEP4_RE = /^(.+?)(al|ance|ence|er|ic|able|ible|ant|ement|ment|ent|ou|ism|ate|iti|ous|ive|ize)$/;
const STEP4_ION_RE = /^(.+?)(s|t)(ion)$/;

const cache = new Map();

function stem(word) {
  if (typeof word !== 'string' || word.length < 3 || !/^[a-z]+$/.test(word)) return word;
  const cached = cache.get(word);
  if (cached !== undefined) return cached;

  let w = word;
  const startsWithY = w[0] === 'y';
  if (startsWithY) w = `Y${w.slice(1)}`;

  // Step 1a
  if (/^(.+?)(ss|i)es$/.test(w)) w = w.replace(/^(.+?)(ss|i)es$/, '$1$2');
  else if (/^(.+?)([^s])s$/.test(w)) w = w.replace(/^(.+?)([^s])s$/, '$1$2');

  // Step 1b
  let m = /^(.+?)eed$/.exec(w);
  if (m) {
    if (MGR0.test(m[1])) w = w.slice(0, -1);
  } else if ((m = /^(.+?)(ed|ing)$/.exec(w))) {
    const s = m[1];
    if (S_V.test(s)) {
      w = s;
      if (/(at|bl|iz)$/.test(w)) w += 'e';
      else if (/([^aeiouylsz])\1$/.test(w)) w = w.slice(0, -1);
      else if (CVC.test(w)) w += 'e';
    }
  }

  // Step 1c
  m = /^(.+?)y$/.exec(w);
  if (m && S_V.test(m[1])) w = `${m[1]}i`;

  // Step 2
  m = STEP2_RE.exec(w);
  if (m && MGR0.test(m[1])) w = m[1] + STEP2[m[2]];

  // Step 3
  m = STEP3_RE.exec(w);
  if (m && MGR0.test(m[1])) w = m[1] + STEP3[m[2]];

  // Step 4
  m = STEP4_RE.exec(w);
  if (m) {
    if (MGR1.test(m[1])) w = m[1];
  } else if ((m = STEP4_ION_RE.exec(w))) {
    const s = m[1] + m[2];
    if (MGR1.test(s)) w = s;
  }

  // Step 5
  m = /^(.+?)e$/.exec(w);
  if (m) {
    const s = m[1];
    if (MGR1.test(s) || (MEQ1.test(s) && !CVC.test(s))) w = s;
  }
  if (/ll$/.test(w) && MGR1.test(w)) w = w.slice(0, -1);

  if (startsWithY) w = `y${w.slice(1)}`;
  if (cache.size > 50000) cache.clear();
  cache.set(word, w);
  return w;
}

module.exports = { stem };
