const test = require("node:test");
const assert = require("node:assert/strict");

const { selectAgentCalls } = require("../orchestrator/agentSelector");

test("selectAgentCalls includes learning-path and student-state for a STUDENT LEARNING intent", () => {
  const descriptors = selectAgentCalls({ role: "STUDENT", studentId: "s1" }, "LEARNING");
  const names = descriptors.map((d) => d.agentName);
  assert.ok(names.includes("learning-path"));
  assert.ok(names.includes("student-state"));
  assert.ok(names.includes("recommendation")); // base agent, always included for STUDENT
});

test("selectAgentCalls includes both assessment getters for a STUDENT ASSESSMENT intent", () => {
  const descriptors = selectAgentCalls({ role: "STUDENT", studentId: "s1" }, "ASSESSMENT");
  const methods = descriptors.filter((d) => d.agentName === "assessment").map((d) => d.method);
  assert.deepEqual(methods.sort(), ["getFullState", "getKnowledgeGaps"]);
});

test("selectAgentCalls always includes getTeacherDashboard for INSTRUCTOR, regardless of intent", () => {
  const descriptors = selectAgentCalls({ role: "INSTRUCTOR", instructorId: "i1" }, "GENERAL");
  assert.ok(descriptors.some((d) => d.agentName === "teacher-insights" && d.method === "getTeacherDashboard"));
});

test("selectAgentCalls always includes admin-intelligence.getDashboard for ADMIN, regardless of intent", () => {
  const descriptors = selectAgentCalls({ role: "ADMIN" }, "GENERAL");
  assert.ok(descriptors.some((d) => d.agentName === "admin-intelligence" && d.method === "getDashboard"));
});

test("selectAgentCalls adds analytics.getPlatformKPIs for ADMIN ANALYTICS intent on top of the base set", () => {
  const descriptors = selectAgentCalls({ role: "ADMIN" }, "ANALYTICS");
  assert.ok(descriptors.some((d) => d.agentName === "analytics" && d.method === "getPlatformKPIs"));
});

test("selectAgentCalls returns an empty array for an unrecognized role", () => {
  assert.deepEqual(selectAgentCalls({ role: "GUEST" }, "GENERAL"), []);
});

test("every descriptor has a callable invoke function", () => {
  const descriptors = selectAgentCalls({ role: "STUDENT", studentId: "s1" }, "CAREER");
  for (const d of descriptors) assert.equal(typeof d.invoke, "function");
});
