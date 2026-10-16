const prisma = require("../../config/database");
const {
  claimContentOrder,
  releaseContentOrder,
  moveSequenceItems,
  mostSpecificParentField,
  singleParentPlacement,
} = require("../contents/contentOrder.util");
const {
    BREADCRUMB_INCLUDE,
    PARENT_FIELDS,
    COURSE_ID_INCLUDE,
    resolveCourseId,
    resolveBreadcrumb,
} = require("../../utils/helpers/courseBreadcrumb.helper");

// A course the student is enrolled in, reached from whichever of the six
// levels a row hangs off.
const enrolledVia = (studentId) => {
    const enrolled = { enrollments: { some: { studentId } } };
    return [
        { course: enrolled },
        { module: { course: enrolled } },
        { lesson: { module: { course: enrolled } } },
        { topic: { lesson: { module: { course: enrolled } } } },
        { subTopic: { topic: { lesson: { module: { course: enrolled } } } } },
        { concept: { subTopic: { topic: { lesson: { module: { course: enrolled } } } } } },
    ];
};

/**
 * Every assignment in the courses this student is enrolled in, at any level
 * of the hierarchy. (Matching on Assignment.course alone used to list only
 * course-level assignments: a module/lesson/topic assignment has no courseId
 * of its own.) The lesson composer's assignment blocks are Assignments too
 * now — each placed by its Content(type=ASSIGNMENT) row — so there is one
 * kind of assignment, listed once.
 */
const getAssignments = async (studentId) => {
    const COURSE = { select: { id: true, title: true } };
    const MODULE_PATH = { select: { id: true, title: true, course: COURSE } };
    const LESSON_PATH = { select: { id: true, module: MODULE_PATH } };
    const TOPIC_PATH = { select: { lessonId: true, lesson: LESSON_PATH } };
    const assignments = await prisma.assignment.findMany({
        where: { isPublished: true, OR: enrolledVia(studentId) },
        include: {
            course: COURSE,
            module: MODULE_PATH,
            lesson: LESSON_PATH,
            topic: TOPIC_PATH,
            subTopic: { select: { topic: TOPIC_PATH } },
            concept: { select: { subTopic: { select: { topic: TOPIC_PATH } } } },
            content: { select: { id: true } },
            submissions: {
                where: { studentId },
            }
        },
        orderBy: { createdAt: "desc" }
    });

    return assignments.map((a) => {
        const submission = a.submissions[0];
        const topic = a.topic || a.subTopic?.topic || a.concept?.subTopic?.topic || null;
        const lesson = a.lesson || topic?.lesson || null;
        const mod = a.module || lesson?.module || null;
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
            status: submission ? submission.status : "Not Submitted",
            course: a.course || mod?.course || null,
            moduleTitle: mod?.title || null,
            // The course player deep-links by lesson and by the item's Content row.
            lessonId: lesson?.id || null,
            contentId: a.content?.id || null,
            marks: a.marks ?? null,
            grade: submission?.grade || null,
            feedback: submission?.feedback || null,
            submittedAt: submission?.submittedAt || null,
            kind: "assignment",
        };
    });
};

const getAssignmentById = async (assignmentId, studentId) => {
    // A student opens a course assignment only once they have reached it in
    // the learning sequence (and only in a course they are enrolled in).
    if (studentId) {
        await require("../progress/progress.service").assertSequenceItemAccessible(studentId, { assignmentId });
    }

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

    // Same gate as opening it: an assignment the student has not reached yet
    // cannot be submitted either.
    await require("../progress/progress.service").assertSequenceItemAccessible(studentId, { assignmentId });

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

    // AssignmentProgress mirrors the submission for older readers. The item's
    // ContentProgress — its sequence-level progress — is set by the roll-up
    // below from the one completion rule (utils/itemCompletion.js).
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

/**
 * Creates an Assignment and its place in the learning sequence — its
 * Content(type=ASSIGNMENT) row — in one transaction, so neither can exist
 * without the other. `order` inserts it at that position of its parent's
 * sequence (every later item moves down one); omitted, it is appended.
 */
const createAssignment = async (data) => {
    const presentParents = PARENT_FIELDS.filter((field) => data[field]);
    if (presentParents.length !== 1) {
        const error = new Error("Assignment must be attached to exactly one of course, module, lesson, topic, subtopic, or concept.");
        error.statusCode = 400;
        throw error;
    }

    const requestedOrder = data.order !== undefined && data.order !== null ? Number(data.order) : null;

    return await prisma.$transaction(async (tx) => {
        const createdAssignment = await tx.assignment.create({
            data: {
                title: data.title,
                description: data.description || null,
                dueDate: data.dueDate ? new Date(data.dueDate) : null,
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

        await placeAssignmentInSequence(createdAssignment, requestedOrder, tx);
        return createdAssignment;
    });
};

/** Creates an assignment's Content(type=ASSIGNMENT) row at its parent's sequence position. */
const placeAssignmentInSequence = async (assignment, requestedOrder, tx) => {
    const placement = singleParentPlacement(assignment);
    if (!placement) return null;
    const order = await claimContentOrder(placement.parentField, placement.parentId, requestedOrder, tx);
    return tx.content.create({
        data: { type: "ASSIGNMENT", title: assignment.title, order, assignmentId: assignment.id, ...placement.data }
    });
};

/**
 * Updates an assignment. `order` moves it within its parent's learning
 * sequence (its Content row); a new title is the title the row shows.
 */
const updateAssignment = async (assignmentId, data) => {
    const existing = await prisma.assignment.findUnique({ where: { id: assignmentId } });
    if (!existing) {
        const error = new Error("Assignment not found");
        error.statusCode = 404;
        throw error;
    }

    return await prisma.$transaction(async (tx) => {
        const updated = await tx.assignment.update({
            where: { id: assignmentId },
            data: {
                title: data.title,
                description: data.description,
                dueDate: data.dueDate === null ? null : data.dueDate ? new Date(data.dueDate) : undefined,
                totalQuestions: data.totalQuestions !== undefined ? parseInt(data.totalQuestions) : undefined,
                estimatedTime: data.estimatedTime !== undefined ? parseInt(data.estimatedTime) : undefined,
                resources: data.resources !== undefined ? parseInt(data.resources) : undefined,
                marks: data.marks !== undefined ? (data.marks === null ? null : parseInt(data.marks)) : undefined,
                assessmentType: data.assessmentType !== undefined ? data.assessmentType : undefined,
                attachments: data.attachments !== undefined ? data.attachments : undefined,
                isPublished: data.isPublished !== undefined ? data.isPublished : undefined,
            }
        });

        const wrapper = await tx.content.findUnique({ where: { assignmentId } });
        if (wrapper) {
            if (data.order !== undefined && data.order !== null && Number(data.order) !== wrapper.order) {
                const parentField = mostSpecificParentField(wrapper);
                await moveSequenceItems(parentField, wrapper[parentField], [{ id: wrapper.id, order: Number(data.order) }], tx);
            }
            if (data.title && data.title !== wrapper.title) {
                await tx.content.update({ where: { id: wrapper.id }, data: { title: data.title } });
            }
        }

        return updated;
    });
};

/**
 * Deletes an assignment together with its place in the sequence, closing the
 * gap its Content row leaves so the sequence stays 1..n.
 */
const deleteAssignment = async (assignmentId) => {
    const existing = await prisma.assignment.findUnique({ where: { id: assignmentId } });
    if (!existing) {
        const error = new Error("Assignment not found");
        error.statusCode = 404;
        throw error;
    }

    return await prisma.$transaction(async (tx) => {
        const wrapper = await tx.content.findUnique({ where: { assignmentId } });
        if (wrapper) {
            await tx.content.delete({ where: { id: wrapper.id } });
            await releaseContentOrder(wrapper, tx);
        }
        return tx.assignment.delete({ where: { id: assignmentId } });
    });
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
    placeAssignmentInSequence,
};
