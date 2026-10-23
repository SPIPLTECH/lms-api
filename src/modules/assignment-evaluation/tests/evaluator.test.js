'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createRuleBasedEvaluator, EmbeddingProvider } = require('../engine');
const { photosynthesis, newton, answers, synonymGroups } = require('./fixtures');

const evaluator = createRuleBasedEvaluator();
const evaluate = (question, answerText, opts = {}) => (opts.evaluator || evaluator)
  .evaluateAnswer({ question, answerText, synonymGroups });

test('correct answer earns full marks with high confidence and no review', async () => {
  const r = await evaluate(photosynthesis, answers.photosynthesis.correct);
  assert.equal(r.marksAwarded, 5);
  assert.equal(r.percentage, 100);
  assert.equal(r.needsReview, false);
  assert.ok(r.confidence >= 0.9);
  assert.ok(r.criteria.every((c) => c.status === 'met'));
  assert.equal(r.feedback.missing.length, 0);
});

test('partially correct answer earns partial marks and lists missing concepts', async () => {
  const r = await evaluate(photosynthesis, answers.photosynthesis.partial);
  assert.ok(r.marksAwarded > 0 && r.marksAwarded < 5, `got ${r.marksAwarded}`);
  const byId = Object.fromEntries(r.criteria.map((c) => [c.criterionId, c]));
  assert.equal(byId.c2.status, 'met');
  assert.equal(byId.c3.status, 'partial', 'glucose present, oxygen missing');
  assert.equal(byId.c4.awarded, 0);
  assert.ok(r.feedback.missing.some((m) => m.description.includes('chemical energy')));
  assert.ok(r.feedback.partial.some((p) => p.missing.includes('oxygen')));
});

test('incorrect answer earns zero and a stated misconception is sent for review', async () => {
  const r = await evaluate(photosynthesis, answers.photosynthesis.incorrect);
  assert.equal(r.marksAwarded, 0);
  assert.equal(r.needsReview, true);
  assert.ok(r.flags.includes('misconception'));
  assert.ok(r.feedback.errors.some((e) => e.type === 'misconception'));
});

test('differently worded answer using configured synonyms earns full marks', async () => {
  const r = await evaluate(photosynthesis, answers.photosynthesis.reworded);
  assert.equal(r.marksAwarded, 5, JSON.stringify(r.criteria.map((c) => [c.criterionId, c.awarded, c.evidence.keywords])));
  assert.ok(r.criteria.some((c) => c.evidence.keywords.some((k) => k.matchType === 'synonym')));
});

test('differently worded Newton answer earns full marks', async () => {
  const r = await evaluate(newton, answers.newton.reworded);
  assert.equal(r.marksAwarded, 4, JSON.stringify(r.criteria.map((c) => [c.criterionId, c.awarded, c.satisfaction])));
});

test('contradictory answer loses the contradicted criteria and is flagged for review', async () => {
  const r = await evaluate(photosynthesis, answers.photosynthesis.contradictory);
  const byId = Object.fromEntries(r.criteria.map((c) => [c.criterionId, c]));
  assert.equal(byId.c1.status, 'contradicted');
  assert.equal(byId.c1.awarded, 0);
  assert.equal(byId.c4.awarded, 0, 'reversed energy conversion matches the misconception');
  assert.equal(byId.c2.status, 'met', 'uncontested points keep their marks');
  assert.equal(r.needsReview, true);
  assert.ok(r.feedback.errors.length >= 2);
});

test('negated Newton statement is contradicted', async () => {
  const r = await evaluate(newton, answers.newton.contradictory);
  const n1 = r.criteria.find((c) => c.criterionId === 'n1');
  assert.equal(n1.awarded, 0);
  assert.equal(r.needsReview, true);
});

test('keyword list without explanation is sent for review', async () => {
  const r = await evaluate(photosynthesis, answers.photosynthesis.keywordList);
  assert.ok(r.flags.includes('keyword-list'));
  assert.equal(r.needsReview, true);
  assert.ok(r.marksAwarded < 5, 'missing relationships cost marks');
});

test('empty answer earns zero with full confidence and no review', async () => {
  for (const text of ['', '   ', null, 'the and of']) {
    const r = await evaluate(photosynthesis, text);
    assert.equal(r.marksAwarded, 0);
    assert.equal(r.needsReview, false);
    assert.ok(r.flags.includes('empty-answer'));
  }
});

test('spelling mistakes are tolerated but noted', async () => {
  const r = await evaluate(photosynthesis, answers.photosynthesis.typo);
  assert.equal(r.marksAwarded, 5);
  assert.ok(r.criteria.some((c) => c.flags.includes('spelling-tolerance')));
  assert.ok(r.feedback.notes.some((n) => /spelling/i.test(n)));
});

test('long off-topic answer earns zero without being sent for review', async () => {
  const r = await evaluate(photosynthesis, answers.photosynthesis.offTopic);
  assert.equal(r.marksAwarded, 0);
  assert.ok(r.flags.includes('off-topic'));
});

test('long on-topic answer that scores low is sent for review as a possible paraphrase', async () => {
  const text = 'Plants are living things that have green leaves and roots. Plants grow in sunlight and need water every day. '
    + 'Leaves of plants are green and plants are important for animals and for people who eat plants.';
  const r = await evaluate(photosynthesis, text);
  assert.ok(r.percentage < 30);
  assert.ok(r.flags.includes('low-score-substantive'));
  assert.equal(r.needsReview, true);
});

test('partial Newton answer earns some but not all marks', async () => {
  const r = await evaluate(newton, answers.newton.partial);
  assert.ok(r.marksAwarded > 0 && r.marksAwarded < 4, `got ${r.marksAwarded}`);
});

test('repeating keywords never raises marks above the maximum', async () => {
  const spam = Array(50).fill(answers.photosynthesis.correct).join(' ');
  const r = await evaluate(photosynthesis, spam);
  assert.equal(r.marksAwarded, 5);
  for (const c of r.criteria) assert.ok(c.awarded <= c.maxMarks);
});

test('marks stay within bounds and on the mark step for random answers', async () => {
  const words = 'chlorophyll light energy glucose oxygen not carbon dioxide water absorbs converts chemical soil food the plants is no'.split(' ');
  let seed = 7;
  const rand = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  for (let i = 0; i < 200; i += 1) {
    const len = 1 + Math.floor(rand() * 40);
    const text = Array.from({ length: len }, () => words[Math.floor(rand() * words.length)]).join(rand() > 0.8 ? '. ' : ' ');
    const r = await evaluate(photosynthesis, text);
    assert.ok(r.marksAwarded >= 0 && r.marksAwarded <= 5, text);
    assert.equal(Math.round(r.marksAwarded / 0.5) * 0.5, r.marksAwarded, text);
    assert.equal(r.criteria.reduce((s, c) => s + c.awarded, 0), r.marksAwarded);
  }
});

test('similarity alone never awards a criterion', async () => {
  // Shares many words with the ideal answer but none of criterion c3's keywords.
  const r = await evaluate(photosynthesis, 'Photosynthesis is the process by which green plants use sunlight to make food.');
  const c3 = r.criteria.find((c) => c.criterionId === 'c3');
  assert.equal(c3.awarded, 0);
});

test('auto-generated rubric is used when no criteria are given', async () => {
  const q = { ...photosynthesis, criteria: [], keywords: ['chlorophyll', 'glucose', 'oxygen', 'chemical energy'] };
  const good = await evaluate(q, answers.photosynthesis.correct);
  const weak = await evaluate(q, answers.photosynthesis.partial);
  assert.equal(good.rubricAutoGenerated, true);
  assert.equal(good.criteria.reduce((s, c) => s + c.maxMarks, 0), 5);
  assert.ok(good.marksAwarded >= 4, `got ${good.marksAwarded}`);
  assert.ok(weak.marksAwarded < good.marksAwarded);
  assert.ok(good.confidence < 0.95, 'auto rubric lowers confidence');
});

test('auto rubric accepts a correct answer that reorders the model sentences', async () => {
  const q = {
    id: 'q-water', maxMarks: 4, markStep: 0.5, criteria: [],
    keywords: ['evaporation', 'condensation', 'precipitation', 'collection'],
    synonyms: [['collection', 'collect']],
    idealAnswer: 'Water from oceans and lakes evaporates because of heat from the sun. The water vapour rises, cools and condenses to form clouds. '
      + 'Water falls back to the earth as precipitation such as rain or snow. It collects in rivers, lakes and oceans and the cycle repeats.',
  };
  const r = await evaluate(q, 'Heat from the sun makes water evaporate from oceans and lakes. The vapour rises, cools and condenses into clouds. '
    + 'It falls back as rain or snow, which is precipitation, and collects in rivers and oceans before the cycle repeats.');
  assert.equal(r.marksAwarded, 4);
  assert.equal(r.needsReview, false, JSON.stringify(r.reviewReasons));
});

test('semantic evidence from an embedding provider can corroborate but not award', async () => {
  class AlwaysSimilar extends EmbeddingProvider {
    get name() { return 'test'; }
    async isAvailable() { return true; }
    async embed(texts) { return texts.map(() => [1, 0, 0]); }
  }
  const ev = createRuleBasedEvaluator({ embeddingProvider: new AlwaysSimilar() });
  const r = await evaluate(photosynthesis, answers.photosynthesis.offTopic, { evaluator: ev });
  assert.equal(r.marksAwarded, 0);
  assert.ok(r.criteria.every((c) => c.evidence.semanticSimilarity === 1));
  assert.ok(r.criteria.some((c) => c.flags.includes('possible-paraphrase')));
  assert.equal(r.needsReview, true);
});

test('a failing embedding provider does not fail the evaluation', async () => {
  class Broken extends EmbeddingProvider {
    get name() { return 'broken'; }
    async isAvailable() { return true; }
    async embed() { throw new Error('connection refused'); }
  }
  const ev = createRuleBasedEvaluator({ embeddingProvider: new Broken() });
  const r = await evaluate(photosynthesis, answers.photosynthesis.correct, { evaluator: ev });
  assert.equal(r.marksAwarded, 5);
  assert.ok(r.flags.includes('embeddings-unavailable'));
});
