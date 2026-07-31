const prisma = require("../../config/database");
const ApiError = require("../../utils/ApiError");

const getGoals = async (instructorId) => {
  return prisma.teachingGoal.findMany({
    where: { instructorId },
    orderBy: { createdAt: "asc" }
  });
};

const createGoal = async (instructorId, data) => {
  return prisma.teachingGoal.create({
    data: {
      instructorId,
      label: data.label,
      target: data.target,
      current: data.current ?? 0,
      done: (data.current ?? 0) >= data.target
    }
  });
};

const findOwnedGoal = async (goalId, instructorId) => {
  const goal = await prisma.teachingGoal.findUnique({ where: { id: goalId } });

  if (!goal) {
    throw new ApiError(404, "Teaching goal not found");
  }

  if (goal.instructorId !== instructorId) {
    throw new ApiError(403, "Forbidden: you do not own this goal");
  }

  return goal;
};

const updateGoal = async (goalId, instructorId, data) => {
  const goal = await findOwnedGoal(goalId, instructorId);

  const label = data.label ?? goal.label;
  const target = data.target ?? goal.target;
  const current = data.current ?? goal.current;
  const done = data.done ?? current >= target;

  return prisma.teachingGoal.update({
    where: { id: goalId },
    data: { label, target, current, done }
  });
};

const deleteGoal = async (goalId, instructorId) => {
  await findOwnedGoal(goalId, instructorId);
  return prisma.teachingGoal.delete({ where: { id: goalId } });
};

module.exports = {
  getGoals,
  createGoal,
  updateGoal,
  deleteGoal
};
