const prisma = require("../../config/database");
const {
  claimSequenceOrder,
  releaseSequenceOrder,
  mostSpecificParentField,
  assertCourseReorderAllowed,
} = require("../contents/contentOrder.util");
const {
    BREADCRUMB_INCLUDE,
    PARENT_FIELDS,
    COURSE_ID_INCLUDE,
    resolveCourseId,
    resolveBreadcrumb,
} = require("../../utils/helpers/courseBreadcrumb.helper");

const getAssignments = async (studentId) => {
    const assignments = await prisma.assignment.findMany({
        // Only assignments from courses this student is actually enrolled in —
        // previously unscoped, which returned every assignment in the system
        // to every student regardless of enrollment.
        where: {
            course: { enrollments: { some: { studentId } } }
        },
        include: {
            course: {
                select: {
                    id: true,
                    title: true,
                }
            },
            // Where in the course it sits, for the "Course · Module" line.
            module: { select: { title: true } },
            lesson: { select: { module: { select: { title: true } } } },
            topic: { select: { lesson: { select: { module: { select: { title: true } } } } } },
            submissions: {
                where: { studentId },
            }
        },
        orderBy: { createdAt: "desc" }
    });

    const assignmentItems = assignments.map(a => {
        const submission = a.submissions[0];
        let status = "Not Submitted";
        if (submission) {
            status = submission.status;
        }
        return {
            id: a.id,
            title: a.title,
            description: a.description,
            dueDate: a.dueDate,
            assessmentType: a.assessmentType,
            createdAt: a.createdAt,
            totalQuestions: a.totalQuestions,
            estimatedTime: a.estimatedTime,
            resources: a.resources,
            status,
            course: a.course,
            moduleTitle: a.module?.title || a.lesson?.module?.title || a.topic?.lesson?.module?.title || null,
            marks: a.marks ?? null,
            grade: submission?.grade || null,
            feedback: submission?.feedback || null,
            submittedAt: submission?.submittedAt || null,
            kind: "assignment",
        };
    });

    // Lesson-composer Assignment blocks (Content type ASSIGNMENT) from the
    // same enrolled courses, so the student's Assignments page lists — and
    // shows the grade and feedback for — both kinds in one place.
    const enrolled = { enrollments: { some: { studentId } } };
    const COURSE = { select: { id: true, title: true } };
    const contents = await prisma.content.findMany({
        where: {
            type: "ASSIGNMENT",
            OR: [
                { course: enrolled },
                { module: { course: enrolled } },
                { lesson: { module: { course: enrolled } } },
                { topic: { lesson: { module: { course: enrolled } } } },
            ],
        },
        include: {
            course: COURSE,
            module: { select: { title: true, course: COURSE } },
            lesson: { select: { module: { select: { title: true, course: COURSE } } } },
            topic: { select: { lessonId: true, lesson: { select: { module: { select: { title: true, course: COURSE } } } } } },
            submissions: { where: { studentId } },
        },
        orderBy: { createdAt: "desc" },
    });

    const contentItems = contents.map((c) => {
        const submission = c.submissions[0];
        return {
            id: c.id,
            kind: "content",
            title: c.title || "Assignment",
            description: c.htmlContent,
            dueDate: null,
            createdAt: c.createdAt,
            status: submission?.status || "Not Submitted",
            course:
                c.course ||
                c.module?.course ||
                c.lesson?.module?.course ||
                c.topic?.lesson?.module?.course ||
                null,
            moduleTitle: c.module?.title || c.lesson?.module?.title || c.topic?.lesson?.module?.title || null,
            // The course player deep-links by lesson; a topic's lesson works too.
            lessonId: c.lessonId || c.topic?.lessonId || null,
            grade: submission?.grade || null,
            feedback: submission?.feedback || null,
            submittedAt: submission?.submittedAt || null,
        };
    });

    return [...assignmentItems, ...contentItems];
};

const getAssignmentById = async (assignmentId, studentId) => {
    const a = await prisma.assignment.findUnique({
        where: { id: assignmentId },
        include: {
            course: {
                select: {
                    id: true,
                    title: true,
                }
            },
            submissions: {
                where: { studentId },
            }
        }
    });

    if (!a) {
        const err = new Error("Assignment not found.");
        err.statusCode = 404;
        throw err;
    }

    const submission = a.submissions[0];
    let status = "Not Submitted";
    if (submission) {
        status = submission.status;
    }

    return {
        id: a.id,
        title: a.title,
        description: a.description,
        dueDate: a.dueDate,
        totalQuestions: a.totalQuestions,
        estimatedTime: a.estimatedTime,
        resources: a.resources,
        status,
        course: a.course,
        // Instructor-provided reference material. NOT the student's answer —
        // the student's own upload is `submission` below. The learning
        // workspace shows these as two clearly separate sections, so the
        // response has to keep them separate too.
        attachments: Array.isArray(a.attachments) ? a.attachments : [],
        marks: a.marks,
        grade: submission?.grade || null,
        feedback: submission?.feedback || null,
        submittedAt: submission?.submittedAt || null,
        // The student's uploaded PDF, so they can see what they turned in.
        submission: submission
            ? {
                status: submission.status,
                fileUrl: submission.fileUrl || null,
                fileName: submission.fileName || null,
                fileSize: submission.fileSize || null,
                fileType: submission.fileType || null,
                textAnswer: submission.textAnswer || null,
                submittedAt: submission.submittedAt
            }
            : null,
    };
};

const submitAssignment = async (assignmentId, studentId, data) => {
    // `where` and `include` were each specified twice here; duplicate keys in
    // an object literal are legal JS (the last one silently wins), so the
    // behaviour was already that of the second pair. Collapsed to one of each,
    // and extended via COURSE_ID_INCLUDE so a SubTopic- or Concept-level
    // assignment resolves its course too. `course: true` is kept because
    // callers of this function read the full course relation.
    const assignment = await prisma.assignment.findUnique({
        where: { id: assignmentId },
        include: {
            course: true,
            ...COURSE_ID_INCLUDE,
        }
    });
    if (!assignment) {
        const err = new Error("Assignment not found.");
        err.statusCode = 404;
        throw err;
    }

    // One submission per student per assignment (@@unique) — resubmitting
    // replaces the stored PDF and timestamp rather than creating a second row.
    // That is the existing upsert semantics; only the file fields are new.
    const fileFields = {
        fileUrl: data?.fileUrl ?? null,
        fileName: data?.fileName ?? null,
        fileSize: data?.fileSize ?? null,
        fileType: data?.fileType ?? null,
        // "A PDF or a written answer" is enforced for HTTP callers by
        // submitAssignmentSchema; the service itself still accepts a bare
        // submission, as it always has (progress roll-up callers rely on it).
        textAnswer: data?.textAnswer?.trim() || null,
    };

    const submission = await prisma.assignmentSubmission.upsert({
        where: {
            studentId_assignmentId: {
                studentId,
                assignmentId
            }
        },
        update: {
            status: "Submitted",
            submittedAt: new Date(),
            // A resubmission replaces the graded PDF, so the old grade no
            // longer applies — it goes back to the instructor's ungraded list.
            grade: null,
            feedback: null,
            ...fileFields,
        },
        create: {
            studentId,
            assignmentId,
            status: "Submitted",
            ...fileFields,
        }
    });

    // Synchronize AssignmentProgress when assignment is submitted authoritatively
    try {
        const existingAp = await prisma.assignmentProgress.findUnique({
            where: { studentId_assignmentId: { studentId, assignmentId } }
        });
        await prisma.assignmentProgress.upsert({
            where: { studentId_assignmentId: { studentId, assignmentId } },
            create: {
                studentId,
                assignmentId,
                completed: true,
                completedAt: new Date()
            },
            update: {
                completed: true,
                completedAt: existingAp?.completedAt || new Date()
            }
        });
    } catch (apErr) {
        console.error("AssignmentProgress sync failed after assignment submission:", apErr);
    }

    const courseId = resolveCourseId(assignment);

    if (courseId) {
        try {
            const { recomputeCourseProgress } = require("../../utils/progressRollup");
            await recomputeCourseProgress(studentId, courseId);
        } catch (err) {
            console.error("Progress rollup recalculation failed after assignment submission:", err);
        }
    }

    return submission;
};

const getInstructorAssignments = async (instructorId, filter = {}) => {
    let courseId = typeof filter === "string" ? filter : filter.courseId;
    let moduleId = filter.moduleId;
    let lessonId = filter.lessonId;
    let topicId = filter.topicId;
    let subTopicId = filter.subTopicId;
    let conceptId = filter.conceptId;

    const where = {};
    if (courseId) {
        where.courseId = courseId;
    } else if (moduleId) {
        where.moduleId = moduleId;
    } else if (lessonId) {
        where.lessonId = lessonId;
    } else if (topicId) {
        where.topicId = topicId;
    } else if (subTopicId) {
        where.subTopicId = subTopicId;
    } else if (conceptId) {
        where.conceptId = conceptId;
    } else {
        where.OR = [
            { course: { creatorId: instructorId } },
            { module: { course: { creatorId: instructorId } } },
            { lesson: { module: { course: { creatorId: instructorId } } } },
            { topic: { lesson: { module: { course: { creatorId: instructorId } } } } },
            { subTopic: { topic: { lesson: { module: { course: { creatorId: instructorId } } } } } },
            {
                concept: {
                    subTopic: { topic: { lesson: { module: { course: { creatorId: instructorId } } } } },
                },
            },
        ];
    }

    const assignments = await prisma.assignment.findMany({
        where,
        include: {
            // Resolves Course / Module / Lesson / Topic from whichever level this
            // assignment hangs off, and carries the course enrollment total that
            // is the denominator of the instructor submission gauge.
            ...BREADCRUMB_INCLUDE,
            // Ungraded submissions only — this is what "pending review" means for
            // an assignment, not the assignment's own workflow `status` field.
            _count: {
                select: {
                    submissions: { where: { grade: null } }
                }
            },
            // The newest submissions per assignment, so a caller showing a
            // "recent submissions" feed has a student and a timestamp to
            // render. Capped here; the caller sorts and trims across them.
            submissions: {
                orderBy: { submittedAt: "desc" },
                take: 5,
                include: {
                    student: {
                        select: { id: true, user: { select: { id: true, name: true } } }
                    }
                }
            }
        },
        orderBy: {
            createdAt: "desc"
        }
    });

    // Total submissions per assignment — the gauge numerator. It needs its own
    // query because Prisma cannot alias two differently-filtered counts of the
    // same relation, and `_count.submissions` above is already the ungraded one.
    const totals = assignments.length
        ? await prisma.assignmentSubmission.groupBy({
            by: ["assignmentId"],
            where: { assignmentId: { in: assignments.map((a) => a.id) } },
            _count: { _all: true },
        })
        : [];
    const totalByAssignment = new Map(totals.map((t) => [t.assignmentId, t._count._all]));

    // `module` is aliased so it never shadows Node's module binding in this scope.
    return assignments.map(({ _count, submissions, course, module: mod, lesson, topic, ...assignment }) => {
        const { enrolledCount, ...breadcrumb } = resolveBreadcrumb({ course, module: mod, lesson, topic });

        return {
            ...assignment,
            ...breadcrumb,
            pendingSubmissionsCount: _count.submissions,
            submissionsCount: totalByAssignment.get(assignment.id) || 0,
            enrolledCount,
            // submissions is ordered newest-first, so its head IS the latest.
            lastSubmittedAt: submissions[0]?.submittedAt || null,
            submissions: submissions.map((sub) => ({
                id: sub.id,
                studentId: sub.studentId,
                studentName: sub.student?.user?.name || "Student",
                status: sub.status,
                grade: sub.grade,
                submittedAt: sub.submittedAt
            }))
        };
    });
};

/**
 * Every student submission for one assignment, for the owning instructor.
 *
 * Route-level ownership (verifyAssignmentOwnership) has already established the
 * caller owns this assignment, so this only shapes the rows: who submitted,
 * when, and the PDF they actually uploaded. `fileUrl` here is the STUDENT's
 * work — Assignment.attachments is the instructor's own reference material and
 * is deliberately not mixed into these rows.
 */
const getAssignmentSubmissions = async (assignmentId) => {
    const assignment = await prisma.assignment.findUnique({
        where: { id: assignmentId },
        // Relations resolve the Course / Module / Lesson / Topic heading the
        // detail page shows, so a deep link does not need the list query.
        select: { id: true, title: true, dueDate: true, marks: true, ...BREADCRUMB_INCLUDE }
    });

    if (!assignment) {
        const err = new Error("Assignment not found.");
        err.statusCode = 404;
        throw err;
    }

    const submissions = await prisma.assignmentSubmission.findMany({
        where: { assignmentId },
        orderBy: { submittedAt: "desc" },
        include: {
            student: {
                select: {
                    id: true,
                    user: { select: { id: true, name: true, email: true } }
                }
            }
        }
    });

    const { course, module: mod, lesson, topic, ...assignmentFields } = assignment;
    const { enrolledCount, ...breadcrumb } = resolveBreadcrumb({ course, module: mod, lesson, topic });

    return {
        assignment: { ...assignmentFields, ...breadcrumb, enrolledCount },
        submissions: submissions.map((s) => ({
            id: s.id,
            studentId: s.studentId,
            studentName: s.student?.user?.name || "Student",
            studentEmail: s.student?.user?.email || "",
            status: s.status,
            grade: s.grade,
            feedback: s.feedback,
            submittedAt: s.submittedAt,
            fileUrl: s.fileUrl || null,
            fileName: s.fileName || null,
            fileSize: s.fileSize || null,
            fileType: s.fileType || null,
            textAnswer: s.textAnswer || null
        }))
    };
};

/**
 * Instructor grades one student submission. Route-level ownership
 * (verifyAssignmentOwnership) has already run; the submission must belong to
 * this assignment, so a submissionId from another assignment is a 404.
 */
const gradeAssignmentSubmission = async (assignmentId, submissionId, { grade, feedback }) => {
    const existing = await prisma.assignmentSubmission.findFirst({
        where: { id: submissionId, assignmentId },
        select: { id: true }
    });

    if (!existing) {
        const err = new Error("Submission not found.");
        err.statusCode = 404;
        throw err;
    }

    const updated = await prisma.assignmentSubmission.update({
        where: { id: submissionId },
        data: { grade, feedback: feedback || null, status: "Graded" }
    });

    return {
        id: updated.id,
        status: updated.status,
        grade: updated.grade,
        feedback: updated.feedback
    };
};

const createAssignment = async (data) => {
    // PARENT_FIELDS is the shared six-level list, so this check and the
    // order-scope field below can never disagree about what a parent is.
    const presentParents = PARENT_FIELDS.filter((field) => data[field]);
    if (presentParents.length !== 1) {
        const error = new Error("Assignment must be attached to exactly one of course, module, lesson, topic, subtopic, or concept.");
        error.statusCode = 400;
        throw error;
    }

    const orderField = presentParents[0];

    // Appended to the parent's ONE common sequence, after its last Content,
    // Quiz, Assignment or child entity.
    return await prisma.$transaction(async (tx) => {
        const order = await claimSequenceOrder(orderField, data[orderField], null, tx, "assignment");

        return await tx.assignment.create({
            data: {
                title: data.title,
                description: data.description || null,
                dueDate: new Date(data.dueDate),
                order,
                totalQuestions: data.totalQuestions ? parseInt(data.totalQuestions) : 0,
                estimatedTime: data.estimatedTime ? parseInt(data.estimatedTime) : 0,
                resources: data.resources ? parseInt(data.resources) : 0,
                marks: data.marks !== undefined && data.marks !== null ? parseInt(data.marks) : null,
                assessmentType: data.assessmentType || null,
                attachments: data.attachments ?? undefined,
                courseId: data.courseId || null,
                moduleId: data.moduleId || null,
                lessonId: data.lessonId || null,
                topicId: data.topicId || null,
                subTopicId: data.subTopicId || null,
                conceptId: data.conceptId || null,
                isPublished: data.isPublished !== undefined ? data.isPublished : true,
            }
        });
    });
};

const updateAssignment = async (assignmentId, data) => {
    const existing = await prisma.assignment.findUnique({ where: { id: assignmentId } });
    if (!existing) {
        const error = new Error("Assignment not found");
        error.statusCode = 404;
        throw error;
    }

    return await prisma.assignment.update({
        where: { id: assignmentId },
        data: {
            title: data.title,
            description: data.description,
            dueDate: data.dueDate ? new Date(data.dueDate) : undefined,
            totalQuestions: data.totalQuestions !== undefined ? parseInt(data.totalQuestions) : undefined,
            estimatedTime: data.estimatedTime !== undefined ? parseInt(data.estimatedTime) : undefined,
            resources: data.resources !== undefined ? parseInt(data.resources) : undefined,
            marks: data.marks !== undefined ? (data.marks === null ? null : parseInt(data.marks)) : undefined,
            assessmentType: data.assessmentType !== undefined ? data.assessmentType : undefined,
            attachments: data.attachments !== undefined ? data.attachments : undefined,
            isPublished: data.isPublished !== undefined ? data.isPublished : undefined,
        }
    });
};

const deleteAssignment = async (assignmentId) => {
    const existing = await prisma.assignment.findUnique({ where: { id: assignmentId } });
    if (!existing) {
        const error = new Error("Assignment not found");
        error.statusCode = 404;
        throw error;
    }

    // Removing an item closes its slot in the parent's common sequence.
    return await prisma.$transaction(async (tx) => {
        const deleted = await tx.assignment.delete({
            where: { id: assignmentId }
        });
        const parentField = mostSpecificParentField(existing);
        await releaseSequenceOrder(parentField, parentField && existing[parentField], existing.order, tx);
        return deleted;
    });
};

// Two-phase reorder: mirrors quizService.reorderQuizzes and
// content.service.js's reorderContents exactly — move every row to a
// disjoint negative placeholder first, then to its final order, inside one
// transaction, so a direct swap never collides mid-flight.
const reorderAssignments = async (assignments) => {
  // Course level only: a course assignment stays between the modules and the
    // quizzes — it is the work that follows every module.
    await assertCourseReorderAllowed("assignment", assignments);

    const offsetUpdates = assignments.map((a, index) =>
        prisma.assignment.update({
            where: { id: a.id },
            data: { order: -1000 - index }
        })
    );

    const finalUpdates = assignments.map((a) =>
        prisma.assignment.update({
            where: { id: a.id },
            data: { order: a.order }
        })
    );

    return prisma.$transaction([...offsetUpdates, ...finalUpdates]);
};

module.exports = {
    getAssignments,
    getAssignmentById,
    submitAssignment,
    getInstructorAssignments,
    getAssignmentSubmissions,
    gradeAssignmentSubmission,
    createAssignment,
    updateAssignment,
    deleteAssignment,
    reorderAssignments,
};
