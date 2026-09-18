const subTopicService = require("./subTopic.service");

const getSubTopics = async (req, res, next) => {
  try {
    const { topicId } = req.query;

    const subTopics = await subTopicService.getSubTopics(
      topicId,
      req.user.role,
      req.user.id
    );

    res.json(subTopics);
  } catch (error) {
    next(error);
  }
};

const getSubTopicById = async (req, res, next) => {
  try {
    const subTopic = await subTopicService.getSubTopicById(req.params.subTopicId);

    if (!subTopic) {
      return res.status(404).json({
        message: "SubTopic not found",
      });
    }

    res.json(subTopic);
  } catch (error) {
    next(error);
  }
};

const createSubTopic = async (req, res, next) => {
  try {
    const subTopic = await subTopicService.createSubTopic(req.body);

    res.status(201).json(subTopic);
  } catch (error) {
    next(error);
  }
};

const updateSubTopic = async (req, res, next) => {
  try {
    const subTopic = await subTopicService.updateSubTopic(
      req.params.subTopicId,
      req.body
    );

    res.json(subTopic);
  } catch (error) {
    next(error);
  }
};

const deleteSubTopic = async (req, res, next) => {
  try {
    await subTopicService.deleteSubTopic(req.params.subTopicId);

    res.status(204).send();
  } catch (error) {
    next(error);
  }
};

const reorderSubTopics = async (req, res, next) => {
  try {
    const result = await subTopicService.reorderSubTopics(
      req.body.topicId,
      req.body.subTopics
    );

    res.json(result);
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getSubTopics,
  getSubTopicById,
  createSubTopic,
  updateSubTopic,
  deleteSubTopic,
  reorderSubTopics,
};
