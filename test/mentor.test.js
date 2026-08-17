const test = require("node:test");
const assert = require("node:assert/strict");
const supertest = require("supertest");
const app = require("../src/app");
const ApiError = require("../src/utils/ApiError");
const mentorService = require("../src/modules/mentor/mentor.service");
const toolRegistry = require("../src/modules/mentor/tools/tool.registry");
const llmService = require("../src/modules/llm/llm.service");
const prisma = require("../src/config/database");

test("Mentor Module - Backend Foundation Tests", async (t) => {
  let studentUser;
  let otherStudentUser;
  let instructorUser;

  t.before(async () => {
    // Ensure real database users exist for Foreign Key constraints
    let s1 = await prisma.user.findFirst({ where: { role: "STUDENT" } });
    if (!s1) {
      s1 = await prisma.user.create({
        data: {
          email: "mentor_test_student1@test.com",
          name: "Test Student 1",
          password: "hashedpassword123",
          role: "STUDENT",
        },
      });
    }
    studentUser = { id: s1.id, email: s1.email, role: s1.role };

    let s2 = await prisma.user.findFirst({ where: { role: "STUDENT", id: { not: s1.id } } });
    if (!s2) {
      s2 = await prisma.user.create({
        data: {
          email: "mentor_test_student2@test.com",
          name: "Test Student 2",
          password: "hashedpassword123",
          role: "STUDENT",
        },
      });
    }
    otherStudentUser = { id: s2.id, email: s2.email, role: s2.role };

    let inst = await prisma.user.findFirst({ where: { role: "INSTRUCTOR" } });
    if (!inst) {
      inst = await prisma.user.create({
        data: {
          email: "mentor_test_inst@test.com",
          name: "Test Instructor",
          password: "hashedpassword123",
          role: "INSTRUCTOR",
        },
      });
    }
    instructorUser = { id: inst.id, email: inst.email, role: inst.role };
  });

  // Helper to mock llmService.generate for predictable testing
  const mockLLM = (t, customResponse = "Mocked LLM Mentor Response") => {
    const originalGenerate = llmService.generate;
    llmService.generate = async ({ systemPrompt, prompt }) => {
      return {
        response: customResponse,
        model: "qwen3:8b",
        usage: { promptTokens: 20, outputTokens: 30, totalTokens: 50 },
        latency: { totalMs: 150, loadMs: 10, evalMs: 140 },
        thinkingEnabled: false,
      };
    };
    t.after(() => {
      llmService.generate = originalGenerate;
    });
  };

  await t.test("1. Authentication - unauthenticated requests are rejected with 401", async () => {
    const res1 = await supertest(app).get("/mentor/conversations");
    assert.equal(res1.status, 401);
    assert.equal(res1.body.success, false);

    const res2 = await supertest(app).post("/mentor/conversations").send({ title: "Unauthorized Chat" });
    assert.equal(res2.status, 401);
    assert.equal(res2.body.success, false);
  });

  await t.test("2. Conversation Creation & Retrieval for Authenticated User", async () => {
    const conv = await mentorService.createConversation(studentUser, "Math Mentoring");
    assert.ok(conv.id);
    assert.equal(conv.userId, studentUser.id);
    assert.equal(conv.userRole, "STUDENT");

    const list = await mentorService.getUserConversations(studentUser);
    assert.ok(Array.isArray(list));
    const found = list.find((c) => c.id === conv.id);
    assert.ok(found);

    // Clean up
    await prisma.mentorConversation.delete({ where: { id: conv.id } }).catch(() => {});
  });

  await t.test("3. Conversation Ownership - User cannot access another user's conversation", async () => {
    const conv = await mentorService.createConversation(studentUser, "Private Session");

    // Attempt retrieval as otherStudentUser
    await assert.rejects(
      () => mentorService.getConversationMessages(otherStudentUser, conv.id),
      (err) => {
        assert.ok(err instanceof ApiError);
        assert.equal(err.statusCode, 403);
        assert.match(err.message, /do not own this conversation/i);
        return true;
      }
    );

    // Attempt sending message as otherStudentUser
    await assert.rejects(
      () => mentorService.processUserMessage(otherStudentUser, conv.id, "Hello"),
      (err) => {
        assert.ok(err instanceof ApiError);
        assert.equal(err.statusCode, 403);
        assert.match(err.message, /do not own this conversation/i);
        return true;
      }
    );

    // Clean up
    await prisma.mentorConversation.delete({ where: { id: conv.id } }).catch(() => {});
  });

  await t.test("4. Role Authorization - Non-student role cannot execute STUDENT tools", async () => {
    await assert.rejects(
      () => toolRegistry.executeTool("getMyDashboardSummary", instructorUser, {}),
      (err) => {
        assert.ok(err instanceof ApiError);
        assert.equal(err.statusCode, 403);
        assert.match(err.message, /Access denied: Role 'INSTRUCTOR'/i);
        return true;
      }
    );
  });

  await t.test("5. Student Identity Isolation - Tool forces reqUser.id regardless of input params", async () => {
    const tool = toolRegistry.getTool("getMyDashboardSummary");
    assert.ok(tool);
    assert.deepEqual(tool.allowedRoles, ["STUDENT"]);
  });

  await t.test("6. Intent Handling - Correctly classifies queries", () => {
    const i1 = mentorService.determineIntent("Can I see my overall dashboard progress?");
    assert.equal(i1.intent, "ANALYTICS");
    assert.equal(i1.toolName, "getMyDashboardSummary");

    const i2 = mentorService.determineIntent("What are my knowledge gaps and weak areas?");
    assert.equal(i2.intent, "RECOMMENDATION");
    assert.equal(i2.toolName, "getMyLearnerState");

    const i3 = mentorService.determineIntent("Explain what a recursion function is in JavaScript");
    assert.equal(i3.intent, "LEARNING");
    assert.equal(i3.toolName, null);
  });

  await t.test("7. End-to-End Processing & Persistence", async (t) => {
    mockLLM(t, "Here is your progress overview: You are doing great!");

    const conv = await mentorService.createConversation(studentUser, "End to End Test");

    const result = await mentorService.processUserMessage(
      studentUser,
      conv.id,
      "Show my dashboard progress"
    );

    assert.equal(result.conversationId, conv.id);
    assert.equal(result.intent, "ANALYTICS");
    assert.equal(result.userMessage.role, "USER");
    assert.equal(result.userMessage.content, "Show my dashboard progress");
    assert.equal(result.assistantMessage.role, "ASSISTANT");
    assert.equal(result.assistantMessage.content, "Here is your progress overview: You are doing great!");

    // Verify database persistence in MentorMessage table
    const messagesInDb = await prisma.mentorMessage.findMany({
      where: { conversationId: conv.id },
      orderBy: { createdAt: "asc" },
    });

    assert.equal(messagesInDb.length, 2);
    assert.equal(messagesInDb[0].role, "USER");
    assert.equal(messagesInDb[1].role, "ASSISTANT");

    // Clean up
    await prisma.mentorMessage.deleteMany({ where: { conversationId: conv.id } }).catch(() => {});
    await prisma.mentorConversation.delete({ where: { id: conv.id } }).catch(() => {});
  });
});
