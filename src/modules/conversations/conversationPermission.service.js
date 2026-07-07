const prisma = require("../../config/database");

/**
 * Check whether a user can create a direct conversation.
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
        throw new Error("You cannot create a conversation with yourself.");
    }

    const [sender, receiver] = await Promise.all([
        prisma.user.findUnique({
            where: { id: senderId },
            include: {
                studentProfile: true,
                teacherProfile: true,
                adminProfile: true,
            },
        }),

        prisma.user.findUnique({
            where: { id: receiverId },
            include: {
                studentProfile: true,
                teacherProfile: true,
                adminProfile: true,
            },
        }),
    ]);

    if (!sender || !receiver) {
        throw new Error("User not found.");
    }

    /**
     * ----------------------------------------------------
     * ADMIN -> Anyone
     * ----------------------------------------------------
     */
    if (sender.role === "ADMIN") {
        return true;
    }

    /**
     * ----------------------------------------------------
     * STUDENT -> INSTRUCTOR
     * ----------------------------------------------------
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
            throw new Error(
                "You can only create conversations with instructors of your enrolled courses."
            );
        }

        return true;
    }

    /**
     * ----------------------------------------------------
     * STUDENT -> STUDENT
     * ----------------------------------------------------
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
            throw new Error(
                "Students can create conversations only with classmates enrolled in the same course."
            );
        }

        return true;
    }

    /**
     * ----------------------------------------------------
     * INSTRUCTOR -> STUDENT
     * ----------------------------------------------------
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
            throw new Error(
                "You can only create conversations with students enrolled in your courses."
            );
        }

        return true;
    }

    /**
     * ----------------------------------------------------
     * INSTRUCTOR -> INSTRUCTOR
     * ----------------------------------------------------
     */
    if (
        sender.role === "INSTRUCTOR" &&
        receiver.role === "INSTRUCTOR"
    ) {
        throw new Error(
            "Instructors are not allowed to create conversations with other instructors."
        );
    }

    /**
     * ----------------------------------------------------
     * Everything Else
     * ----------------------------------------------------
     */
    throw new Error(
        "You are not authorized to create a conversation with this user."
    );
};

module.exports = {
    canCreateConversation,
};