const contentService = require(
  "./content.service"
);

const getContents = async (
  req,
  res,
  next
) => {
  try {
    const contents =
      await contentService.getContents(
        req.query.lessonId
      );

    res.json(contents);
  } catch (error) {
    next(error);
  }
};

const getContentById = async (
  req,
  res,
  next
) => {
  try {
    const content =
      await contentService.getContentById(
        req.params.contentId
      );

    if (!content) {
      return res.status(404).json({
        message: "Content not found"
      });
    }

    res.json(content);
  } catch (error) {
    next(error);
  }
};

const createContent = async (
  req,
  res,
  next
) => {
  try {
    const content =
      await contentService.createContent(
        req.body
      );

    res.status(201).json(content);
  } catch (error) {
    next(error);
  }
};

const updateContent = async (
  req,
  res,
  next
) => {
  try {
    const content =
      await contentService.updateContent(
        req.params.contentId,
        req.body
      );

    res.json(content);
  } catch (error) {
    next(error);
  }
};

const deleteContent = async (
  req,
  res,
  next
) => {
  try {
    await contentService.deleteContent(
      req.params.contentId
    );

    res.status(204).send();
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getContents,
  getContentById,
  createContent,
  updateContent,
  deleteContent
};