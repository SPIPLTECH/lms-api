/**
 * This agent's own seeded skill taxonomy — there is no external "Industry
 * Skill Taxonomy" system integrated anywhere in this codebase, so this is
 * the real, owned reference data the spec's IndustryRole model is built to
 * hold. Skill names are matched against Assessment Agent's ConceptMastery
 * concept tags by normalized string equality (see ai/skillMatchEngine.js) —
 * there's no canonical skill-ID taxonomy in this LMS to join by ID instead.
 *
 * requiredSkills: { skillName: importanceWeight(0-100) }. avgSalary* are in
 * INR (matches Store's default currency), a realistic entry-level India
 * tech-market illustration, not a live feed. industryDemandScore is
 * refreshed by the monthly taxonomyRefresh scheduler via ai/jobMarketProvider.js.
 */
const INDUSTRY_ROLE_SEED_DATA = [
  {
    name: "Frontend Developer",
    category: "Software Engineering",
    description: "Builds user-facing web interfaces and client-side application logic.",
    requiredSkills: { HTML: 70, CSS: 70, JavaScript: 90, React: 80, TypeScript: 60, Git: 50, Testing: 40, "Responsive Design": 50 },
    minReadinessScore: 60,
    avgSalaryMin: 400000,
    avgSalaryMax: 1000000,
    industryDemandScore: 75,
  },
  {
    name: "Backend Developer",
    category: "Software Engineering",
    description: "Builds server-side application logic, APIs, and data layers.",
    requiredSkills: { "Node.js": 85, SQL: 75, "REST APIs": 85, "System Design": 60, Databases: 70, Git: 50, Testing: 45, Authentication: 40 },
    minReadinessScore: 60,
    avgSalaryMin: 450000,
    avgSalaryMax: 1100000,
    industryDemandScore: 80,
  },
  {
    name: "Full Stack Developer",
    category: "Software Engineering",
    description: "Works across both client-side and server-side application layers.",
    requiredSkills: {
      JavaScript: 85,
      React: 65,
      "Node.js": 70,
      SQL: 60,
      "REST APIs": 75,
      "System Design": 50,
      Git: 55,
      Testing: 40,
    },
    minReadinessScore: 65,
    avgSalaryMin: 500000,
    avgSalaryMax: 1300000,
    industryDemandScore: 85,
  },
  {
    name: "Data Analyst",
    category: "Data",
    description: "Extracts, cleans, and interprets data to support business decisions.",
    requiredSkills: { SQL: 85, Python: 60, Statistics: 65, "Data Visualization": 70, "Data Cleaning": 60, Excel: 50 },
    minReadinessScore: 55,
    avgSalaryMin: 400000,
    avgSalaryMax: 900000,
    industryDemandScore: 70,
  },
  {
    name: "Data Scientist",
    category: "Data",
    description: "Builds statistical and machine-learning models to extract insight from data.",
    requiredSkills: { Python: 85, Statistics: 80, "Machine Learning": 80, SQL: 65, "Data Visualization": 55, "Deep Learning": 45 },
    minReadinessScore: 65,
    avgSalaryMin: 600000,
    avgSalaryMax: 1600000,
    industryDemandScore: 78,
  },
  {
    name: "Machine Learning Engineer",
    category: "Data",
    description: "Designs, trains, and deploys machine-learning systems in production.",
    requiredSkills: {
      Python: 85,
      "Machine Learning": 85,
      "Deep Learning": 70,
      Statistics: 65,
      "Data Structures": 60,
      Algorithms: 60,
      MLOps: 40,
    },
    minReadinessScore: 70,
    avgSalaryMin: 700000,
    avgSalaryMax: 1800000,
    industryDemandScore: 82,
  },
  {
    name: "DevOps Engineer",
    category: "Infrastructure",
    description: "Automates build, deployment, and infrastructure operations.",
    requiredSkills: { Linux: 75, Docker: 80, "CI/CD": 80, AWS: 70, Git: 55, Scripting: 60, Networking: 50, "System Design": 45 },
    minReadinessScore: 60,
    avgSalaryMin: 500000,
    avgSalaryMax: 1400000,
    industryDemandScore: 76,
  },
  {
    name: "Cloud Engineer",
    category: "Infrastructure",
    description: "Designs and manages cloud infrastructure and deployment pipelines.",
    requiredSkills: { AWS: 85, Docker: 65, Networking: 65, Linux: 60, "CI/CD": 55, "System Design": 55, Security: 45 },
    minReadinessScore: 65,
    avgSalaryMin: 550000,
    avgSalaryMax: 1500000,
    industryDemandScore: 74,
  },
  {
    name: "QA Engineer",
    category: "Quality Assurance",
    description: "Verifies software quality through manual and automated testing.",
    requiredSkills: { Testing: 85, "Automation Testing": 70, SQL: 45, "Bug Tracking": 40, "API Testing": 50, Communication: 40 },
    minReadinessScore: 55,
    avgSalaryMin: 350000,
    avgSalaryMax: 800000,
    industryDemandScore: 62,
  },
  {
    name: "Mobile App Developer",
    category: "Software Engineering",
    description: "Builds native or cross-platform mobile applications.",
    requiredSkills: { JavaScript: 70, "React Native": 75, "Mobile UI Design": 55, "REST APIs": 60, Git: 45, Testing: 35 },
    minReadinessScore: 60,
    avgSalaryMin: 450000,
    avgSalaryMax: 1100000,
    industryDemandScore: 68,
  },
];

module.exports = { INDUSTRY_ROLE_SEED_DATA };
