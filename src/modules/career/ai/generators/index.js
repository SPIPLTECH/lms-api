const skillDevelopment = require("./skillDevelopment.generator");
const portfolioCareer = require("./portfolioCareer.generator");
const interviewPrep = require("./interviewPrep.generator");

const GENERATORS = [skillDevelopment, portfolioCareer, interviewPrep];

/** @returns {import("../../types/career.types").CareerCandidate[]} */
const generateAllCandidates = (context) => GENERATORS.flatMap((generator) => generator.generate(context));

module.exports = { generateAllCandidates };
