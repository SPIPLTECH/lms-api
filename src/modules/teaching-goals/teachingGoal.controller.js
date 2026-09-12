const teachingGoalService = require("./teachingGoal.service");

const getGoals = async (req, res, next) => {
  try {
    const goals = await teachingGoalService.getGoals(req.user.id);

    res.json({
      success: true,
      data: goals
    });
  } catch (error) {
    next(error);
  }
};

const createGoal = async (req, res, next) => {
  try {
    const goal = await teachingGoalService.createGoal(req.user.id, req.body);

    res.status(201).json({
      success: true,
      data: goal
    });
  } catch (error) {
    next(error);
  }
};

const updateGoal = async (req, res, next) => {
  try {
    const goal = await teachingGoalService.updateGoal(
      req.params.goalId,
      req.user.id,
      req.body
    );

    res.json({
      success: true,
      data: goal
    });
  } catch (error) {
    next(error);
  }
};

const deleteGoal = async (req, res, next) => {
  try {
    await teachingGoalService.deleteGoal(req.params.goalId, req.user.id);

    res.status(204).send();
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getGoals,
  createGoal,
  updateGoal,
  deleteGoal
};
