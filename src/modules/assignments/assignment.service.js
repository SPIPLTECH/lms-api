const prisma = require("../../config/database");

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
            submissions: {
                where: { studentId },
            }
        },
        orderBy: { createdAt: "desc" }
    });

    return assignments.map(a => {
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
            grade: submission?.grade || null,
            feedback: submission?.feedback || null,
        };
    });
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
                submittedAt: submission.submittedAt
            }
            : null,
    };
};

const submitAssignment = async (assignmentId, studentId, data) => {
    const assignment = await prisma.assignment.findUnique({
        where: { id: assignmentId },
        include: {
            course: true,
            module: { select: { courseId: true } },
            lesson: { include: { module: { select: { courseId: true } } } },
            topic: { include: { lesson: { include: { module: { select: { courseId: true } } } } } },
        },
        where: { id: assignmentId },
        include: {
            course: true,
            module: { select: { courseId: true } },
            lesson: { include: { module: { select: { courseId: true } } } },
            topic: { include: { lesson: { include: { module: { select: { courseId: true } } } } } },
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

    const courseId =
        assignment.courseId ||
        assignment.module?.courseId ||
        assignment.lesson?.module?.courseId ||
        assignment.topic?.lesson?.module?.courseId;

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

    const where = {};
    if (courseId) {
        where.courseId = courseId;
    } else if (moduleId) {
        where.moduleId = moduleId;
    } else if (lessonId) {
        where.lessonId = lessonId;
    } else if (topicId) {
        where.topicId = topicId;
    } else {
        where.OR = [
            { course: { creatorId: instructorId } },
            { module: { course: { creatorId: instructorId } } },
            { lesson: { module: { course: { creatorId: instructorId } } } },
            { topic: { lesson: { module: { course: { creatorId: instructorId } } } } },
        ];
    }

    const assignments = await prisma.assignment.findMany({
        where,
        include: {
            course: {
                select: {
                    id: true,
                    title: true,
                }
            },
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

    return assignments.map(({ _count, submissions, ...assignment }) => ({
        ...assignment,
        pendingSubmissionsCount: _count.submissions,
        submissions: submissions.map((sub) => ({
            id: sub.id,
            studentId: sub.studentId,
            studentName: sub.student?.user?.name || "Student",
            status: sub.status,
            grade: sub.grade,
            submittedAt: sub.submittedAt
        }))
    }));
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
        select: { id: true, title: true, dueDate: true, marks: true }
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

    return {
        assignment,
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
            fileType: s.fileType || null
        }))
    };
};

const createAssignment = async (data) => {
    const parents = [data.courseId, data.moduleId, data.lessonId, data.topicId].filter(Boolean);
    if (parents.length !== 1) {
        const error = new Error("Assignment must be attached to exactly one of course, module, lesson, or topic.");
        error.statusCode = 400;
        throw error;
    }

    return await prisma.assignment.create({
        data: {
            title: data.title,
            description: data.description || null,
            dueDate: new Date(data.dueDate),
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
            isPublished: data.isPublished !== undefined ? data.isPublished : true,
        }
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

    return await prisma.assignment.delete({
        where: { id: assignmentId }
    });
};

module.exports = {
    getAssignments,
    getAssignmentById,
    submitAssignment,
    getInstructorAssignments,
    getAssignmentSubmissions,
    createAssignment,
    updateAssignment,
    deleteAssignment,
};
