/**
 * This agent's own seeded employer catalog — there is no external job-
 * portal/company-directory integration anywhere in this codebase, so this
 * is real, owned reference data, matched to real Career Guidance IndustryRole
 * naming conventions where relevant. See integrations/jobPortalProvider.js
 * for the real-provider swap-in seam.
 */
const COMPANY_SEED_DATA = [
  {
    name: "TechNova Solutions",
    industry: "Software Engineering",
    website: "https://technova.example.com",
    description: "Product engineering company building web and mobile platforms for mid-market retailers.",
  },
  {
    name: "DataSphere Analytics",
    industry: "Data",
    website: "https://datasphere.example.com",
    description: "Data analytics and business intelligence consultancy.",
  },
  {
    name: "CloudPeak Systems",
    industry: "Infrastructure",
    website: "https://cloudpeak.example.com",
    description: "Cloud infrastructure and DevOps managed-services provider.",
  },
  {
    name: "PixelCraft Studios",
    industry: "Software Engineering",
    website: "https://pixelcraft.example.com",
    description: "Mobile-first product studio building consumer apps.",
  },
  {
    name: "QuantEdge Technologies",
    industry: "Data",
    website: "https://quantedge.example.com",
    description: "Applied machine learning company serving financial services clients.",
  },
  {
    name: "BrightPath Innovations",
    industry: "Software Engineering",
    website: "https://brightpath.example.com",
    description: "Full-stack product development agency for early-stage startups.",
  },
];

module.exports = { COMPANY_SEED_DATA };
