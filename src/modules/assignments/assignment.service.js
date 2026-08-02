const prisma = require("../../config/database");

const getAssignments = async (studentId) => {
    const assignments = await prisma.assignment.findMany({
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
        where: { id: assignmentId }
    });
    if (!assignment) {
        const err = new Error("Assignment not found.");
        err.statusCode = 404;
        throw err;
    }

    return await prisma.assignmentSubmission.upsert({
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
};

const getInstructorAssignments = async (instructorId, courseId) => {
    const where = {};
    if (courseId) {
        where.courseId = courseId;
    } else {
        where.course = { creatorId: instructorId };
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
            courseId: data.courseId,
            isPublished: data.isPublished !== undefined ? data.isPublished : true,
        }
    });
};

const updateAssignment = async (assignmentId, data) => {
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
