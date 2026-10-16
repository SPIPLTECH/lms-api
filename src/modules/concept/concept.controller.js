const conceptService = require("./concept.service");

const getConcepts = async (req, res, next) => {
  try {
    const { subTopicId } = req.query;

    const concepts = await conceptService.getConcepts(
      subTopicId,
      req.user.role,
      req.user.id
    );

    res.json(concepts);
  } catch (error) {
    next(error);
  }
};

const getConceptById = async (req, res, next) => {
  try {
    const concept = await conceptService.getConceptById(req.params.conceptId);

    if (!concept) {
      return res.status(404).json({
        message: "Concept not found",
      });
    }

    res.json(concept);
  } catch (error) {
    next(error);
  }
};

const createConcept = async (req, res, next) => {
  try {
    const concept = await conceptService.createConcept(req.body);

    res.status(201).json(concept);
  } catch (error) {
    next(error);
  }
};

const updateConcept = async (req, res, next) => {
  try {
    const concept = await conceptService.updateConcept(
      req.params.conceptId,
      req.body
    );

    res.json(concept);
  } catch (error) {
    next(error);
  }
};

const deleteConcept = async (req, res, next) => {
  try {
    await conceptService.deleteConcept(req.params.conceptId);

    res.status(204).send();
  } catch (error) {
    next(error);
  }
};

const reorderConcepts = async (req, res, next) => {
  try {
    const result = await conceptService.reorderConcepts(
      req.body.subTopicId,
      req.body.concepts
    );

    res.json(result);
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getConcepts,
  getConceptById,
  createConcept,
  updateConcept,
  deleteConcept,
  reorderConcepts,
};
