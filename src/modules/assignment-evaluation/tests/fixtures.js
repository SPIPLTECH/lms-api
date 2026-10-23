'use strict';

const defaultSynonyms = require('../engine/synonyms/defaultSynonyms');

const photosynthesis = {
  id: 'q-photo',
  prompt: 'Explain photosynthesis.',
  maxMarks: 5,
  markStep: 0.5,
  idealAnswer: 'Photosynthesis is the process by which green plants use sunlight to make food. '
    + 'Chlorophyll absorbs light energy. Carbon dioxide and water are converted into glucose and oxygen. '
    + 'Light energy is converted into chemical energy.',
  synonyms: [['light', 'sunlight'], ['light energy', 'solar energy'], ['absorb', 'soak up'], ['glucose', 'sugar']],
  misconceptions: ['plants get their food from the soil'],
  criteria: [
    { id: 'c1', description: 'Chlorophyll absorbs light energy', marks: 1, keywords: ['chlorophyll', 'absorb', 'light'], phrases: ['chlorophyll absorbs light energy'] },
    { id: 'c2', description: 'Raw materials are carbon dioxide and water', marks: 1.5, keywords: ['carbon dioxide', 'water'] },
    { id: 'c3', description: 'Products are glucose and oxygen', marks: 1.5, keywords: ['glucose', 'oxygen'] },
    {
      id: 'c4', description: 'Light energy is converted to chemical energy', marks: 1,
      keywords: ['light energy', 'chemical energy'], phrases: ['converts light energy into chemical energy'],
      contradictions: ['converts chemical energy into light energy'],
    },
  ],
};

const newton = {
  id: 'q-newton',
  prompt: "State Newton's second law of motion.",
  maxMarks: 4,
  markStep: 1,
  idealAnswer: 'The acceleration of an object is directly proportional to the net force acting on it '
    + 'and inversely proportional to its mass. This is written as F = ma.',
  criteria: [
    { id: 'n1', description: 'Acceleration is proportional to net force', marks: 2, keywords: ['acceleration', 'proportional', 'force'], phrases: ['acceleration is directly proportional to the net force'] },
    { id: 'n2', description: 'Acceleration is inversely proportional to mass', marks: 1, keywords: ['inversely proportional', 'mass'] },
    { id: 'n3', description: 'Equation F = ma', marks: 1, keywords: ['f ma'], phrases: ['f = ma', 'force equals mass times acceleration'] },
  ],
};

const answers = {
  photosynthesis: {
    correct: 'In photosynthesis, chlorophyll in the leaves absorbs light energy. Using this energy the plant converts carbon dioxide and water into glucose and oxygen. So light energy is converted into chemical energy stored in glucose.',
    partial: 'Plants take in carbon dioxide and water and make glucose.',
    incorrect: 'Plants get their food from the soil through their roots and grow taller every day.',
    reworded: 'The green pigment soaks up sunlight. CO2 and H2O are turned into sugar (C6H12O6) and O2 is given off. Solar energy is changed into chemical energy.',
    contradictory: 'Chlorophyll does not absorb light. Plants convert chemical energy into light energy, using carbon dioxide and water to make glucose and oxygen.',
    keywordList: 'chlorophyll light carbon dioxide water glucose oxygen chemical energy',
    typo: 'Clorophyll absorbs light energy. Carbon dioxide and water are converted to glucose and oxygen. Light energy is converted into chemical energy.',
    offTopic: 'The French Revolution began in 1789 and led to the end of the monarchy, the rise of Napoleon and many changes in European politics over the following decades.',
  },
  newton: {
    correct: 'Acceleration is directly proportional to the net force on a body and inversely proportional to its mass, so F = ma.',
    reworded: 'Force equals mass times acceleration. The acceleration of a body varies directly with the resultant force and is inversely proportional to the mass.',
    partial: 'Acceleration depends on force. F = ma.',
    contradictory: 'Acceleration is not proportional to force; heavier objects accelerate faster. F = ma.',
  },
};

module.exports = { photosynthesis, newton, answers, synonymGroups: defaultSynonyms };
