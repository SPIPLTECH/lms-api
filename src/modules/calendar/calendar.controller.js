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
        const event = await calendarService.createEvent(req.body);
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
