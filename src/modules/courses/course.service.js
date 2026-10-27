const prisma = require("../../config/database");
const notificationService = require("../notifications/notification.service");
const ApiError = require("../../utils/ApiError");
const { buildLessonLockMap } = require("../../utils/dripAccess");

/**
 * Batched stats block for the course card / workspace overview — one set of
 * grouped queries covering every course in `courseIds`, not a per-course
 * round-trip. Every number here is real (derived from actual rows); fields
 * with genuinely no signal (e.g. a course with no reviews yet) come back 0
 * or null rather than a fabricated placeholder.
 */
const buildCourseStatsMap = async (courseIds) => {
  const statsMap = new Map(
    courseIds.map((id) => [
      id,
      {
        lessonsCount: 0,
        contentsCount: 0,
        questionsCount: 0,
        avgRating: 0,
        certificatesIssuedCount: 0,
        pendingSubmissionsCount: 0,
        pendingDoubtsCount: 0,
        completionRate: 0,
        videosCount: 0,
        pdfsCount: 0,
        notesCount: 0,
        activeStudents: 0,
        inactiveStudents: 0,
        contentHealth: "Needs Work",
        engagementHealth: "Needs Work",
        recentActivity: []
      }
    ])
  );

  if (courseIds.length === 0) return statsMap;

  const [
    modules,
    quizQuestions,
    reviewAverages,
    certificateCounts,
    pendingSubmissions,
    pendingDoubts,
    enrollments,
    contentsList,
    coursesData
  ] = await Promise.all([
    prisma.module.findMany({
      where: { courseId: { in: courseIds } },
      select: {
        courseId: true,
        createdAt: true,
        lessons: { select: { id: true, topics: { select: { _count: { select: { contents: true } } } } } }
      }
    }),
    prisma.quizQuestion.findMany({
      where: { quiz: { courseId: { in: courseIds } } },
      select: { questionId: true, quiz: { select: { courseId: true } } }
    }),
    prisma.review.groupBy({
      by: ["courseId"],
      where: { courseId: { in: courseIds } },
      _avg: { rating: true }
    }),
    prisma.certificate.groupBy({
      by: ["courseId"],
      where: { courseId: { in: courseIds } },
      _count: { id: true }
    }),
    prisma.assignmentSubmission.findMany({
      where: { grade: null, assignment: { courseId: { in: courseIds } } },
      select: { assignment: { select: { courseId: true } } }
    }),
    prisma.lessonQuery.findMany({
      where: { status: "PENDING", lesson: { module: { courseId: { in: courseIds } } } },
      select: { lesson: { select: { module: { select: { courseId: true } } } } }
    }),
    prisma.enrollment.findMany({
      where: { courseId: { in: courseIds } },
      select: {
        courseId: true,
        studentId: true,
        enrolledAt: true
      }
    }),
    prisma.content.findMany({
      where: { topic: { lesson: { module: { courseId: { in: courseIds } } } } },
      select: { type: true, topic: { select: { lesson: { select: { module: { select: { courseId: true } } } } } } }
    }),
    prisma.course.findMany({
      where: { id: { in: courseIds } },
      select: { id: true, createdAt: true, updatedAt: true }
    })
  ]);

  // Lessons + contents counts, grouped by course
  const questionSetByCourse = new Map();
  for (const module of modules) {
    const stats = statsMap.get(module.courseId);
    if (!stats) continue;
    stats.lessonsCount += module.lessons.length;
    stats.contentsCount += module.lessons.reduce(
      (sum, l) => sum + l.topics.reduce((tSum, t) => tSum + t._count.contents, 0),
      0
    );
  }

  // Type-specific content counts
  for (const content of contentsList) {
    const courseId = content.topic.lesson.module.courseId;
    const stats = statsMap.get(courseId);
    if (!stats) continue;
    
    if (content.type === "VIDEO") stats.videosCount += 1;
    else if (content.type === "PDF" || content.type === "DOCUMENT") stats.pdfsCount += 1;
    else if (content.type === "TEXT" || content.type === "HTML") stats.notesCount += 1;
  }

  // Distinct question count per course, via quizzes
  for (const qq of quizQuestions) {
    const courseId = qq.quiz.courseId;
    if (!questionSetByCourse.has(courseId)) questionSetByCourse.set(courseId, new Set());
    questionSetByCourse.get(courseId).add(qq.questionId);
  }
  for (const [courseId, set] of questionSetByCourse.entries()) {
    const stats = statsMap.get(courseId);
    if (stats) stats.questionsCount = set.size;
  }

  for (const row of reviewAverages) {
    const stats = statsMap.get(row.courseId);
    if (stats) stats.avgRating = row._avg.rating ? parseFloat(row._avg.rating.toFixed(1)) : 0;
  }

  for (const row of certificateCounts) {
    const stats = statsMap.get(row.courseId);
    if (stats) stats.certificatesIssuedCount = row._count.id;
  }

  for (const submission of pendingSubmissions) {
    const stats = statsMap.get(submission.assignment.courseId);
    if (stats) stats.pendingSubmissionsCount += 1;
  }

  for (const doubt of pendingDoubts) {
    const stats = statsMap.get(doubt.lesson.module.courseId);
    if (stats) stats.pendingDoubtsCount += 1;
  }

  // Course-level completion rate: average, across enrolled students, of
  // (lessons that student completed / total lessons in the course).
  const lessonIdsByCourse = new Map();
  for (const module of modules) {
    if (!lessonIdsByCourse.has(module.courseId)) lessonIdsByCourse.set(module.courseId, []);
    lessonIdsByCourse.get(module.courseId).push(...module.lessons.map((l) => l.id));
  }

  const allLessonIds = modules.flatMap((m) => m.lessons.map((l) => l.id));
  const allStudentIds = [...new Set(enrollments.map((e) => e.studentId))];

  const progressRows =
    allLessonIds.length > 0 && allStudentIds.length > 0
      ? await prisma.lessonProgress.findMany({
          where: { lessonId: { in: allLessonIds }, studentId: { in: allStudentIds }, completed: true },
          select: { lessonId: true, studentId: true }
        })
      : [];

  const lessonToCourseId = new Map();
  for (const module of modules) {
    for (const lesson of module.lessons) lessonToCourseId.set(lesson.id, module.courseId);
  }

  const completedCountByStudentCourse = new Map();
  for (const row of progressRows) {
    const courseId = lessonToCourseId.get(row.lessonId);
    if (!courseId) continue;
    const key = `${courseId}::${row.studentId}`;
    completedCountByStudentCourse.set(key, (completedCountByStudentCourse.get(key) || 0) + 1);
  }

  const enrollmentsByCourse = new Map();
  for (const e of enrollments) {
    if (!enrollmentsByCourse.has(e.courseId)) enrollmentsByCourse.set(e.courseId, []);
    enrollmentsByCourse.get(e.courseId).push(e.studentId);
  }

  for (const [courseId, studentIds] of enrollmentsByCourse.entries()) {
    const totalLessons = (lessonIdsByCourse.get(courseId) || []).length;
    const stats = statsMap.get(courseId);
    if (!stats || totalLessons === 0 || studentIds.length === 0) continue;

    const percentages = studentIds.map((studentId) => {
      const completed = completedCountByStudentCourse.get(`${courseId}::${studentId}`) || 0;
      return (completed / totalLessons) * 100;
    });
    stats.completionRate = Math.round(percentages.reduce((sum, p) => sum + p, 0) / percentages.length);
    
    // Rough heuristic for active vs inactive students (if they have >0 completion, active)
    stats.activeStudents = percentages.filter((p) => p > 0).length;
    stats.inactiveStudents = percentages.filter((p) => p === 0).length;
    
    if (stats.completionRate > 50) stats.engagementHealth = "Healthy";
    else if (stats.completionRate > 20) stats.engagementHealth = "Average";
  }

  // Generate health metrics and recent activity timeline
  for (const courseId of courseIds) {
    const stats = statsMap.get(courseId);
    if (!stats) continue;

    // Content Health
    if (stats.lessonsCount > 0 && stats.videosCount > 0 && stats.pdfsCount > 0) {
      stats.contentHealth = "Excellent";
    } else if (stats.lessonsCount > 0 && (stats.videosCount > 0 || stats.pdfsCount > 0 || stats.notesCount > 0)) {
      stats.contentHealth = "Good";
    } else if (stats.lessonsCount > 0) {
      stats.contentHealth = "Fair";
    }

    // Recent Activity
    const activities = [];
    const courseInfo = coursesData.find((c) => c.id === courseId);
    if (courseInfo) {
      activities.push({
        type: "COURSE",
        title: "Course updated",
        subtitle: "Last saved",
        date: courseInfo.updatedAt || courseInfo.createdAt
      });
      
      const courseModules = modules.filter(m => m.courseId === courseId);
      if (courseModules.length > 0) {
        const latestModule = courseModules.reduce((latest, current) => 
          new Date(current.createdAt) > new Date(latest.createdAt) ? current : latest
        );
        activities.push({
          type: "MODULE",
          title: "New module added",
          subtitle: "Content expanded",
          date: latestModule.createdAt
        });
      }

      const courseEnrollments = enrollments.filter(e => e.courseId === courseId);
      if (courseEnrollments.length > 0) {
        const latestEnrollment = courseEnrollments.reduce((latest, current) => 
          new Date(current.enrolledAt) > new Date(latest.enrolledAt) ? current : latest
        );
        activities.push({
          type: "ENROLLMENT",
          title: "New student enrolled",
          subtitle: "Milestone reached",
          date: latestEnrollment.enrolledAt
        });
      }

      // Sort descending by date and take top 2
      activities.sort((a, b) => new Date(b.date) - new Date(a.date));
      stats.recentActivity = activities.slice(0, 2);
    }
  }

  return statsMap;
};

const attachCourseStats = async (courses) => {
  const list = Array.isArray(courses) ? courses : [courses];
  const statsMap = await buildCourseStatsMap(list.map((c) => c.id));
  const withStats = list.map((course) => ({ ...course, stats: statsMap.get(course.id) }));
  return Array.isArray(courses) ? withStats : withStats[0];
};

const SORT_MAP = {
  newest: { createdAt: "desc" },
  oldest: { createdAt: "asc" },
  recently_updated: { updatedAt: "desc" },
  recently_viewed: { lastViewedAt: { sort: "desc", nulls: "last" } },
  most_students: { enrollments: { _count: "desc" } },
  alphabetical: { title: "asc" },
};

const getCourses = async (
  role,
  userId,
  {
    search = "",
    page = 1,
    limit = 10,
    status,
    category,
    level,
    sortBy = "newest",
  } = {}
) => {
  const where = {};
  if (search) {
    where.OR = [
      { title: { contains: search, mode: "insensitive" } },
      { category: { contains: search, mode: "insensitive" } },
      { tags: { has: search } },
      { creator: { name: { contains: search, mode: "insensitive" } } },
    ];
  }

  const query = {
    where,
    skip: (page - 1) * limit,
    take: limit,
    orderBy: SORT_MAP[sortBy] || SORT_MAP.newest,
  };
  // Student should see only published courses

  const commonInclude = {
    creator: {
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        teacherProfile: true,
        adminProfile: true,
      },
    },
    _count: {
      select: {
        enrollments: true,
        modules: true,
        quizzes: true,
        assignments: true,
        reviews: true,
      },
    },
  };

  if (role === "ADMIN") {
    query.include = commonInclude;
    if (status) where.status = status;
  } else if (role === "INSTRUCTOR") {
    where.creatorId = userId;
    query.include = commonInclude;
    if (status) where.status = status;
  } else {
    where.status = "PUBLISHED";
    query.include = commonInclude;
  }

  if (category) where.category = category;
  if (level) where.level = level;

  const [courses, total] = await Promise.all([
    prisma.course.findMany(query),
    prisma.course.count({ where }),
  ]);

  return { courses: await attachCourseStats(courses), total };
};

// The course tree's levels, top down, with the id column each level's items
// (Content, Quiz, Assignment) point at it by.
const TREE_LEVELS = ["course", "module", "lesson", "topic", "subTopic", "concept"];
const LEVEL_KEY = {
  course: "courseId",
  module: "moduleId",
  lesson: "lessonId",
  topic: "topicId",
  subTopic: "subTopicId",
  concept: "conceptId",
};

// Every level's learning items, in Content.order — ordinary content plus
// the Content(type=QUIZ/ASSIGNMENT) rows that place quizzes and
// assignments, each carrying the Quiz/Assignment it stands for.
const CONTENT_ITEM_INCLUDE = {
  quiz: {
    select: {
      id: true,
      title: true,
      quizTag: true,
      passingScore: true,
      timeLimit: true,
      attempts: true,
      isPublished: true,
      _count: { select: { quizQuestions: true } },
    },
  },
  assignment: {
    select: { id: true, title: true, description: true, dueDate: true, marks: true, isPublished: true },
  },
};

const groupRows = (rows, key) => {
  const groups = new Map();
  for (const row of rows) {
    const id = row[key];
    if (id == null) continue;
    if (!groups.has(id)) groups.set(id, []);
    groups.get(id).push(row);
  }
  return groups;
};

/**
 * Every row of a course's tree: modules, lessons, topics, subtopics and
 * concepts (published ones only for students and guests), plus every Content
 * and Assignment placed anywhere in it. One flat read per table, all in
 * parallel.
 *
 * This replaces a nested Prisma include. Under relationJoins that include is
 * a single SQL query, and on a deep course (hundreds of subtopics and
 * concepts) it took the database server down; run as one query per level
 * instead, it cost ~6s of round trips.
 */
const loadCourseTreeRows = (courseId, publishedOnly) => {
  const inCourse = {
    module: { courseId },
    lesson: { module: { courseId } },
    topic: { lesson: { module: { courseId } } },
    subTopic: { topic: { lesson: { module: { courseId } } } },
    concept: { subTopic: { topic: { lesson: { module: { courseId } } } } },
  };
  const containers = (level) =>
    prisma[level].findMany({ where: { ...inCourse[level], ...publishedOnly }, orderBy: { order: "asc" } });
  const placedInCourse = {
    OR: [{ courseId }, ...TREE_LEVELS.slice(1).map((level) => ({ [level]: inCourse[level] }))],
  };

  return Promise.all([
    containers("module"),
    containers("lesson"),
    containers("topic"),
    containers("subTopic"),
    containers("concept"),
    prisma.content.findMany({ where: placedInCourse, orderBy: { order: "asc" }, include: CONTENT_ITEM_INCLUDE }),
    prisma.assignment.findMany({ where: placedInCourse, orderBy: { createdAt: "asc" } }),
  ]).then(([modules, lessons, topics, subTopics, concepts, contents, assignments]) => ({
    modules, lessons, topics, subTopics, concepts, contents, assignments,
  }));
};

/**
 * Nests loadCourseTreeRows' rows into the shape the old include returned:
 * course.contents/assignments and course.modules -> lessons -> topics ->
 * subTopics -> concepts, each node with its contents (every Content pointing
 * at it), its own quizzes and assignments (items whose most specific parent
 * it is), and, from topics down, _count.contents.
 *
 * `quizzes` is the course's quiz list, already filtered for the viewer.
 */
const assembleCourseTree = (courseId, quizzes, rows, publishedOnly) => {
  const contentsBy = Object.fromEntries(
    TREE_LEVELS.map((level) => [level, groupRows(rows.contents, LEVEL_KEY[level])])
  );
  // Own items only at each level — a quiz may still carry ancestor ids, but
  // it belongs to its most specific parent alone.
  const ownBy = (items, level) => {
    const deeper = TREE_LEVELS.slice(TREE_LEVELS.indexOf(level) + 1).map((l) => LEVEL_KEY[l]);
    return groupRows(items.filter((item) => deeper.every((key) => item[key] == null)), LEVEL_KEY[level]);
  };
  // Course-level assignments are not filtered by publication; every other
  // level's are, for students and guests.
  const publishedAssignments = publishedOnly ? rows.assignments.filter((a) => a.isPublished) : rows.assignments;
  const quizzesBy = Object.fromEntries(TREE_LEVELS.map((level) => [level, ownBy(quizzes, level)]));
  const assignmentsBy = Object.fromEntries(
    TREE_LEVELS.map((level) => [level, ownBy(level === "course" ? rows.assignments : publishedAssignments, level)])
  );

  const children = {
    lesson: groupRows(rows.lessons, "moduleId"),
    topic: groupRows(rows.topics, "lessonId"),
    subTopic: groupRows(rows.subTopics, "topicId"),
    concept: groupRows(rows.concepts, "subTopicId"),
  };
  const counted = new Set(["topic", "subTopic", "concept"]);
  const childList = { module: ["lessons", "lesson"], lesson: ["topics", "topic"], topic: ["subTopics", "subTopic"], subTopic: ["concepts", "concept"] };

  const node = (row, level) => {
    const contents = contentsBy[level].get(row.id) || [];
    const built = {
      ...row,
      contents,
      quizzes: quizzesBy[level].get(row.id) || [],
      assignments: assignmentsBy[level].get(row.id) || [],
      ...(counted.has(level) ? { _count: { contents: contents.length } } : {}),
    };
    if (childList[level]) {
      const [field, childLevel] = childList[level];
      built[field] = (children[childLevel].get(row.id) || []).map((child) => node(child, childLevel));
    }
    return built;
  };

  return {
    contents: contentsBy.course.get(courseId) || [],
    assignments: assignmentsBy.course.get(courseId) || [],
    modules: rows.modules.map((moduleRow) => node(moduleRow, "module")),
  };
};

/**
 * @param {object}  [options]
 * @param {boolean} [options.includeModules=true]
 *   When false, the `modules` relation (modules -> lessons -> topics ->
 *   contents, plus each level's quizzes and assignments) is omitted and only
 *   course-level data is returned.
 *
 *   Defaults to true so every existing caller keeps its current payload.
 *   Callers that only render course metadata — the breadcrumb in
 *   DashboardNavbar, the course-overview header, the edit form — opt out and
 *   avoid transferring every content cell body and every quiz answer key.
 */
const getCourseById = async (courseId, role, userId, options = {}) => {
  const { includeModules = true } = options;
  const isStudentOrGuest = role === "STUDENT" || role === "GUEST";

  // Every role reads a quiz's questions through GET /quizzes/:id (for a
  // student sequence-gated, answers withheld); the course tree only says how
  // many questions there are. Carrying every question of every quiz here made
  // a large course's response megabytes long, metadata-only calls included.
  const quizzesInclude = (where = {}) => ({
    where: { ...where, ...(isStudentOrGuest ? { quizTag: { not: "QUALIFYING" } } : {}) },
    orderBy: { createdAt: "asc" },
    include: { _count: { select: { quizQuestions: true } } },
  });

  // If role is STUDENT, check if student holds an active enrollment — profile
  // and enrollment in one round trip.
  let isEnrolledStudent = false;
  let studentProfileId = null;
  if (role === "STUDENT" && userId) {
    const studentProfile = await prisma.studentProfile.findUnique({
      where: { userId },
      select: { id: true, enrollments: { where: { courseId }, select: { id: true }, take: 1 } }
    });
    if (studentProfile) {
      studentProfileId = studentProfile.id;
      isEnrolledStudent = studentProfile.enrollments.length > 0;
    }
  }

  const publishedOnly = isStudentOrGuest ? { isPublished: true } : undefined;

  // The student's lock state does not depend on the tree query, so the two
  // run side by side instead of one after the other.
  const lockMapPromise =
    role === "STUDENT" && includeModules ? buildLessonLockMap(courseId, studentProfileId) : null;

  const coursePromise = prisma.course.findUnique({
    where: {
      id: courseId
    },
    include: {
      creator: {
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
          teacherProfile: true,
          adminProfile: true
        }
      },
      _count: {
        select: {
          enrollments: true,
          modules: true,
          quizzes: true,
          assignments: true,
          reviews: true,
        },
      },

      // Every quiz of the course, for counts and the instructor's quiz lists
      // — and the pool the tree's per-level quiz lists are taken from.
      quizzes: quizzesInclude(),
      // Enrollment row ids only — never other students' profile ids, and no
      // client reads more than the list's length (the count is in _count).
      enrollments: { select: { id: true } }
    }
  });

  // The deep tree, read alongside the course. Omitted entirely when
  // includeModules is false so metadata-only callers don't transfer it.
  const treePromise = includeModules ? loadCourseTreeRows(courseId, publishedOnly) : null;

  const [course, treeRows, lockState] = await Promise.all([coursePromise, treePromise, lockMapPromise]);

  if (!course) return null;

  if (treeRows) Object.assign(course, assembleCourseTree(courseId, course.quizzes, treeRows, publishedOnly));

  if (isStudentOrGuest && course.status !== "PUBLISHED" && !isEnrolledStudent) {
    return null;
  }

  if (lockState) {
    const { lockMap, completedSet, qualifiedSet, lockedContentIds } = lockState;

    // A student never receives the material of an item they may not open yet —
    // ordinary content, quiz or assignment, at any level.
    const withholdLocked = (node) => {
      if (!node?.contents) return;
      node.contents = node.contents.map((content) => {
        if (!lockedContentIds.has(content.id)) return content;
        const redacted = { ...content, locked: true, videoUrl: null, fileUrl: null, htmlContent: null, externalUrl: null, data: null };
        if (redacted.assignment) redacted.assignment = { ...redacted.assignment, description: null };
        return redacted;
      });
    };
    withholdLocked(course);
    course.modules.forEach((moduleItem) => {
      withholdLocked(moduleItem);
      moduleItem.lessons.forEach((lesson) => {
        const locked = lockMap.get(lesson.id) ?? false;
        lesson.locked = locked;
        lesson.completed = completedSet.has(lesson.id);
        // Skipped after passing this lesson's qualifying test. Kept apart
        // from `completed` so the UI can say which it was; the lesson's own
        // contents are deliberately still sent, because a skipped lesson
        // stays in the course and stays open to the student.
        lesson.qualified = qualifiedSet.has(lesson.id);
        if (locked) {
          lesson.topics = [];
          lesson.contents = [];
          lesson.quizzes = [];
          lesson.assignments = [];
          return;
        }
        withholdLocked(lesson);
        for (const topic of lesson.topics) {
          withholdLocked(topic);
          for (const subTopic of topic.subTopics || []) {
            withholdLocked(subTopic);
            for (const concept of subTopic.concepts || []) withholdLocked(concept);
          }
        }
      });
    });
  }

  // No card stats here: they are read only by the course cards, which come
  // from GET /courses, and building them costs ~10 queries per request.
  return course;
};

const createCourse = async (data, userId) => {
  return await prisma.course.create({
    data: {
      ...data,
      creatorId: userId
    }
  });
};

const updateCourse = async (courseId, data) => {
  return await prisma.course.update({
    where: {
      id: courseId
    },
    data
  });
};
/**
 * Validates whether a course is ready to be published.
 * Returns structured validation details: { canPublish: boolean, errors: Array<{ code, field, message }> }
 */
const validateCourseForPublish = async (courseId) => {
  const course = await prisma.course.findUnique({
    where: { id: courseId },
    include: {
      modules: {
        orderBy: { order: "asc" },
        include: {
          lessons: {
            orderBy: { order: "asc" },
            include: {
              contents: { orderBy: { order: "asc" } },
              topics: {
                orderBy: { order: "asc" },
                include: {
                  contents: { orderBy: { order: "asc" } },
                  // A lesson whose only real material lives in a SubTopic or
                  // Concept must still count as having content, or publishing
                  // a perfectly valid new-hierarchy course would be blocked
                  // with a false EMPTY_LESSON error.
                  subTopics: {
                    orderBy: { order: "asc" },
                    include: {
                      contents: { orderBy: { order: "asc" } },
                      concepts: {
                        orderBy: { order: "asc" },
                        include: { contents: { orderBy: { order: "asc" } } }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  });

  if (!course) {
    throw new ApiError(404, "Course not found");
  }

  const errors = [];

  if (!course.title || course.title.trim() === "") {
    errors.push({
      code: "MISSING_TITLE",
      field: "title",
      message: "Course title is required."
    });
  }

  if (!course.description || course.description.trim() === "") {
    errors.push({
      code: "MISSING_DESCRIPTION",
      field: "description",
      message: "Course description is required before publishing."
    });
  }

  if (!course.modules || course.modules.length === 0) {
    errors.push({
      code: "NO_MODULES",
      field: "modules",
      message: "Course must contain at least one module."
    });
  } else {
    for (let mIdx = 0; mIdx < course.modules.length; mIdx++) {
      const mod = course.modules[mIdx];
      if (!mod.lessons || mod.lessons.length === 0) {
        errors.push({
          code: "EMPTY_MODULE",
          field: `modules[${mIdx}].lessons`,
          message: `Module "${mod.title || `Module ${mIdx + 1}`}" must contain at least one lesson.`
        });
      } else {
        for (let lIdx = 0; lIdx < mod.lessons.length; lIdx++) {
          const lesson = mod.lessons[lIdx];
          // Content anywhere at or below the lesson counts toward "this
          // lesson has usable content" -- lesson-direct, topic-direct,
          // subtopic-direct or concept-direct.
          const lessonSubTopics = (lesson.topics || []).flatMap((t) => t.subTopics || []);
          const candidateContents = [
            ...(lesson.contents || []),
            ...(lesson.topics || []).flatMap((t) => t.contents || []),
            ...lessonSubTopics.flatMap((st) => st.contents || []),
            ...lessonSubTopics.flatMap((st) =>
              (st.concepts || []).flatMap((c) => c.contents || [])
            )
          ];
          const hasContent = candidateContents.some((c) => {
            if (!c) return false;
            // A quiz or assignment item is real learning material; its Content
            // row carries no body of its own.
            if ((c.type === "QUIZ" && c.quizId) || (c.type === "ASSIGNMENT" && c.assignmentId)) return true;
            if (typeof c.htmlContent === "string" && c.htmlContent.trim().length > 0) return true;
            if (typeof c.videoUrl === "string" && c.videoUrl.trim().length > 0) return true;
            if (typeof c.fileUrl === "string" && c.fileUrl.trim().length > 0) return true;
            if (typeof c.externalUrl === "string" && c.externalUrl.trim().length > 0) return true;
            if (c.data !== null && c.data !== undefined) {
              if (typeof c.data === "object" && Object.keys(c.data).length > 0) return true;
              if (typeof c.data === "string" && c.data.trim().length > 0) return true;
            }
            return false;
          });
          if (!hasContent) {
            errors.push({
              code: "EMPTY_LESSON",
              field: `modules[${mIdx}].lessons[${lIdx}].contents`,
              message: `Lesson "${lesson.title || `Lesson ${lIdx + 1}`}" in module "${mod.title}" must contain usable content.`
            });
          }
        }
      }
    }
  }

  return {
    canPublish: errors.length === 0,
    errors
  };
};

/**
 * Publishes a course (DRAFT -> PUBLISHED).
 */
const publishCourse = async (courseId, userId, userRole) => {
  const course = await prisma.course.findUnique({ where: { id: courseId } });
  if (!course) {
    throw new ApiError(404, "Course not found");
  }

  if (course.status === "ARCHIVED") {
    const error = new ApiError(400, "Archived courses cannot be published directly. Restore the course to DRAFT first.");
    error.code = "INVALID_STATUS_TRANSITION";
    throw error;
  }

  if (userRole !== "ADMIN" && course.creatorId !== userId) {
    throw new ApiError(403, "Forbidden: You do not own this course.");
  }

  // Reported, not enforced. Most courses already published predate this
  // check and would fail it (empty lessons, missing descriptions), so
  // blocking here would strand them — the instructor gets told what is
  // incomplete and still decides whether to publish.
  const validation = await validateCourseForPublish(courseId);

  const updatedCourse = await prisma.$transaction(async (tx) => {
    const courseObj = await tx.course.update({
      where: { id: courseId },
      data: {
        status: "PUBLISHED",
        publishedAt: course.publishedAt || new Date()
      }
    });

    await tx.module.updateMany({
      where: { courseId },
      data: { isPublished: true }
    });

    await tx.lesson.updateMany({
      where: { module: { courseId } },
      data: { isPublished: true }
    });

    await tx.topic.updateMany({
      where: { lesson: { module: { courseId } } },
      data: { isPublished: true }
    });

    // Without these two, SubTopics and Concepts would stay isPublished:false
    // after the course goes live. The roll-up filters every container on
    // isPublished, so their content would be invisible to students AND
    // excluded from progress -- the course would read 100% while whole
    // branches were unreachable.
    await tx.subTopic.updateMany({
      where: { topic: { lesson: { module: { courseId } } } },
      data: { isPublished: true }
    });

    await tx.concept.updateMany({
      where: { subTopic: { topic: { lesson: { module: { courseId } } } } },
      data: { isPublished: true }
    });

    return courseObj;
  });

  try {
    const eventTimestamp = updatedCourse.updatedAt ? new Date(updatedCourse.updatedAt).getTime() : Date.now();
    const eventIdPrefix = `course_published_${courseId}_${eventTimestamp}`;

    // 1. Notify enrolled students (actor is excluded inside notifyEnrolledStudents)
    await notificationService.notifyEnrolledStudents(
      courseId,
      {
        title: "Course Published 🚀",
        message: `Course "${updatedCourse.title}" is now published and active.`,
        type: "COURSE_STATUS",
        link: `/courses/${courseId}`,
        actorId: userId
      },
      eventIdPrefix,
      userId
    );

    // 2. Notify course creator if different from actor (e.g. when Admin publishes creator's course)
    // The creator notification exists only to tell the owner that somebody
    // ELSE changed their course. When the actor IS the owner there is nobody
    // left to inform, so the row is never produced. This is deliberately a
    // call-site condition and not only the actorId guard inside
    // createNotification: a future refactor that drops actorId must not be
    // able to silently resurrect self-notifications.
    if (updatedCourse.creatorId !== userId) {
      await notificationService.createNotification(updatedCourse.creatorId, {
        title: "Course Published 🚀",
        message: `Your course "${updatedCourse.title}" is now published and active.`,
        type: "COURSE_STATUS",
        link: `/courses/${courseId}`,
        eventId: eventIdPrefix,
        actorId: userId
      });
    }
  } catch (err) {
    console.error("Error sending publish notification:", err.message);
  }

  return { ...updatedCourse, publishWarnings: validation.errors };
};

/**
 * Unpublishes a course (PUBLISHED -> DRAFT).
 * Student learning data (enrollments, progress, quiz attempts) is strictly PRESERVED.
 */
const unpublishCourse = async (courseId, userId, userRole) => {
  const course = await prisma.course.findUnique({ where: { id: courseId } });
  if (!course) {
    throw new ApiError(404, "Course not found");
  }

  if (userRole !== "ADMIN" && course.creatorId !== userId) {
    throw new ApiError(403, "Forbidden: You do not own this course.");
  }

  const updatedCourse = await prisma.course.update({
    where: { id: courseId },
    data: {
      status: "DRAFT"
    }
  });

  try {
    // The creator notification exists only to tell the owner that somebody
    // ELSE changed their course. When the actor IS the owner there is nobody
    // left to inform, so the row is never produced. This is deliberately a
    // call-site condition and not only the actorId guard inside
    // createNotification: a future refactor that drops actorId must not be
    // able to silently resurrect self-notifications.
    if (updatedCourse.creatorId !== userId) {
      await notificationService.createNotification(updatedCourse.creatorId, {
        title: "Course Unpublished ✏️",
        message: `Your course "${updatedCourse.title}" has been unpublished and set back to DRAFT.`,
        type: "COURSE_STATUS",
        link: `/courses/${courseId}`,
        eventId: `course_unpublished_${courseId}_${updatedCourse.updatedAt ? new Date(updatedCourse.updatedAt).getTime() : Date.now()}`,
        actorId: userId
      });
    }
  } catch (err) {
    console.error("Error sending unpublish notification:", err.message);
  }

  return updatedCourse;
};

/**
 * Archives a course (ANY -> ARCHIVED). Admin-only lifecycle action.
 */
const archiveCourse = async (courseId, userId, userRole) => {
  const course = await prisma.course.findUnique({ where: { id: courseId } });
  if (!course) {
    throw new ApiError(404, "Course not found");
  }

  if (userRole !== "ADMIN") {
    throw new ApiError(403, "Forbidden: Archiving courses is restricted to administrators.");
  }

  const updatedCourse = await prisma.course.update({
    where: { id: courseId },
    data: {
      status: "ARCHIVED"
    }
  });

  try {
    // The creator notification exists only to tell the owner that somebody
    // ELSE changed their course. When the actor IS the owner there is nobody
    // left to inform, so the row is never produced. This is deliberately a
    // call-site condition and not only the actorId guard inside
    // createNotification: a future refactor that drops actorId must not be
    // able to silently resurrect self-notifications.
    if (updatedCourse.creatorId !== userId) {
      await notificationService.createNotification(updatedCourse.creatorId, {
        title: "Course Archived 📦",
        message: `Your course "${updatedCourse.title}" has been archived by an admin.`,
        type: "COURSE_STATUS",
        link: `/courses/${courseId}`,
        eventId: `course_archived_${courseId}_${updatedCourse.updatedAt ? new Date(updatedCourse.updatedAt).getTime() : Date.now()}`,
        actorId: userId
      });
    }
  } catch (err) {
    console.error("Error sending archive notification:", err.message);
  }

  return updatedCourse;
};

/**
 * Evaluates deletion safety and deletes a course if safe.
 */
const deleteCourse = async (courseId, userId, userRole) => {
  const course = await prisma.course.findUnique({
    where: { id: courseId },
    include: {
      _count: {
        select: {
          enrollments: true,
          reviews: true,
          certificates: true,
          assignments: true,
          exams: true
        }
      }
    }
  });

  if (!course) {
    throw new ApiError(404, "Course not found");
  }

  if (userRole !== "ADMIN" && course.creatorId !== userId) {
    throw new ApiError(403, "Forbidden: You do not own this course.");
  }

  // Instructors cannot delete published courses directly
  if (userRole !== "ADMIN" && course.status === "PUBLISHED") {
    const error = new ApiError(400, "Published courses cannot be directly deleted by instructors. Unpublish the course first.");
    error.code = "DELETE_NOT_ALLOWED";
    throw error;
  }

  // Inspect student and historical records
  const [
    quizSubmissionsCount,
    assignmentSubmissionsCount,
    progressCount,
    lessonQueriesCount,
    stickyNotesCount,
    studentStatesCount
  ] = await Promise.all([
    prisma.quizSubmission.count({ where: { quiz: { courseId } } }),
    prisma.assignmentSubmission.count({ where: { assignment: { courseId } } }),
    prisma.lessonProgress.count({ where: { lesson: { module: { courseId } } } }),
    prisma.lessonQuery.count({ where: { lesson: { module: { courseId } } } }),
    prisma.stickyNote.count({ where: { lesson: { module: { courseId } } } }),
    prisma.studentState.count({ where: { courseId } })
  ]);

  const hasStudentData =
    course._count.enrollments > 0 ||
    course._count.reviews > 0 ||
    course._count.certificates > 0 ||
    quizSubmissionsCount > 0 ||
    assignmentSubmissionsCount > 0 ||
    progressCount > 0 ||
    lessonQueriesCount > 0 ||
    stickyNotesCount > 0 ||
    studentStatesCount > 0;

  if (hasStudentData) {
    const error = new ApiError(
      400,
      "This course contains student or historical data and cannot be deleted. Archive the course instead to preserve data."
    );
    error.code = "COURSE_HAS_STUDENT_DATA";
    error.hasStudentData = true;
    throw error;
  }

  // Safe draft hard-deletion inside transaction
  return await prisma.$transaction(async (tx) => {
    const quizzes = await tx.quiz.findMany({
      where: { courseId },
      select: { id: true }
    });

    const quizIds = quizzes.map((q) => q.id);

    if (quizIds.length > 0) {
      await tx.quizQuestion.deleteMany({ where: { quizId: { in: quizIds } } });
      await tx.quizSubmission.deleteMany({ where: { quizId: { in: quizIds } } });
      await tx.quiz.deleteMany({ where: { id: { in: quizIds } } });
    }

    return await tx.course.delete({
      where: { id: courseId }
    });
  });
};

/**
 * Universal updateStatus adapter for backward compatibility.
 */
const updateStatus = async (courseId, status, userId, userRole) => {
  if (status === "PUBLISHED") {
    return await publishCourse(courseId, userId, userRole);
  } else if (status === "DRAFT") {
    return await unpublishCourse(courseId, userId, userRole);
  } else if (status === "ARCHIVED") {
    return await archiveCourse(courseId, userId, userRole);
  } else {
    throw new ApiError(400, `Invalid course status: ${status}`);
  }
};

/**
 * Restores an archived course (ARCHIVED -> DRAFT). Admin-only lifecycle action.
 */
const restoreCourse = async (courseId, userId, userRole) => {
  const course = await prisma.course.findUnique({ where: { id: courseId } });
  if (!course) {
    throw new ApiError(404, "Course not found");
  }

  if (userRole !== "ADMIN") {
    throw new ApiError(403, "Forbidden: Restoring archived courses is restricted to administrators.");
  }

  if (course.status !== "ARCHIVED") {
    const error = new ApiError(400, "Only archived courses can be restored.");
    error.code = "INVALID_STATUS_TRANSITION";
    throw error;
  }

  const updatedCourse = await prisma.course.update({
    where: { id: courseId },
    data: {
      status: "DRAFT"
    }
  });

  try {
    // The creator notification exists only to tell the owner that somebody
    // ELSE changed their course. When the actor IS the owner there is nobody
    // left to inform, so the row is never produced. This is deliberately a
    // call-site condition and not only the actorId guard inside
    // createNotification: a future refactor that drops actorId must not be
    // able to silently resurrect self-notifications.
    if (updatedCourse.creatorId !== userId) {
      await notificationService.createNotification(updatedCourse.creatorId, {
        title: "Course Restored 🔄",
        message: `Your archived course "${updatedCourse.title}" has been restored to DRAFT.`,
        type: "COURSE_STATUS",
        link: `/courses/${courseId}`,
        actorId: userId
      });
    }
  } catch (err) {
    console.error("Error sending restore notification:", err.message);
  }

  return updatedCourse;
};

/**
 * Stamps lastViewedAt on a course the instructor just opened — backs the My
 * Courses "Recently Viewed" tracking, mirroring how Enrollment.lastAccessedAt
 * tracks a student opening a course (see enrollment.service.js).
 * Scoped to creatorId in the query itself (rather than a separate ownership
 * lookup) so it silently no-ops for a course this instructor doesn't own.
 */
const trackCourseView = async (courseId, instructorId) => {
  if (!courseId || !instructorId) return null;
  try {
    return await prisma.course.update({
      where: { id: courseId, creatorId: instructorId },
      data: { lastViewedAt: new Date() },
    });
  } catch (error) {
    if (error.code === "P2025") return null;
    throw error;
  }
};

module.exports = {
  getCourses,
  getCourseById,
  createCourse,
  updateCourse,
  updateStatus,
  deleteCourse,
  publishCourse,
  unpublishCourse,
  restoreCourse,
  trackCourseView,
  validateCourseForPublish
};