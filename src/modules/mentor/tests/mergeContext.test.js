const test = require("node:test");
const assert = require("node:assert/strict");

const { mergeContext } = require("../context-engine/mergeContext");

test("mergeContext keys byAgent by agentName.method, never colliding two methods of the same agent", () => {
  const agentResults = [
    { agentName: "assessment", method: "getFullState", status: "SUCCESS", data: { mastery: 80 } },
    { agentName: "assessment", method: "getKnowledgeGaps", status: "SUCCESS", data: { gaps: ["x"] } },
  ];
  const merged = mergeContext({ role: "STUDENT" }, agentResults, { notifications: [], calendarEvents: [] });
  assert.deepEqual(merged.byAgent["assessment.getFullState"], { mastery: 80 });
  assert.deepEqual(merged.byAgent["assessment.getKnowledgeGaps"], { gaps: ["x"] });
});

test("mergeContext stores null (not the error) for a FAILURE-status agent call", () => {
  const agentResults = [{ agentName: "career", method: "getFullState", status: "FAILURE", errorMessage: "boom" }];
  const merged = mergeContext({ role: "STUDENT" }, agentResults, { notifications: [], calendarEvents: [] });
  assert.equal(merged.byAgent["career.getFullState"], null);
});

test("mergeContext extracts recentActivity as the last N observation events, most-recent-first", () => {
  const eventLog = [{ id: "e1" }, { id: "e2" }, { id: "e3" }];
  const agentResults = [{ agentName: "observation", method: "getStudentEventLog", status: "SUCCESS", data: eventLog }];
  const merged = mergeContext({ role: "STUDENT" }, agentResults, { notifications: [], calendarEvents: [] });
  assert.deepEqual(merged.recentActivity, [{ id: "e3" }, { id: "e2" }, { id: "e1" }]);
});

test("mergeContext defaults recentActivity to an empty array when observation wasn't queried", () => {
  const merged = mergeContext({ role: "ADMIN" }, [], { notifications: [], calendarEvents: [] });
  assert.deepEqual(merged.recentActivity, []);
});

test("mergeContext carries the actor and raw notifications/calendarEvents through untouched", () => {
  const actor = { role: "STUDENT", studentId: "s1" };
  const merged = mergeContext(actor, [], { notifications: [{ id: "n1" }], calendarEvents: [{ id: "c1" }] });
  assert.equal(merged.actor, actor);
  assert.deepEqual(merged.notifications, [{ id: "n1" }]);
  assert.deepEqual(merged.calendarEvents, [{ id: "c1" }]);
});
