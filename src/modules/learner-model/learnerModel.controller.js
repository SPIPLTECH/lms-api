const learnerModelService = require("./learnerModel.service");

const getLearnerState = async (req, res, next) => {
  try {
    const result = await learnerModelService.getLearnerState({
      callingUser: req.user,
      targetStudentId: req.query.studentId,
    });

    res.json({
      success: true,
      data: result,
    });
  } catch (error) {
    next(error);
  }
};

const initializeLearnerState = async (req, res, next) => {
  try {
    const result = await learnerModelService.initializeLearnerState({
      callingUser: req.user,
      data: req.body,
    });

    res.json({
      success: true,
      data: result,
    });
  } catch (error) {
    next(error);
  }
};

const recordEvidence = async (req, res, next) => {
  try {
    const result = await learnerModelService.recordEvidence({
      callingUser: req.user,
      data: req.body,
    });

    res.json({
      success: true,
      data: result,
    });
  } catch (error) {
    next(error);
  }
};

const recordMisconception = async (req, res, next) => {
  try {
    const result = await learnerModelService.recordMisconceptionState({
      callingUser: req.user,
      data: req.body,
    });

    res.json({
      success: true,
      data: result,
    });
  } catch (error) {
    next(error);
  }
};

const getPedagogicalDecision = async (req, res, next) => {
  try {
    const result = await learnerModelService.getPedagogicalDecision({
      callingUser: req.user,
      data: req.body,
    });

    res.json({
      success: true,
      data: result,
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getLearnerState,
  initializeLearnerState,
  recordEvidence,
  recordMisconception,
  getPedagogicalDecision,
};
