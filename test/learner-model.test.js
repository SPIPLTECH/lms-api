const test = require("node:test");
const assert = require("node:assert/strict");

const prisma = require("../src/config/database");
const ApiError = require("../src/utils/ApiError");
const learnerModelService = require("../src/modules/learner-model/learnerModel.service");
const {
  initializeSchema,
  recordEvidenceSchema,
  recordMisconceptionSchema,
} = require("../src/modules/learner-model/learnerModel.validation");

const mockMethod = (t, obj, methodName, impl) => {
  const original = obj[methodName];
  obj[methodName] = (...args) => impl(...args);
  t.after(() => {
    obj[methodName] = original;
  });
};

const STUDENT_USER_1 = { id: "usr-student-1", role: "STUDENT" };
const STUDENT_USER_2 = { id: "usr-student-2", role: "STUDENT" };
const INSTRUCTOR_USER = { id: "usr-instructor-1", role: "INSTRUCTOR" };

const STUDENT_PROFILE_1 = {
  id: "sp-student-1",
  userId: "usr-student-1",
  learningGoals: "Master C++ Pointers",
  focusTopics: "Pointers, Memory",
  preferredLearningStyle: "VISUAL",
};

const STUDENT_PROFILE_2 = {
  id: "sp-student-2",
  userId: "usr-student-2",
  learningGoals: "Master Web Dev",
  focusTopics: "Express, Node",
  preferredLearningStyle: "READING",
};

test("learnerModelService.getLearnerState", async (t) => {
  await t.test("retrieves structured learner state for a student", async (t) => {
    mockMethod(t, prisma.studentProfile, "findUnique", async ({ where }) => {
      if (where.userId === STUDENT_USER_1.id || where.id === STUDENT_PROFILE_1.id) {
        return STUDENT_PROFILE_1;
      }
      return null;
    });

    mockMethod(t, prisma.studentState, "findFirst", async () => ({
      courseId: "crs-101",
      moduleId: "mod-1",
      lessonId: "les-1",
      contentId: "cnt-1",
    }));

    mockMethod(t, prisma.conceptMastery, "findMany", async () => [
      {
        id: "cm-1",
        studentId: "sp-student-1",
        concept: "pointers_memory",
        masteryScore: 0.6,
        confidenceLevel: 0.8,
        status: "DEVELOPING",
        attemptsCount: 3,
        recentScores: [{ score: 0.8, hintsUsed: 1 }],
        trend: "UP",
        lastCourseId: "crs-101",
        lastAssessedAt: new Date("2026-08-10T10:00:00Z"),
        updatedAt: new Date("2026-08-10T10:00:00Z"),
      },
    ]);

    mockMethod(t, prisma.knowledgeGap, "findMany", async () => [
      {
        id: "kg-1",
        studentId: "sp-student-1",
        concept: "pointer_syntax_confusion",
        severity: 0.7,
        status: "OPEN",
        detectedAt: new Date("2026-08-10T09:00:00Z"),
        closedAt: null,
      },
    ]);

    mockMethod(t, prisma.learningEvent, "findMany", async () => [
      {
        id: "le-1",
        studentId: "sp-student-1",
        eventType: "QUIZ_SUBMITTED",
        eventCategory: "QUIZ",
        payload: { score: 1.0, hintsUsed: 0, responseTimeMs: 3500 },
        createdAt: new Date("2026-08-10T10:00:00Z"),
      },
    ]);

    mockMethod(t, prisma.learningEvent, "count", async () => 1);

    const state = await learnerModelService.getLearnerState({
      callingUser: STUDENT_USER_1,
    });

    assert.equal(state.studentId, "sp-student-1");
    assert.equal(state.userId, "usr-student-1");
    assert.equal(state.learningContext.currentCourseId, "crs-101");
    assert.equal(state.knowledgeState.length, 1);
    assert.equal(state.knowledgeState[0].kc, "pointers_memory");
    assert.equal(state.knowledgeState[0].masteryProbability, 0.6);
    assert.equal(state.misconceptionState.length, 1);
    assert.equal(state.misconceptionState[0].hypothesis, "pointer_syntax_confusion");
    assert.equal(state.behaviorState.totalEventsCount, 1);
  });

  await t.test("enforces student isolation (student cannot view another student's state)", async (t) => {
    mockMethod(t, prisma.studentProfile, "findUnique", async ({ where }) => {
      if (where.userId === STUDENT_USER_1.id) {
        return STUDENT_PROFILE_1;
      }
      return null;
    });

    await assert.rejects(
      () =>
        learnerModelService.getLearnerState({
          callingUser: STUDENT_USER_1,
          targetStudentId: "sp-student-2",
        }),
      (error) => {
        assert.ok(error instanceof ApiError);
        assert.equal(error.statusCode, 403);
        assert.match(error.message, /access denied/i);
        return true;
      }
    );
  });

  await t.test("allows instructor to access any target student's state", async (t) => {
    mockMethod(t, prisma.studentProfile, "findUnique", async ({ where }) => {
      if (where.id === STUDENT_PROFILE_2.id) {
        return STUDENT_PROFILE_2;
      }
      return null;
    });

    mockMethod(t, prisma.studentState, "findFirst", async () => null);
    mockMethod(t, prisma.conceptMastery, "findMany", async () => []);
    mockMethod(t, prisma.knowledgeGap, "findMany", async () => []);
    mockMethod(t, prisma.learningEvent, "findMany", async () => []);
    mockMethod(t, prisma.learningEvent, "count", async () => 0);

    const state = await learnerModelService.getLearnerState({
      callingUser: INSTRUCTOR_USER,
      targetStudentId: "sp-student-2",
    });

    assert.equal(state.studentId, "sp-student-2");
    assert.equal(state.userId, "usr-student-2");
  });
});

test("learnerModelService.initializeLearnerState", async (t) => {
  await t.test("initializes Knowledge Component association without BKT mastery calculation", async (t) => {
    mockMethod(t, prisma.studentProfile, "findUnique", async () => STUDENT_PROFILE_1);
    
    let upsertCalled = false;
    mockMethod(t, prisma.conceptMastery, "upsert", async ({ create }) => {
      upsertCalled = true;
      return {
        id: "cm-new",
        studentId: create.studentId,
        concept: create.concept,
        masteryScore: create.masteryScore,
        confidenceLevel: create.confidenceLevel,
        status: create.status,
      };
    });

    mockMethod(t, prisma.studentState, "upsert", async () => ({}));

    const res = await learnerModelService.initializeLearnerState({
      callingUser: STUDENT_USER_1,
      data: {
        courseId: "crs-101",
        kcs: [{ kc: "dynamic_allocation", masteryProbability: 0.2, confidence: 0.1 }],
      },
    });

    assert.ok(upsertCalled);
    assert.equal(res.studentId, "sp-student-1");
    assert.equal(res.initializedKcs.length, 1);
    assert.equal(res.initializedKcs[0].kc, "dynamic_allocation");
    assert.equal(res.initializedKcs[0].masteryProbability, 0.2);
    assert.equal(res.initializedKcs[0].confidence, 0.1);
  });
});

test("learnerModelService.recordEvidence", async (t) => {
  await t.test("records interaction evidence and logs LearningEvent without running BKT", async (t) => {
    mockMethod(t, prisma.studentProfile, "findUnique", async () => STUDENT_PROFILE_1);
    mockMethod(t, prisma.conceptMastery, "findUnique", async () => null);

    let eventCreated = false;
    mockMethod(t, prisma.learningEvent, "create", async ({ data }) => {
      eventCreated = true;
      return { id: "le-new", createdAt: new Date(), ...data };
    });

    let masteryUpserted = false;
    mockMethod(t, prisma.conceptMastery, "upsert", async ({ create }) => {
      masteryUpserted = true;
      return {
        id: "cm-ev",
        concept: create.concept,
        attemptsCount: create.attemptsCount,
        lastAssessedAt: create.lastAssessedAt,
      };
    });

    let gapCreated = false;
    mockMethod(t, prisma.knowledgeGap, "findFirst", async () => null);
    mockMethod(t, prisma.knowledgeGap, "create", async ({ data }) => {
      gapCreated = true;
      return { id: "kg-new", ...data };
    });

    const result = await learnerModelService.recordEvidence({
      callingUser: STUDENT_USER_1,
      data: {
        studentId: STUDENT_PROFILE_1.id,
        courseId: "course-123",
        kc: "pointers_arithmetic",
        score: 0.2,
        isCorrect: false,
        hintsUsed: 2,
        responseTimeMs: 4500,
        misconceptionHypothesis: "adding_bytes_instead_of_types",
        misconceptionSeverity: 0.6,
      },
    });

    assert.ok(eventCreated);
    assert.ok(masteryUpserted);
    assert.ok(gapCreated);
    assert.equal(result.recordedEvidence.kc, "pointers_arithmetic");
    assert.equal(result.recordedEvidence.score, 0.2);
    assert.equal(result.recordedEvidence.hintsUsed, 2);
    assert.equal(result.recordedEvidence.responseTimeMs, 4500);
    assert.equal(result.recordedMisconception.concept, "adding_bytes_instead_of_types");
  });
});

test("learnerModelService.recordMisconceptionState", async (t) => {
  await t.test("stores misconception state hypothesis into KnowledgeGap", async (t) => {
    mockMethod(t, prisma.studentProfile, "findUnique", async () => STUDENT_PROFILE_1);
    mockMethod(t, prisma.knowledgeGap, "findFirst", async () => null);

    mockMethod(t, prisma.knowledgeGap, "create", async ({ data }) => ({
      id: "kg-direct",
      studentId: data.studentId,
      concept: data.concept,
      severity: data.severity,
      status: data.status,
      detectedAt: data.detectedAt,
    }));

    const gap = await learnerModelService.recordMisconceptionState({
      callingUser: STUDENT_USER_1,
      data: {
        hypothesis: "dangling_pointer_usage",
        probability: 0.85,
        status: "OPEN",
      },
    });

    assert.equal(gap.concept, "dangling_pointer_usage");
    assert.equal(gap.severity, 0.85);
    assert.equal(gap.status, "OPEN");
  });
});

test("learnerModel.validation schemas", async (t) => {
  await t.test("accepts valid initialize payload", () => {
    const { error, value } = initializeSchema.validate({
      kcs: [{ kc: "variables", masteryProbability: 0.5 }],
    });
    assert.equal(error, undefined);
    assert.equal(value.kcs[0].kc, "variables");
  });

  await t.test("rejects initialize payload without kcs", () => {
    const { error } = initializeSchema.validate({});
    assert.ok(error);
  });

  await t.test("accepts valid evidence payload", () => {
    const { error, value } = recordEvidenceSchema.validate({
      kc: "arrays",
      score: 1.0,
      hintsUsed: 0,
      responseTimeMs: 2000,
    });
    assert.equal(error, undefined);
    assert.equal(value.kc, "arrays");
  });

  await t.test("rejects recordEvidence without kc", () => {
    const { error } = recordEvidenceSchema.validate({ score: 0.5 });
    assert.ok(error);
  });

  await t.test("accepts valid misconception payload", () => {
    const { error, value } = recordMisconceptionSchema.validate({
      hypothesis: "confusing_index_with_value",
      probability: 0.7,
    });
    assert.equal(error, undefined);
    assert.equal(value.hypothesis, "confusing_index_with_value");
  });
});
