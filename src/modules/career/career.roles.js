/**
 * Career Guidance agent — the role catalogue.
 *
 * The original agent's 10 seeded roles (backup/ai-agents/source/career/
 * constants/industryRoles.seed.js): names, categories, descriptions and
 * requiredSkills weights (0-100) unchanged. Deliberately DROPPED: the
 * avgSalary and industryDemandScore figures — they were illustrations, not
 * data from any real source, and this agent does not show invented numbers.
 *
 * Module configuration, not a table: nothing in the LMS edits it at runtime.
 */
module.exports = Object.freeze([
  {
    key: "frontend-developer",
    name: "Frontend Developer",
    category: "Software Engineering",
    description: "Builds user-facing web interfaces and client-side application logic.",
    requiredSkills: {
      HTML: 70,
      CSS: 70,
      JavaScript: 90,
      React: 80,
      TypeScript: 60,
      Git: 50,
      Testing: 40,
      "Responsive Design": 50
    },
    minReadinessScore: 60
  },
  {
    key: "backend-developer",
    name: "Backend Developer",
    category: "Software Engineering",
    description: "Builds server-side application logic, APIs, and data layers.",
    requiredSkills: {
      "Node.js": 85,
      SQL: 75,
      "REST APIs": 85,
      "System Design": 60,
      Databases: 70,
      Git: 50,
      Testing: 45,
      Authentication: 40
    },
    minReadinessScore: 60
  },
  {
    key: "full-stack-developer",
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
      Testing: 40
    },
    minReadinessScore: 65
  },
  {
    key: "data-analyst",
    name: "Data Analyst",
    category: "Data",
    description: "Extracts, cleans, and interprets data to support business decisions.",
    requiredSkills: {
      SQL: 85,
      Python: 60,
      Statistics: 65,
      "Data Visualization": 70,
      "Data Cleaning": 60,
      Excel: 50
    },
    minReadinessScore: 55
  },
  {
    key: "data-scientist",
    name: "Data Scientist",
    category: "Data",
    description: "Builds statistical and machine-learning models to extract insight from data.",
    requiredSkills: {
      Python: 85,
      Statistics: 80,
      "Machine Learning": 80,
      SQL: 65,
      "Data Visualization": 55,
      "Deep Learning": 45
    },
    minReadinessScore: 65
  },
  {
    key: "machine-learning-engineer",
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
      MLOps: 40
    },
    minReadinessScore: 70
  },
  {
    key: "devops-engineer",
    name: "DevOps Engineer",
    category: "Infrastructure",
    description: "Automates build, deployment, and infrastructure operations.",
    requiredSkills: {
      Linux: 75,
      Docker: 80,
      "CI/CD": 80,
      AWS: 70,
      Git: 55,
      Scripting: 60,
      Networking: 50,
      "System Design": 45
    },
    minReadinessScore: 60
  },
  {
    key: "cloud-engineer",
    name: "Cloud Engineer",
    category: "Infrastructure",
    description: "Designs and manages cloud infrastructure and deployment pipelines.",
    requiredSkills: {
      AWS: 85,
      Docker: 65,
      Networking: 65,
      Linux: 60,
      "CI/CD": 55,
      "System Design": 55,
      Security: 45
    },
    minReadinessScore: 65
  },
  {
    key: "qa-engineer",
    name: "QA Engineer",
    category: "Quality Assurance",
    description: "Verifies software quality through manual and automated testing.",
    requiredSkills: {
      Testing: 85,
      "Automation Testing": 70,
      SQL: 45,
      "Bug Tracking": 40,
      "API Testing": 50,
      Communication: 40
    },
    minReadinessScore: 55
  },
  {
    key: "mobile-app-developer",
    name: "Mobile App Developer",
    category: "Software Engineering",
    description: "Builds native or cross-platform mobile applications.",
    requiredSkills: {
      JavaScript: 70,
      "React Native": 75,
      "Mobile UI Design": 55,
      "REST APIs": 60,
      Git: 45,
      Testing: 35
    },
    minReadinessScore: 60
  }
]);
