const prisma = require("../../config/database");

// Safety cap only — not a pagination page size. Prevents an unbounded scan/
// payload as calendar history grows; doesn't change which events show up
// within that cap (still ordered by date, most relevant events first).
const CALENDAR_EVENTS_LIMIT = 500;

const getEvents = async (user) => {
    try {
        if (!user) {
            return await prisma.calendarEvent.findMany({
                orderBy: { date: "asc" },
                take: CALENDAR_EVENTS_LIMIT,
            });
        }

        if (user.role === "STUDENT") {
            const student = await prisma.studentProfile.findUnique({
                where: { userId: user.id },
                select: {
                    enrollments: { select: { courseId: true } }
                }
            });
            const enrolledCourseIds = student?.enrollments.map(e => e.courseId) || [];
            return await prisma.calendarEvent.findMany({
                where: {
                    OR: [
                        { courseId: null },
                        { courseId: "" },
                        { courseId: { in: enrolledCourseIds } }
                    ]
                },
                orderBy: { date: "asc" },
                take: CALENDAR_EVENTS_LIMIT,
            });
        }
    } catch (error) {
        console.error("Error fetching calendar events:", error);
        return [];
    }

    if (user.role === "INSTRUCTOR") {
        return await prisma.calendarEvent.findMany({
            where: {
                OR: [
                    { instructorId: user.id },
                    { instructorId: "inst-current" }
                ]
            },
            orderBy: { date: "asc" },
            take: CALENDAR_EVENTS_LIMIT,
        });
    }

    return await prisma.calendarEvent.findMany({
        orderBy: { date: "asc" },
        take: CALENDAR_EVENTS_LIMIT,
    });
};

const createEvent = async (data) => {
    return await prisma.calendarEvent.create({
        data: {
            title: data.title,
            type: data.type,
            date: data.date,
            startTime: data.startTime || null,
            endTime: data.endTime || null,
            description: data.description || null,
            instructorId: data.instructorId || null,
            instructorName: data.instructorName || null,
            link: data.link || null,
            maxMarks: data.maxMarks ? parseInt(data.maxMarks, 10) : null,
            courseId: data.courseId || null,
            courseName: data.courseName || null,
        }
    });
};

const deleteEvent = async (id) => {
    const existing = await prisma.calendarEvent.findUnique({ where: { id } });

    if (!existing) {
        const error = new Error("Calendar event not found");
        error.statusCode = 404;
        throw error;
    }

    return await prisma.calendarEvent.delete({
        where: { id }
    });
};

module.exports = {
    getEvents,
    createEvent,
    deleteEvent,
};
