const calendarService = require("./calendar.service");

const getEvents = async (req, res, next) => {
    try {
        const events = await calendarService.getEvents(req.user);
        res.json({
            success: true,
            data: events,
        });
    } catch (error) {
        next(error);
    }
};

const createEvent = async (req, res, next) => {
    try {
        const eventData = { ...req.body };
        if (req.user) {
            eventData.instructorId = eventData.instructorId || req.user.id;
        }
        const event = await calendarService.createEvent(eventData);
        res.json({
            success: true,
            message: "Calendar event created successfully.",
            data: event,
        });
    } catch (error) {
        next(error);
    }
};

const deleteEvent = async (req, res, next) => {
    try {
        await calendarService.deleteEvent(req.params.eventId);
        res.json({
            success: true,
            message: "Calendar event deleted successfully.",
        });
    } catch (error) {
        next(error);
    }
};

module.exports = {
    getEvents,
    createEvent,
    deleteEvent,
};
