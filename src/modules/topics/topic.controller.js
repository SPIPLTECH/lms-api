const topicService = require("./topic.service");

const getTopics = async (req, res, next) => {
  try {
    const { lessonId } = req.query;

    const topics = await topicService.getTopics(
      lessonId,
      req.user.role,
      req.user.id
    );

    res.json(topics);
  } catch (error) {
    next(error);
  }
};

const getTopicById = async (req, res, next) => {
  try {
    const topic = await topicService.getTopicById(req.params.topicId);

    if (!topic) {
      return res.status(404).json({
        message: "Topic not found",
      });
    }

    res.json(topic);
  } catch (error) {
    next(error);
  }
};

const createTopic = async (req, res, next) => {
  try {
    const topic = await topicService.createTopic(req.body);

    res.status(201).json(topic);
  } catch (error) {
    next(error);
  }
};

const updateTopic = async (req, res, next) => {
  try {
    const topic = await topicService.updateTopic(
      req.params.topicId,
      req.body
    );

    res.json(topic);
  } catch (error) {
    next(error);
  }
};

const deleteTopic = async (req, res, next) => {
  try {
    await topicService.deleteTopic(req.params.topicId);

    res.status(204).send();
  } catch (error) {
    next(error);
  }
};

const reorderTopics = async (req, res, next) => {
  try {
    const result = await topicService.reorderTopics(
      req.body.lessonId,
      req.body.topics
    );

    res.json(result);
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getTopics,
  getTopicById,
  createTopic,
  updateTopic,
  deleteTopic,
  reorderTopics,
};
