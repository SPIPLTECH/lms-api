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
        if (req.user.role === "STUDENT") {
            const studentId = await getStudentProfileId(req.user.id);
            const assignments = await assignmentService.getAssignments(studentId);
            res.json({
                success: true,
                data: assignments,
            });
        } else {
            const assignments = await assignmentService.getInstructorAssignments(req.user.id, req.query.courseId);
            res.json({
                success: true,
                data: assignments,
            });
        }
    } catch (error) {
        next(error);
    }
};

const getAssignmentById = async (req, res, next) => {
    try {
        if (req.user.role === "STUDENT") {
            const studentId = await getStudentProfileId(req.user.id);
            const assignment = await assignmentService.getAssignmentById(req.params.assignmentId, studentId);
            res.json({
                success: true,
                data: assignment,
            });
        } else {
            // For instructor / admin, retrieve directly without student submissions check
            const assignment = await prisma.assignment.findUnique({
                where: { id: req.params.assignmentId },
                include: {
                    course: {
                        select: { id: true, title: true }
                    }
                }
            });
            if (!assignment) {
                return res.status(404).json({ message: "Assignment not found." });
            }
            res.json({
                success: true,
                data: assignment,
            });
        }
    } catch (error) {
        next(error);
    }
};

const createAssignment = async (req, res, next) => {
    try {
        const assignment = await assignmentService.createAssignment(req.body);
        res.status(201).json({
            success: true,
            data: assignment,
        });
    } catch (error) {
        next(error);
    }
};

const updateAssignment = async (req, res, next) => {
    try {
        const assignment = await assignmentService.updateAssignment(req.params.assignmentId, req.body);
        res.json({
            success: true,
            data: assignment,
        });
    } catch (error) {
        next(error);
    }
};

const deleteAssignment = async (req, res, next) => {
    try {
        await assignmentService.deleteAssignment(req.params.assignmentId);
        res.status(204).send();
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
    createAssignment,
    updateAssignment,
    deleteAssignment,
};
