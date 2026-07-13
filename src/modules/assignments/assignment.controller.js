const assignmentService = require("./assignment.service");
const prisma = require("../../config/database");

const getStudentProfileId = async (userId) => {
    const studentProfile = await prisma.studentProfile.findUnique({
        where: { userId }
    });
    if (!studentProfile) {
        const err = new Error("Student profile not found.");
        err.statusCode = 404;
        throw err;
    }
    return studentProfile.id;
};

const getAssignments = async (req, res, next) => {
    try {
        const studentId = await getStudentProfileId(req.user.id);
        const assignments = await assignmentService.getAssignments(studentId);
        res.json({
            success: true,
            data: assignments,
        });
    } catch (error) {
        next(error);
    }
};

const getAssignmentById = async (req, res, next) => {
    try {
        const studentId = await getStudentProfileId(req.user.id);
        const assignment = await assignmentService.getAssignmentById(req.params.assignmentId, studentId);
        res.json({
            success: true,
            data: assignment,
        });
    } catch (error) {
        next(error);
    }
};

const submitAssignment = async (req, res, next) => {
    try {
        const studentId = await getStudentProfileId(req.user.id);
        const submission = await assignmentService.submitAssignment(req.params.assignmentId, studentId, req.body);
        res.json({
            success: true,
            message: "Assignment submitted successfully.",
            data: submission,
        });
    } catch (error) {
        next(error);
    }
};

module.exports = {
    getAssignments,
    getAssignmentById,
    submitAssignment,
};
