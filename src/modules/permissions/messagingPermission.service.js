const prisma = require("../../config/database");

/**
 * Validate whether two users are allowed to communicate.
 *
 * Business Rules:
 * 1. Admin -> Anyone
 * 2. Student -> Instructor (only enrolled instructor)
 * 3. Student -> Student (same course only)
 * 4. Instructor -> Student (only students enrolled in instructor's courses)
 * 5. Instructor -> Instructor (Not Allowed)
 */

const canCreateConversation = async (senderId, receiverId) => {
    if (senderId === receiverId) {
        const error = new Error("You cannot communicate with yourself.");
        error.statusCode = 400;
        throw error;
    }

    const [sender, receiver] = await Promise.all([
        prisma.user.findUnique({
            where: { id: senderId },
        }),

        prisma.user.findUnique({
            where: { id: receiverId },
        }),
    ]);

    if (!sender || !receiver) {
        const error = new Error("User not found.");
        error.statusCode = 404;
        throw error;
    }

    /*
    |--------------------------------------------------------------------------
    | ADMIN <-> Anyone
    |--------------------------------------------------------------------------
    */

    if (sender.role === "ADMIN" || receiver.role === "ADMIN") {
        return true;
    }

    /*
    |--------------------------------------------------------------------------
    | STUDENT -> INSTRUCTOR
    |--------------------------------------------------------------------------
    */

    if (
        sender.role === "STUDENT" &&
        receiver.role === "INSTRUCTOR"
    ) {
        const enrollment = await prisma.enrollment.findFirst({
            where: {
                student: {
                    userId: senderId,
                },
                course: {
                    creatorId: receiverId,
                },
            },
        });

        if (!enrollment) {
            const error = new Error(
                "You can communicate only with instructors of your enrolled courses."
            );
            error.statusCode = 403;
            throw error;
        }

        return true;
    }

    /*
    |--------------------------------------------------------------------------
    | STUDENT -> STUDENT
    |--------------------------------------------------------------------------
    */

    if (
        sender.role === "STUDENT" &&
        receiver.role === "STUDENT"
    ) {
        const senderCourses = await prisma.enrollment.findMany({
            where: {
                student: {
                    userId: senderId,
                },
            },
            select: {
                courseId: true,
            },
        });

        const courseIds = senderCourses.map(
            (course) => course.courseId
        );

        const commonCourse = await prisma.enrollment.findFirst({
            where: {
                student: {
                    userId: receiverId,
                },
                courseId: {
                    in: courseIds,
                },
            },
        });

        if (!commonCourse) {
            const error = new Error(
                "Students can communicate only with classmates enrolled in the same course."
            );
            error.statusCode = 403;
            throw error;
        }

        return true;
    }

    /*
    |--------------------------------------------------------------------------
    | INSTRUCTOR -> STUDENT
    |--------------------------------------------------------------------------
    */

    if (
        sender.role === "INSTRUCTOR" &&
        receiver.role === "STUDENT"
    ) {
        const enrollment = await prisma.enrollment.findFirst({
            where: {
                student: {
                    userId: receiverId,
                },
                course: {
                    creatorId: senderId,
                },
            },
        });

        if (!enrollment) {
            const error = new Error(
                "You can communicate only with students enrolled in your courses."
            );
            error.statusCode = 403;
            throw error;
        }

        return true;
    }

    /*
    |--------------------------------------------------------------------------
    | INSTRUCTOR -> INSTRUCTOR
    |--------------------------------------------------------------------------
    */

    if (
        sender.role === "INSTRUCTOR" &&
        receiver.role === "INSTRUCTOR"
    ) {
        const error = new Error(
            "Instructors are not allowed to communicate with other instructors."
        );
        error.statusCode = 403;
        throw error;
    }

    /*
    |--------------------------------------------------------------------------
    | Everything Else
    |--------------------------------------------------------------------------
    */

    const error = new Error(
        "You are not authorized to communicate with this user."
    );
    error.statusCode = 403;
    throw error;
};

module.exports = {
    canCreateConversation,
};