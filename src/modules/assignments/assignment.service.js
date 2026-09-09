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
        grade: submission?.grade || null,
        feedback: submission?.feedback || null,
        submittedAt: submission?.submittedAt || null,
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
        }
    });
    if (!assignment) {
        const err = new Error("Assignment not found.");
        err.statusCode = 404;
        throw err;
    }

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
        },
        create: {
            studentId,
            assignmentId,
            status: "Submitted",
        }
    });

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
            }
        },
        orderBy: {
            createdAt: "desc"
        }
    });

    return assignments.map(({ _count, ...assignment }) => ({
        ...assignment,
        pendingSubmissionsCount: _count.submissions
    }));
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
    createAssignment,
    updateAssignment,
    deleteAssignment,
};
