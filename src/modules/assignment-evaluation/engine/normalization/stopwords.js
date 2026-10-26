'use strict';

// Words that reverse the meaning of what follows. They are never treated as
// stopwords: dropping "not" would turn "plants do not need light" into a
// correct answer.
const NEGATORS = new Set([
  'not', 'no', 'never', 'none', 'nobody', 'nothing', 'neither', 'nor',
  'without', 'cannot', 'nowhere', 'hardly', 'barely', 'non',
]);

// Function words that carry little subject meaning. Kept short on purpose:
// words like "increase", "more", "less", "before", "after" stay as content
// because they change the meaning of a scientific statement.
const STOPWORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'if', 'then', 'so', 'as', 'of', 'at',
  'by', 'for', 'with', 'about', 'into', 'onto', 'to', 'from', 'in', 'on', 'up',
  'out', 'over', 'under', 'again', 'further', 'once', 'here', 'there', 'when',
  'where', 'why', 'how', 'all', 'any', 'both', 'each', 'few', 'some', 'such',
  'own', 'same', 'than', 'too', 'very', 's', 't', 'can', 'will', 'just', 'should',
  'now', 'i', 'me', 'my', 'myself', 'we', 'our', 'ours', 'you', 'your', 'yours',
  'he', 'him', 'his', 'she', 'her', 'hers', 'it', 'its', 'itself', 'they', 'them',
  'their', 'theirs', 'what', 'which', 'who', 'whom', 'this', 'that', 'these',
  'those', 'am', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has',
  'had', 'having', 'do', 'does', 'did', 'doing', 'would', 'could', 'shall', 'may',
  'might', 'must', 'also', 'via', 'per', 'its', 'etc', 'eg', 'ie', 'thus',
  'hence', 'therefore', 'because', 'while', 'during', 'through', 'within',
  'between', 'among', 'upon', 'onto', 'whose', 'whether', 'only', 'other',
  'another', 'like', 'called', 'known', 'process',
]);

// Words that end the scope of a preceding negator ("not X but Y").
const SCOPE_BREAKERS = new Set(['but', 'however', 'although', 'though', 'whereas', 'yet', 'instead']);

module.exports = { NEGATORS, STOPWORDS, SCOPE_BREAKERS };
