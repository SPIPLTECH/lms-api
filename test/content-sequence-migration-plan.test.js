const test = require("node:test");
const assert = require("node:assert/strict");

const { planContentSequenceMigration, checkInvariants } = require("../scripts/lib/contentSequenceMigration");

let next = 0;
const newId = () => `new-${++next}`;
const at = (minute) => new Date(Date.UTC(2026, 8, 1, 0, minute)).toISOString();
const empty = { contentSubmissions: [], assignmentSubmissions: [], quizAttempts: [], quizSubmissions: [], contentProgress: [], quizProgress: [], assignmentProgress: [] };

// A database migrated late (Singapore): a topic whose instructor put a
// "Prerequisite" subtopic first (order 1) before videos that were ADDED
// earlier, plus a quiz that has no wrapper yet.
const snapshot = () => ({
  ...empty,
  contents: [
    { id: "v1", type: "VIDEO", order: 2, title: "Intro", topicId: "t1", createdAt: at(1) },
    { id: "v2", type: "VIDEO", order: 3, title: "More", topicId: "t1", createdAt: at(2) },
  ],
  quizzes: [{ id: "q1", title: "Quiz", quizTag: "FINAL", order: 9, topicId: "t1", createdAt: at(3) }],
  assignments: [],
  containers: { subTopic: [{ id: "s1", topicId: "t1", order: 1, createdAt: at(10) }] },
});

test("a new quiz wrapper does not reshuffle a sequence whose positions were already distinct", () => {
  const { plan, finalContents, finalContainers } = planContentSequenceMigration(snapshot(), { newId });
  const position = new Map([...finalContents, ...finalContainers].map((row) => [row.id, row.order]));
  const wrapper = plan.createContents[0].data;

  // The instructor's order is kept: Prerequisite, then the videos...
  assert.deepEqual(["s1", "v1", "v2"].map((id) => position.get(id)), [1, 2, 3]);
  // ...and the quiz is placed after the level's existing items.
  assert.equal(wrapper.quizId, "q1");
  assert.equal(wrapper.order, 4);
  assert.deepEqual(checkInvariants(finalContents, finalContainers), []);
});

test("a real collision is still merged by when items were added", () => {
  const data = snapshot();
  data.containers.subTopic[0].order = 2; // collides with video v1
  const { finalContents, finalContainers } = planContentSequenceMigration(data, { newId });
  const position = new Map([...finalContents, ...finalContainers].map((row) => [row.id, row.order]));

  // Unchanged behaviour for a real collision: everything, the new quiz
  // wrapper included, is merged by when it was added — videos (minutes 1, 2)
  // and the quiz (3) before the subtopic (10).
  const wrapper = finalContents.find((row) => row.quizId === "q1");
  assert.deepEqual([...["v1", "v2"].map((id) => position.get(id)), wrapper.order, position.get("s1")], [1, 2, 3, 4]);
  assert.deepEqual(checkInvariants(finalContents, finalContainers), []);
});
