'use strict';

function fmt(n) {
  return Number.isInteger(n) ? String(n) : String(Number(n.toFixed(2)));
}

function quoteList(items, max = 4) {
  const shown = items.slice(0, max).map((s) => `"${s}"`);
  return shown.join(', ') + (items.length > max ? ` and ${items.length - max} more` : '');
}

function matchedTerms(criterion) {
  const kw = criterion.evidence.keywords.filter((k) => k.score > 0).map((k) => k.matchedText || k.keyword);
  if (kw.length) return kw;
  const ph = criterion.evidence.phrases.filter((p) => p.score > 0).map((p) => p.matchedText);
  return ph.filter(Boolean);
}

function missingTerms(criterion) {
  return criterion.evidence.keywords.filter((k) => k.score === 0 && k.matchType === 'none').map((k) => k.keyword);
}

/**
 * Student-facing feedback built from the scored criteria. Wording describes
 * what the evaluator found ("we found", "appears"), because it matches words
 * and phrases rather than understanding the answer.
 */
function generateFeedback({ criteria, marksAwarded, maxMarks, misconceptions = [], flags = [], empty = false }) {
  if (empty) {
    return {
      summary: `No answer was submitted. 0/${fmt(maxMarks)}.`,
      matched: [], partial: [], missing: criteria.map((c) => ({ description: c.description, hint: [] })),
      errors: [], notes: [],
    };
  }

  const matched = [];
  const partial = [];
  const missing = [];
  const errors = [];

  for (const c of criteria) {
    if (c.status === 'met') {
      matched.push({ description: c.description, evidence: matchedTerms(c) });
    } else if (c.status === 'partial') {
      partial.push({ description: c.description, evidence: matchedTerms(c), missing: missingTerms(c) });
    } else if (c.status === 'missing') {
      missing.push({ description: c.description, hint: missingTerms(c).slice(0, 4) });
    }
    // One message per kind per criterion: a negated keyword usually also
    // shows up as a negated phrase, and repeating it adds nothing.
    const negation = c.contradictions.find((x) => x.type === 'negation');
    if (negation) {
      errors.push({ type: 'negation', message: `Your answer says "${negation.found}", which appears to contradict the point "${c.description}".` });
    }
    for (const x of c.contradictions.filter((y) => y.type === 'misconception')) {
      errors.push({ type: 'misconception', message: `Your answer says "${x.found}", which looks like a common misconception.` });
    }
    if (c.flags.includes('order-mismatch')) {
      errors.push({ type: 'order', message: `For "${c.description}", the right terms appear but possibly in the wrong relationship or order. Check the direction of what you described.` });
    }
    if (c.flags.includes('mixed-polarity')) {
      errors.push({ type: 'inconsistent', message: `For "${c.description}", your answer seems to state the point both ways.` });
    }
  }
  for (const m of misconceptions) {
    errors.push({ type: 'misconception', message: `Your answer says "${m.found}", which looks like a common misconception.` });
  }

  const notes = [];
  if (flags.includes('keyword-list')) notes.push('Your answer reads like a list of terms. Explain how the ideas connect in full sentences.');
  if (criteria.some((c) => c.flags.includes('spelling-tolerance'))) notes.push('Some terms were recognised despite spelling differences. Check your spelling.');

  const total = criteria.length;
  let summary = `You scored ${fmt(marksAwarded)}/${fmt(maxMarks)}. You fully covered ${matched.length} of ${total} key point${total === 1 ? '' : 's'}`;
  summary += partial.length ? `, and partly covered ${partial.length}.` : '.';
  if (missing.length) summary += ` Points not found in your answer: ${missing.length}.`;
  if (errors.length) summary += ' Some statements may be incorrect. See below.';

  for (const p of partial) {
    if (p.missing.length) p.hint = `Consider also mentioning ${quoteList(p.missing)}.`;
  }

  return { summary, matched, partial, missing, errors, notes };
}

module.exports = { generateFeedback };
