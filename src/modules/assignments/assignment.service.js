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

module.exports = {
    getAssignments,
    getAssignmentById,
    submitAssignment,
};
