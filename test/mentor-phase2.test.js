const test = require("node:test");
const assert = require("node:assert/strict");
const supertest = require("supertest");
const app = require("../src/app");
const ApiError = require("../src/utils/ApiError");
const mentorService = require("../src/modules/mentor/mentor.service");
const toolRegistry = require("../src/modules/mentor/tools/tool.registry");
const llmService = require("../src/modules/llm/llm.service");
const prisma = require("../src/config/database");

test("Mentor Module - Phase 2 Streaming & Role Expansion Tests", async (t) => {
  let studentUser;
  let instructorUserA;
  let instructorUserB;
  let adminUser;
  let courseA;
  let courseB;

  t.before(async () => {
    // 1. Setup Student User
    let s = await prisma.user.findFirst({ where: { role: "STUDENT" } });
    if (!s) {
      s = await prisma.user.create({
        data: {
          email: "phase2_student@test.com",
          name: "Phase2 Student",
          password: "password123",
          role: "STUDENT",
        },
      });
    }
    studentUser = { id: s.id, email: s.email, role: "STUDENT" };

    // 2. Setup Instructor User A & Course A
    let instA = await prisma.user.findFirst({ where: { role: "INSTRUCTOR", email: { contains: "inst_a" } } });
    if (!instA) {
      instA = await prisma.user.create({
        data: {
          email: "phase2_inst_a@test.com",
          name: "Instructor A",
          password: "password123",
          role: "INSTRUCTOR",
        },
      });
    }
    instructorUserA = { id: instA.id, email: instA.email, role: "INSTRUCTOR" };

    let cA = await prisma.course.findFirst({ where: { creatorId: instA.id } });
    if (!cA) {
      cA = await prisma.course.create({
        data: {
          title: "Course A - Physics",
          description: "Physics Fundamentals",
          category: "SCIENCE",
          level: "BEGINNER",
          creatorId: instA.id,
        },
      });
    }
    courseA = cA;

    // 3. Setup Instructor User B & Course B
    let instB = await prisma.user.findFirst({ where: { role: "INSTRUCTOR", id: { not: instA.id } } });
    if (!instB) {
      instB = await prisma.user.create({
        data: {
          email: "phase2_inst_b@test.com",
          name: "Instructor B",
          password: "password123",
          role: "INSTRUCTOR",
        },
      });
    }
    instructorUserB = { id: instB.id, email: instB.email, role: "INSTRUCTOR" };

    let cB = await prisma.course.findFirst({ where: { creatorId: instB.id } });
    if (!cB) {
      cB = await prisma.course.create({
        data: {
          title: "Course B - Chemistry",
          description: "Chemistry Fundamentals",
          category: "SCIENCE",
          level: "BEGINNER",
          creatorId: instB.id,
        },
      });
    }
    courseB = cB;

    // 4. Setup Admin User
    let adm = await prisma.user.findFirst({ where: { role: "ADMIN" } });
    if (!adm) {
      adm = await prisma.user.create({
        data: {
          email: "phase2_admin@test.com",
          name: "Phase2 Admin",
          password: "password123",
          role: "ADMIN",
        },
      });
    }
    adminUser = { id: adm.id, email: adm.email, role: "ADMIN" };
  });

  // Mock streaming LLM gateway helper
  const mockLLMStream = (t, tokens = ["Thinking... ", "Here is ", "the response."]) => {
    const originalGenerateStream = llmService.generateStream;
    llmService.generateStream = async ({ onToken }) => {
      let text = "";
      for (const token of tokens) {
        text += token;
        if (typeof onToken === "function") {
          onToken(token);
        }
      }
      return {
        response: text,
        model: "qwen3:8b",
        usage: { promptTokens: 15, outputTokens: 25, totalTokens: 40 },
        latency: { totalMs: 200, loadMs: 20, evalMs: 180 },
        thinkingEnabled: false,
      };
    };

    t.after(() => {
      llmService.generateStream = originalGenerateStream;
    });
  };

  await t.test("1. Streaming SSE Processing & Persistence", async (t) => {
    mockLLMStream(t, ["SSE Token 1 ", "SSE Token 2"]);

    const conv = await mentorService.createConversation(studentUser, "SSE Stream Test");

    const tokensReceived = [];
    const result = await mentorService.processUserMessageStream(
      studentUser,
      conv.id,
      "Streaming test message",
      {},
      {
        onToken: (tok) => tokensReceived.push(tok),
      }
    );

    assert.equal(tokensReceived.length, 2);
    assert.equal(tokensReceived.join(""), "SSE Token 1 SSE Token 2");
    assert.equal(result.assistantMessage.content, "SSE Token 1 SSE Token 2");

    // Verify messages persisted to database
    const dbMessages = await prisma.mentorMessage.findMany({
      where: { conversationId: conv.id },
      orderBy: { createdAt: "asc" },
    });
    assert.equal(dbMessages.length, 2);
    assert.equal(dbMessages[1].content, "SSE Token 1 SSE Token 2");

    // Clean up
    await prisma.mentorMessage.deleteMany({ where: { conversationId: conv.id } }).catch(() => {});
    await prisma.mentorConversation.delete({ where: { id: conv.id } }).catch(() => {});
  });

  await t.test("2. Instructor Tools - Instructor A can access Course A analytics", async () => {
    const res = await toolRegistry.executeTool("getMyInstructorAnalytics", instructorUserA, {
      courseId: courseA.id,
    });
    assert.ok(res);
    assert.ok(Array.isArray(res.coursesSummary));
  });

  await t.test("3. Instructor Ownership Security - Instructor A cannot access Course B owned by Instructor B", async () => {
    await assert.rejects(
      () => toolRegistry.executeTool("getMyInstructorAnalytics", instructorUserA, { courseId: courseB.id }),
      (err) => {
        assert.ok(err instanceof ApiError);
        assert.equal(err.statusCode, 403);
        assert.match(err.message, /Access denied: You do not own course/i);
        return true;
      }
    );

    await assert.rejects(
      () => toolRegistry.executeTool("getCourseStudents", instructorUserA, { courseId: courseB.id }),
      (err) => {
        assert.ok(err instanceof ApiError);
        assert.equal(err.statusCode, 403);
        assert.match(err.message, /Access denied: You do not own course/i);
        return true;
      }
    );
  });

  await t.test("4. Role Boundary Isolation - STUDENT cannot execute Instructor tools", async () => {
    await assert.rejects(
      () => toolRegistry.executeTool("getMyInstructorAnalytics", studentUser, { courseId: courseA.id }),
      (err) => {
        assert.ok(err instanceof ApiError);
        assert.equal(err.statusCode, 403);
        assert.match(err.message, /Role 'STUDENT' cannot execute tool 'getMyInstructorAnalytics'/i);
        return true;
      }
    );
  });

  await t.test("5. Admin Tools - ADMIN can access platform overview and user summary", async () => {
    const overview = await toolRegistry.executeTool("getPlatformOverview", adminUser, {});
    assert.ok(overview.totalUsers !== undefined);

    const usersSummary = await toolRegistry.executeTool("getPlatformUsersSummary", adminUser, {});
    assert.ok(usersSummary.studentsCount !== undefined);
    assert.equal(usersSummary.password, undefined); // No password leakage
  });

  await t.test("6. Role Boundary Isolation - STUDENT and INSTRUCTOR cannot execute ADMIN tools", async () => {
    await assert.rejects(
      () => toolRegistry.executeTool("getPlatformOverview", studentUser, {}),
      (err) => {
        assert.ok(err instanceof ApiError);
        assert.equal(err.statusCode, 403);
        assert.match(err.message, /Role 'STUDENT' cannot execute tool/i);
        return true;
      }
    );

    await assert.rejects(
      () => toolRegistry.executeTool("getPlatformOverview", instructorUserA, {}),
      (err) => {
        assert.ok(err instanceof ApiError);
        assert.equal(err.statusCode, 403);
        assert.match(err.message, /Role 'INSTRUCTOR' cannot execute tool/i);
        return true;
      }
    );
  });
});
