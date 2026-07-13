const prisma = require("../../config/database");

const getEvents = async () => {
    return await prisma.calendarEvent.findMany({
        orderBy: { date: "asc" }
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
    return await prisma.calendarEvent.delete({
        where: { id }
    });
};

module.exports = {
    getEvents,
    createEvent,
    deleteEvent,
};
