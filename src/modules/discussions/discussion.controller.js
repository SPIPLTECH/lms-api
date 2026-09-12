const discussionService = require("./discussion.service");

const getDiscussions = async (req, res, next) => {
  try {
    const discussions = await discussionService.getDiscussionsForCourse(
      req.query.courseId,
      req.user
    );

    res.json({ success: true, data: discussions });
  } catch (error) {
    next(error);
  }
};

const createDiscussion = async (req, res, next) => {
  try {
    const discussion = await discussionService.createDiscussion(
      req.body.courseId,
      req.user,
      req.body
    );

    res.status(201).json({ success: true, data: discussion });
  } catch (error) {
    next(error);
  }
};

const replyToDiscussion = async (req, res, next) => {
  try {
    const reply = await discussionService.replyToDiscussion(
      req.params.discussionId,
      req.user,
      req.body.body
    );

    res.status(201).json({ success: true, data: reply });
  } catch (error) {
    next(error);
  }
};

const updateDiscussion = async (req, res, next) => {
  try {
    const discussion = await discussionService.updateDiscussion(
      req.params.discussionId,
      req.user,
      req.body
    );

    res.json({ success: true, data: discussion });
  } catch (error) {
    next(error);
  }
};

const deleteDiscussion = async (req, res, next) => {
  try {
    await discussionService.deleteDiscussion(req.params.discussionId, req.user);
    res.status(204).send();
  } catch (error) {
    next(error);
  }
};

const deleteReply = async (req, res, next) => {
  try {
    await discussionService.deleteReply(req.params.replyId, req.user);
    res.status(204).send();
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getDiscussions,
  createDiscussion,
  replyToDiscussion,
  updateDiscussion,
  deleteDiscussion,
  deleteReply
};
