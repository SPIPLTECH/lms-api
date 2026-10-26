'use strict';

const { tokenizeWords } = require('../normalization/normalizer');

/**
 * Configurable synonym dictionary. Each group lists terms that mean the same
 * thing in the subject ("co2", "carbon dioxide"). Terms may be several words.
 * Matching is done on stems, so "carbon dioxides" also matches.
 *
 * A group that shares a term with an earlier group extends that group (so a
 * question-specific group can add to the global dictionary). A term can only
 * ever belong to one group, so keep groups strict: light ~ sunlight followed by
 * light ~ lightweight would make all three interchangeable.
 */
class SynonymDictionary {
  constructor(groups = []) {
    this.byFirstStem = new Map();
    this.termCanon = new Map(); // stem key -> canon
    this.groups = [];
    for (const g of groups) this.addGroup(g);
  }

  static termKey(term) {
    return tokenizeWords(term).words.map((w) => w.stem).join(' ');
  }

  addGroup(terms) {
    if (!Array.isArray(terms)) return;
    const parsed = [];
    const seen = new Set();
    for (const term of terms) {
      if (typeof term !== 'string') continue;
      const stems = tokenizeWords(term).words.map((w) => w.stem);
      const key = stems.join(' ');
      if (!stems.length || seen.has(key)) continue;
      seen.add(key);
      parsed.push({ term: term.trim(), stems, key });
    }
    if (parsed.length < 2) return;

    // Reuse a canon if any member is already known, so a question-level group
    // extends the global one instead of competing with it.
    const existing = parsed.find((p) => this.termCanon.has(p.key));
    const canon = existing ? this.termCanon.get(existing.key) : `syn:${parsed[0].stems.join('_')}`;

    const added = [];
    for (const p of parsed) {
      if (this.termCanon.has(p.key)) continue;
      this.termCanon.set(p.key, canon);
      const list = this.byFirstStem.get(p.stems[0]) || [];
      list.push({ stems: p.stems, canon, term: p.term });
      list.sort((a, b) => b.stems.length - a.stems.length);
      this.byFirstStem.set(p.stems[0], list);
      added.push(p.term);
    }
    if (added.length) this.groups.push({ canon, terms: parsed.map((p) => p.term) });
  }

  get size() {
    return this.groups.length;
  }

  /** Longest dictionary entry starting at tokens[i], or null. */
  lookupAt(tokens, i) {
    const candidates = this.byFirstStem.get(tokens[i].stem);
    if (!candidates) return null;
    for (const entry of candidates) {
      const n = entry.stems.length;
      if (i + n > tokens.length) continue;
      let ok = true;
      for (let k = 0; k < n; k += 1) {
        const t = tokens[i + k];
        // Multi-word terms must not straddle a sentence boundary.
        if (t.stem !== entry.stems[k] || t.sentence !== tokens[i].sentence) { ok = false; break; }
      }
      if (ok) return entry;
    }
    return null;
  }

  /** Replaces every synonym occurrence with a single canonical token. */
  canonicalize(tokens) {
    const out = [];
    let i = 0;
    while (i < tokens.length) {
      const entry = this.lookupAt(tokens, i);
      if (!entry) { out.push(tokens[i]); i += 1; continue; }
      const span = tokens.slice(i, i + entry.stems.length);
      out.push({
        surface: span.map((t) => t.surface).join(' '),
        stem: entry.stems.join('_'),
        canon: entry.canon,
        sentence: span[0].sentence,
        clause: span[0].clause,
        viaSynonym: true,
        sourceStems: span.map((t) => t.stem),
      });
      i += entry.stems.length;
    }
    return out;
  }

  /** New dictionary with this dictionary's groups followed by extra groups. */
  extend(extraGroups = []) {
    const d = new SynonymDictionary();
    for (const g of this.groups) d.addGroup(g.terms);
    for (const g of extraGroups) d.addGroup(g);
    return d;
  }
}

module.exports = { SynonymDictionary };
