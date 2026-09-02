const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const prisma = require("../../../config/database");
const ApiError = require("../../../utils/ApiError");
const { extractZip } = require("../utils/zip.util");
const { scanDirectory } = require("./fileScanner.service");
const { buildCanonicalCourse } = require("./jsonTransformer.service");
const { validateCourse } = require("./validator.service");
const composerMapper = require("./composerMapper.service");
const serverQuizMapper = require("./serverQuizMapper.service");

const v2PackageImporter = require("./v2PackageImporter.service");
const courseService = require("../../courses/course.service");
const moduleService = require("../../modules/module.service");
const lessonService = require("../../lessons/lesson.service");
const topicService = require("../../topics/topic.service");
const contentService = require("../../contents/content.service");
const quizService = require("../../quizzes/quiz.service");
const questionService = require("../../questions/question.service");
const assignmentService = require("../../assignments/assignment.service");

const UPLOAD_ROOT = path.join(__dirname, "../../../../uploads/course-imports");

const createJob = async ({ instructorId, sourceFileName, zipFilePath }) => {
  const job = await prisma.courseImportJob.create({
    data: { instructorId, sourceFileName, sourcePath: "", status: "UPLOADED" },
  });

  const jobDir = path.join(UPLOAD_ROOT, job.id);

  try {
    extractZip(zipFilePath, jobDir);
  } catch (error) {
    await prisma.courseImportJob.update({ where: { id: job.id }, data: { status: "FAILED", errorMessage: error.message } });
    throw new ApiError(400, `Could not extract package: ${error.message}`);
  } finally {
    try { fs.unlinkSync(zipFilePath); } catch (error) { /* best-effort cleanup of the ephemeral upload */ }
  }

  return prisma.courseImportJob.update({
    where: { id: job.id },
    data: { sourcePath: `course-imports/${job.id}` },
  });
};

const createJsonJob = async ({ instructorId, canonicalJson, sourceFileName }) => {
  const { validateV2Manifest } = require("./v2PackageImporter.service");
  const validation = validateV2Manifest(canonicalJson);

  const title = canonicalJson?.metadata?.title || "Course JSON Package";
  const name = sourceFileName || `${title.toLowerCase().replace(/[^a-z0-9]/g, "_")}.json`;

  const validationReport = {
    isValid: validation.isValid,
    errors: validation.errors,
    warnings: [],
    info: validation.isValid
      ? ["Course JSON schema validation passed successfully."]
      : ["Course JSON validation failed."]
  };

  const job = await prisma.courseImportJob.create({
    data: {
      instructorId,
      sourceFileName: name,
      sourcePath: "json-import",
      status: validation.isValid ? "READY" : "FAILED",
      canonicalJson,
      validationReport,
      errorMessage: validation.isValid ? null : validation.errors.join("; ")
    }
  });

  return job;
};

const getJob = async (jobId) => prisma.courseImportJob.findUnique({ where: { id: jobId } });

const listJobs = async (instructorId) => prisma.courseImportJob.findMany({ where: { instructorId }, orderBy: { createdAt: "desc" } });

const processJob = async (jobId, baseUrl) => {
  const job = await getJob(jobId);
  if (!job) throw new ApiError(404, "Import job not found.");

  await prisma.courseImportJob.update({ where: { id: jobId }, data: { status: "EXTRACTING" } });

  const jobDir = path.join(UPLOAD_ROOT, jobId);

  // Check for V2 Canonical Package Manifest (course.json)
  const courseJsonPath = path.join(jobDir, "course.json");
  if (fs.existsSync(courseJsonPath)) {
    let rawCourseJson;
    try {
      rawCourseJson = JSON.parse(fs.readFileSync(courseJsonPath, "utf8"));
    } catch (parseErr) {
      return prisma.courseImportJob.update({
        where: { id: jobId },
        data: { status: "FAILED", errorMessage: `Invalid course.json format: ${parseErr.message}` },
      });
    }

    if (rawCourseJson && (rawCourseJson.version === "2.0" || rawCourseJson.$schema?.includes("course-v2.json"))) {
      await prisma.courseImportJob.update({ where: { id: jobId }, data: { status: "ANALYZING" } });
      try {
        const v2Result = await v2PackageImporter.processV2Package(jobDir, jobId, rawCourseJson);
        return await prisma.courseImportJob.update({
          where: { id: jobId },
          data: { status: "READY", canonicalJson: v2Result.canonicalJson, validationReport: v2Result.validationReport },
        });
      } catch (v2Err) {
        return prisma.courseImportJob.update({
          where: { id: jobId },
          data: { status: "FAILED", errorMessage: v2Err.message },
        });
      }
    }
  }

  // Fallback to V1 folder/file scanning processing path
  const files = scanDirectory(jobDir);

  await prisma.courseImportJob.update({ where: { id: jobId }, data: { status: "ANALYZING" } });

  try {
    const canonical = await buildCanonicalCourse({ files, jobId, baseUrl, sourceFileName: job.sourceFileName });
    const validationReport = validateCourse(canonical.course);

    return await prisma.courseImportJob.update({
      where: { id: jobId },
      data: { status: "READY", canonicalJson: canonical, validationReport },
    });
  } catch (error) {
    return prisma.courseImportJob.update({
      where: { id: jobId },
      data: { status: "FAILED", errorMessage: error.message },
    });
  }
};

const updateCanonicalJson = async (jobId, canonicalJson) => {
  const job = await getJob(jobId);
  if (!job) throw new ApiError(404, "Import job not found.");
  if (!canonicalJson) throw new ApiError(400, "canonicalJson is required.");

  return prisma.courseImportJob.update({
    where: { id: jobId },
    data: { canonicalJson, status: "READY" },
  });
};

/** Creates one gradable Question (lazily creating one Quiz per Lesson, same idempotency as ContentBlockCard.handleSave) for a quiz block, or returns null if the block isn't backend-gradable or creation fails — a failed question never aborts the whole import, the block is still preserved as a Content row either way. */
const attachGradableQuestion = async (block, { courseId, moduleId, lessonId, lessonTitle, quizIdByLesson }) => {
  if (!serverQuizMapper.isBackendGradable(block)) return;

  try {
    if (!quizIdByLesson.has(lessonId)) {
      const quiz = await quizService.createQuiz(serverQuizMapper.buildQuizPayload(block, { courseId, lessonTitle }));
      quizIdByLesson.set(lessonId, quiz.id);
    }
    const quizId = quizIdByLesson.get(lessonId);

    const questionPayload = serverQuizMapper.buildQuestionPayload(block, { courseId, moduleId, quizId });
    const question = await questionService.createQuestion(questionPayload);

    block.attributes = { ...(block.attributes || {}), quizLinkage: { quizId, questionId: question.id } };
  } catch (error) {
    block.attributes = { ...(block.attributes || {}), quizLinkageError: error.message };
  }
};

const importJob = async (jobId, instructorId, fallbackCanonicalJson = null) => {
  const job = await getJob(jobId);
  if (!job) {
    if (fallbackCanonicalJson || (jobId && (jobId.startsWith("draft-") || jobId === "draft"))) {
      return await v2PackageImporter.importV2Manifest(fallbackCanonicalJson || {}, instructorId);
    }
    throw new ApiError(404, "Import job not found.");
  }

  if (job.status === "COMPLETED") {
    return job;
  }
  if (job.status === "IMPORTING") {
    return job;
  }

  // Check for V2 Package canonicalJson (has metadata, modules, or version)
  if (job.canonicalJson?.metadata || job.canonicalJson?.modules || job.canonicalJson?.version === "2.0") {
    await prisma.courseImportJob.update({ where: { id: jobId }, data: { status: "IMPORTING" } });
    return await v2PackageImporter.importV2Job(job, instructorId);
  }

  // Fallback to V1 import execution
  if (!job.canonicalJson?.course) throw new ApiError(400, "This job has no processed course to import yet — run /process first.");

  await prisma.courseImportJob.update({ where: { id: jobId }, data: { status: "IMPORTING" } });

  const { course } = job.canonicalJson;
  let createdCourseId = null;

  try {
    const createdCourse = await courseService.createCourse(
      {
        title: course.title || "Imported Course",
        description: course.description || "",
        category: course.category || undefined,
        level: course.level || undefined,
      },
      instructorId
    );
    createdCourseId = createdCourse.id;

    const quizIdByLesson = new Map();

    for (const moduleDef of course.modules || []) {
      const createdModule = await moduleService.createModule({
        title: moduleDef.title || "Untitled Module",
        description: moduleDef.description || "",
        order: moduleDef.order,
        courseId: createdCourseId,
      });

      for (const lessonDef of moduleDef.lessons || []) {
        const createdLesson = await lessonService.createLesson({
          title: lessonDef.title || "Untitled Lesson",
          description: lessonDef.description || "",
          order: lessonDef.order,
          moduleId: createdModule.id,
        });

        const topicsToImport = (lessonDef.topics && lessonDef.topics.length > 0)
          ? lessonDef.topics
          : [{ title: "General", order: 1, contents: lessonDef.content || [] }];

        let lessonHasContent = false;

        for (const topicDef of topicsToImport) {
          const createdTopic = await topicService.createTopic({
            title: topicDef.title || "General",
            order: topicDef.order || 1,
            isPublished: true,
            lessonId: createdLesson.id,
          });

          let contentOrder = 1;
          const contentsToImport = topicDef.contents || topicDef.content || [];

          for (const block of contentsToImport) {
            if (block.blockType === "quiz") {
              await attachGradableQuestion(block, {
                courseId: createdCourseId,
                moduleId: createdModule.id,
                lessonId: createdLesson.id,
                lessonTitle: createdLesson.title,
                quizIdByLesson,
              });
            }

            const payload = composerMapper.toContentPayload(block, { topicId: createdTopic.id, order: contentOrder });
            await contentService.createContent(payload);
            contentOrder += 1;
            lessonHasContent = true;
          }
        }

        if (lessonHasContent) {
          await lessonService.updateLesson(createdLesson.id, { isPublished: true });
        }
      }

      const moduleLessonCount = await prisma.lesson.count({ where: { moduleId: createdModule.id } });
      if (moduleLessonCount > 0) {
        await moduleService.updateModule(createdModule.id, { isPublished: true });
      }
    }

    for (const assignmentDef of course.unmappedAssignments || []) {
      await assignmentService.createAssignment({
        title: assignmentDef.title || "Imported Assignment",
        description: assignmentDef.description || "",
        dueDate: assignmentDef.dueDate || new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
        courseId: createdCourseId,
        isPublished: false,
      });
    }

    return await prisma.courseImportJob.update({
      where: { id: jobId },
      data: { status: "COMPLETED", courseId: createdCourseId },
    });
  } catch (error) {
    if (createdCourseId) {
      try { await courseService.deleteCourse(createdCourseId); } catch (cleanupError) { /* best-effort compensating cleanup, no true cross-table transaction available */ }
    }
    await prisma.courseImportJob.update({
      where: { id: jobId },
      data: { status: "FAILED", errorMessage: error.message, courseId: null },
    });
    throw error;
  }
};

const deleteJob = async (jobId) => {
  const job = await getJob(jobId);
  if (!job) throw new ApiError(404, "Import job not found.");

  const jobDir = path.join(UPLOAD_ROOT, jobId);
  if (fs.existsSync(jobDir)) {
    fs.rmSync(jobDir, { recursive: true, force: true });
  }

  return prisma.courseImportJob.delete({ where: { id: jobId } });
};

/**
 * Applies AI-generated nested entity structures (MODULE, LESSON, TOPIC, CONTENT, QUIZ) into the database in a SINGLE ATOMIC TRANSACTION.
 * If any step fails, the entire operation is rolled back, guaranteeing zero partial persistence.
 */
const applyAiEntity = async ({ scope, generatedData, context = {}, instructorId }) => {
  if (!scope || !generatedData) {
    throw new ApiError(400, "Scope and generatedData are required for AI entity application.");
  }

  const scopeUpper = scope.toUpperCase();
  const { courseId, moduleId, lessonId, topicId, position, quizLevel } = context;

  return await prisma.$transaction(async (tx) => {
    // Helper to calculate target order and shift existing siblings if needed
    const getPositionalOrderAndShift = async (tableName, parentFilter, pos) => {
      const existing = await tx[tableName].findMany({
        where: parentFilter,
        orderBy: { order: "asc" },
        select: { id: true, order: true },
      });

      if (!pos || pos === "AUTO_END" || pos === "END") {
        const maxOrd = existing.length > 0 ? Math.max(...existing.map((e) => e.order || 0)) : 0;
        return maxOrd + 1;
      }

      if (pos === "BEGINNING") {
        for (const item of existing) {
          await tx[tableName].update({
            where: { id: item.id },
            data: { order: (item.order || 0) + 1 },
          });
        }
        return 1;
      }

      if (pos.startsWith("AFTER_")) {
        const afterId = pos.replace("AFTER_", "");
        const targetItem = existing.find((e) => String(e.id) === String(afterId));
        const targetOrder = targetItem ? targetItem.order : (existing.length > 0 ? Math.max(...existing.map((e) => e.order || 0)) : 0);

        for (const item of existing) {
          if (item.order > targetOrder) {
            await tx[tableName].update({
              where: { id: item.id },
              data: { order: item.order + 1 },
            });
          }
        }
        return targetOrder + 1;
      }

      const maxOrd = existing.length > 0 ? Math.max(...existing.map((e) => e.order || 0)) : 0;
      return maxOrd + 1;
    };

    // Normalizes an AI-provided content "type" string to a valid ContentType
    // enum value. "TEXT" is coerced to "HTML" because the student renderer
    // (VideoPlayer.jsx) has no rendering branch for a literal TEXT type today
    // — a TEXT-typed row currently renders as nothing for students, while the
    // identical prose stored as HTML renders correctly via MarkdownRenderer.
    const normalizeContentType = (rawType) => {
      let type = (rawType || "HTML").toUpperCase();
      if (type === "TEXT_BLOCK" || type === "MARKDOWN" || type === "TEXT") type = "HTML";
      if (type === "CODE_BLOCK" || type === "SNIPPET") type = "CODE";
      return type;
    };

    // Builds one Content row's insert data from an AI-generated content
    // definition — pure JS, no DB call, so many of these can be collected
    // into one batched createMany() instead of one create() per row.
    // Populates Content.data.language for CODE blocks — the one place the
    // student renderer already reads Content.data (VideoPlayer.jsx's
    // highlightCode call) — which AI-generated content never populated
    // before, so CODE blocks rendered without syntax highlighting.
    const buildContentRow = (cDef, topicIdForRow, order, fallbackTitle) => {
      const type = normalizeContentType(cDef.type);
      const hasLanguage = type === "CODE" && typeof cDef.language === "string" && cDef.language.trim();
      return {
        topicId: topicIdForRow,
        type,
        title: cDef.title || fallbackTitle,
        htmlContent: cDef.htmlContent || cDef.code || cDef.body || cDef.content || "",
        videoUrl: cDef.videoUrl ?? null,
        fileUrl: cDef.fileUrl ?? null,
        externalUrl: cDef.externalUrl ?? null,
        data: hasLanguage ? { language: cDef.language.trim().toLowerCase() } : undefined,
        order,
      };
    };

    // AI-generated questionType is restricted to the subset that is
    // confirmed safe end-to-end: rendered by a dedicated student UI
    // (QuestionCard.jsx -> OptionList/MCQMultiOptionList) AND graded by a
    // dedicated comparison branch (quiz.service.js evaluateAnswer). The other
    // three QuestionType enum values (ARRANGE_TOKENS, MATCH_PAIRS,
    // SELF_ASSESSMENT) need richer generated data shapes (ordered token
    // lists, key/value pairs) that the AI prompt does not yet constrain
    // strictly enough to trust unattended — left as future work.
    const AI_SAFE_QUESTION_TYPES = new Set(["MCQ_SINGLE", "MCQ_MULTI"]);
    const normalizeQuestionType = (rawType) => {
      const type = (rawType || "MCQ_SINGLE").toUpperCase().trim();
      return AI_SAFE_QUESTION_TYPES.has(type) ? type : "MCQ_SINGLE";
    };

    // MCQ_MULTI is graded by an order-independent array match
    // (quiz.service.js evaluateAnswer) and therefore needs correctAnswer to
    // be an array of correct option strings; MCQ_SINGLE needs a single
    // string. Defensively reshapes whatever the AI returned to match.
    const normalizeCorrectAnswer = (qDef, questionType, options) => {
      if (questionType === "MCQ_MULTI") {
        if (Array.isArray(qDef.correctAnswer) && qDef.correctAnswer.length > 0) return qDef.correctAnswer;
        if (qDef.correctAnswer) return [qDef.correctAnswer];
        return [options[0]];
      }
      if (Array.isArray(qDef.correctAnswer)) return qDef.correctAnswer[0] ?? options[0];
      return qDef.correctAnswer || options[0];
    };

    // Collects one AI-generated quiz + its questions into the flat batch
    // arrays below using pre-generated IDs (crypto.randomUUID()) instead of
    // creating each row individually and awaiting its DB-generated ID back.
    // This is the same batching pattern already used by
    // v2PackageImporter.service.js's importV2Manifest for bulk course
    // imports, applied here so the whole nested Quiz/Question/QuizQuestion
    // subtree for one AI apply persists via a handful of createMany() calls
    // instead of one round trip per row.
    const collectQuizForBatch = (quizDef, levelIds, batch) => {
      if (!quizDef || typeof quizDef !== "object") return null;

      const quizId = crypto.randomUUID();
      const quizRow = {
        id: quizId,
        title: quizDef.title || "AI Generated Quiz",
        description: quizDef.description ?? null,
        passingScore: quizDef.passingScore ? Number(quizDef.passingScore) : 70,
        timeLimit: quizDef.timeLimit ? Number(quizDef.timeLimit) : 15,
        isPublished: true,
        status: "ACTIVE",
        courseId: levelIds.courseId || courseId,
        moduleId: levelIds.moduleId || null,
        lessonId: levelIds.lessonId || null,
        topicId: levelIds.topicId || null,
        batchId: null,
      };
      batch.quizRows.push(quizRow);

      const questions = Array.isArray(quizDef.questions) ? quizDef.questions : [];
      questions.forEach((qDef, qIdx) => {
        const questionId = crypto.randomUUID();
        const questionType = normalizeQuestionType(qDef.questionType);
        const options = qDef.options || ["Option 1", "Option 2", "Option 3", "Option 4"];

        batch.questionRows.push({
          id: questionId,
          courseId: levelIds.courseId || courseId,
          moduleId: levelIds.moduleId || null,
          question: qDef.question || `Question ${qIdx + 1}`,
          questionType,
          options,
          correctAnswer: normalizeCorrectAnswer(qDef, questionType, options),
          explanation: qDef.explanation ?? null,
          marks: qDef.marks ? Number(qDef.marks) : 1,
          negativeMarks: qDef.negativeMarks ? Number(qDef.negativeMarks) : 0,
          difficulty: (qDef.difficulty || "MEDIUM").toUpperCase(),
          createdBy: instructorId,
        });

        batch.quizQuestionRows.push({
          id: crypto.randomUUID(),
          quizId,
          questionId,
          order: qIdx + 1,
          marks: qDef.marks ? Number(qDef.marks) : 1,
          isMandatory: true,
        });
      });

      return quizRow;
    };

    const newBatch = () => ({ contentRows: [], quizRows: [], questionRows: [], quizQuestionRows: [] });

    // Persists everything collected in `batch` with the minimum number of
    // round trips, in FK-safe order: Content only needs its topic to already
    // exist (guaranteed by the caller, which always flushes topics first);
    // Quiz only needs course/module/lesson/topic to already exist (same
    // guarantee); Question only needs course/module; QuizQuestion needs both
    // Quiz and Question, so it runs last, after both of those createMany()
    // calls above it in this same function.
    const flushBatch = async (batch) => {
      if (batch.contentRows.length > 0) await tx.content.createMany({ data: batch.contentRows });
      if (batch.quizRows.length > 0) await tx.quiz.createMany({ data: batch.quizRows });
      if (batch.questionRows.length > 0) await tx.question.createMany({ data: batch.questionRows });
      if (batch.quizQuestionRows.length > 0) await tx.quizQuestion.createMany({ data: batch.quizQuestionRows });
    };

    if (scopeUpper === "MODULE") {
      if (!courseId) throw new ApiError(400, "courseId is required to create a Module.");

      const targetOrder = await getPositionalOrderAndShift("module", { courseId }, position);

      const createdModule = await tx.module.create({
        data: {
          courseId,
          title: generatedData.title || "AI Generated Module",
          description: generatedData.description ?? "",
          order: targetOrder,
          isPublished: true,
        },
      });

      const batch = newBatch();

      // Module-level quizzes
      const modQuizzes = Array.isArray(generatedData.quizzes) ? generatedData.quizzes : [];
      for (const qz of modQuizzes) {
        collectQuizForBatch(qz, { courseId, moduleId: createdModule.id }, batch);
      }

      // Lessons (batched — one createMany for every lesson in this module)
      const lessons = Array.isArray(generatedData.lessons) ? generatedData.lessons : [];
      const lessonRows = lessons.map((lDef, lIdx) => ({
        id: crypto.randomUUID(),
        moduleId: createdModule.id,
        title: lDef.title || `Lesson ${lIdx + 1}`,
        description: lDef.description ?? "",
        order: lIdx + 1,
        isPublished: true,
      }));
      if (lessonRows.length > 0) await tx.lesson.createMany({ data: lessonRows });

      // Topics (batched — one createMany for every topic across every lesson)
      const topicRows = [];
      lessons.forEach((lDef, lIdx) => {
        const createdLessonId = lessonRows[lIdx].id;

        const lesQuizzes = Array.isArray(lDef.quizzes) ? lDef.quizzes : [];
        for (const qz of lesQuizzes) {
          collectQuizForBatch(qz, { courseId, moduleId: createdModule.id, lessonId: createdLessonId }, batch);
        }

        const topics = Array.isArray(lDef.topics) ? lDef.topics : [];
        topics.forEach((tDef, tIdx) => {
          const createdTopicId = crypto.randomUUID();
          topicRows.push({
            id: createdTopicId,
            lessonId: createdLessonId,
            title: tDef.title || `Topic ${tIdx + 1}`,
            description: tDef.description ?? "",
            order: tIdx + 1,
            isPublished: true,
          });

          if (tDef.quiz) {
            collectQuizForBatch(tDef.quiz, { courseId, moduleId: createdModule.id, lessonId: createdLessonId, topicId: createdTopicId }, batch);
          }

          const contents = Array.isArray(tDef.contents) ? tDef.contents : [];
          contents.forEach((cDef, cIdx) => {
            batch.contentRows.push(buildContentRow(cDef, createdTopicId, cIdx + 1, `Content Block ${cIdx + 1}`));
          });
        });
      });
      if (topicRows.length > 0) await tx.topic.createMany({ data: topicRows });

      // Content + Quiz + Question + QuizQuestion (batched — up to 4 more calls, total)
      await flushBatch(batch);

      return createdModule;
    } else if (scopeUpper === "LESSON") {
      const targetModuleId = moduleId;
      if (!targetModuleId) throw new ApiError(400, "moduleId is required to create a Lesson.");

      const targetOrder = await getPositionalOrderAndShift("lesson", { moduleId: targetModuleId }, position);

      const createdLesson = await tx.lesson.create({
        data: {
          moduleId: targetModuleId,
          title: generatedData.title || "AI Generated Lesson",
          description: generatedData.description ?? "",
          order: targetOrder,
          isPublished: true,
        },
      });

      const batch = newBatch();

      const lesQuizzes = Array.isArray(generatedData.quizzes) ? generatedData.quizzes : [];
      for (const qz of lesQuizzes) {
        collectQuizForBatch(qz, { courseId, moduleId: targetModuleId, lessonId: createdLesson.id }, batch);
      }

      const topics = Array.isArray(generatedData.topics) ? generatedData.topics : [];
      const topicRows = topics.map((tDef, tIdx) => ({
        id: crypto.randomUUID(),
        lessonId: createdLesson.id,
        title: tDef.title || `Topic ${tIdx + 1}`,
        description: tDef.description ?? "",
        order: tIdx + 1,
        isPublished: true,
      }));
      if (topicRows.length > 0) await tx.topic.createMany({ data: topicRows });

      topics.forEach((tDef, tIdx) => {
        const createdTopicId = topicRows[tIdx].id;

        if (tDef.quiz) {
          collectQuizForBatch(tDef.quiz, { courseId, moduleId: targetModuleId, lessonId: createdLesson.id, topicId: createdTopicId }, batch);
        }

        const contents = Array.isArray(tDef.contents) ? tDef.contents : [];
        contents.forEach((cDef, cIdx) => {
          batch.contentRows.push(buildContentRow(cDef, createdTopicId, cIdx + 1, `Content Block ${cIdx + 1}`));
        });
      });

      await flushBatch(batch);

      return createdLesson;
    } else if (scopeUpper === "TOPIC") {
      const targetLessonId = lessonId;
      if (!targetLessonId) throw new ApiError(400, "lessonId is required to create a Topic.");

      const targetOrder = await getPositionalOrderAndShift("topic", { lessonId: targetLessonId }, position);

      const createdTopic = await tx.topic.create({
        data: {
          lessonId: targetLessonId,
          title: generatedData.title || "AI Generated Topic",
          description: generatedData.description ?? "",
          order: targetOrder,
          isPublished: true,
        },
      });

      const batch = newBatch();

      if (generatedData.quiz) {
        collectQuizForBatch(generatedData.quiz, { courseId, moduleId, lessonId: targetLessonId, topicId: createdTopic.id }, batch);
      }

      const contents = Array.isArray(generatedData.contents) ? generatedData.contents : [];
      contents.forEach((cDef, cIdx) => {
        batch.contentRows.push(buildContentRow(cDef, createdTopic.id, cIdx + 1, `Content Block ${cIdx + 1}`));
      });

      await flushBatch(batch);

      return createdTopic;
    } else if (scopeUpper === "CONTENT") {
      const targetTopicId = topicId;
      if (!targetTopicId) throw new ApiError(400, "topicId is required to create Content blocks.");

      const contents = Array.isArray(generatedData.contents)
        ? generatedData.contents
        : Array.isArray(generatedData)
        ? generatedData
        : [generatedData];

      const startOrder = await getPositionalOrderAndShift("content", { topicId: targetTopicId }, position);

      const rows = contents.map((cDef, cIdx) => buildContentRow(cDef, targetTopicId, startOrder + cIdx, "Content Block"));
      if (rows.length === 0) return [];

      await tx.content.createMany({ data: rows });

      // createMany() does not return the created rows. Fetch them back by
      // the exact (topicId, order) range just written — safe and
      // deterministic because startOrder was computed as one past the max
      // existing order in this topic, so this range can never overlap a
      // pre-existing row (see getPositionalOrderAndShift above).
      const createdContents = await tx.content.findMany({
        where: { topicId: targetTopicId, order: { gte: startOrder, lt: startOrder + rows.length } },
        orderBy: { order: "asc" },
      });

      return createdContents;
    } else if (scopeUpper === "QUIZ") {
      const level = quizLevel || "COURSE";
      let levelModuleId = null;

      if (level === "MODULE" || level === "LESSON" || level === "TOPIC") {
        levelModuleId = moduleId || null;
      }

      const batch = newBatch();
      const quizRow = collectQuizForBatch(generatedData, { courseId, moduleId: levelModuleId, lessonId, topicId }, batch);
      if (!quizRow) return null;

      await flushBatch(batch);

      return { ...quizRow, createdAt: new Date(), updatedAt: new Date() };
    } else {
      throw new ApiError(400, `Unsupported scope '${scope}' for AI entity application.`);
    }
  }, {
    maxWait: 20000,
    timeout: 60000,
  });
};

module.exports = { createJob, createJsonJob, getJob, listJobs, processJob, updateCanonicalJson, importJob, deleteJob, applyAiEntity };
