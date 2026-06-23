const moduleService = require(
  "./module.service"
);

const getModules = async (
  req,
  res,
  next
) => {
  try {
    const modules =
      await moduleService.getModules(
        req.query.courseId
      );

    res.json(modules);
  } catch (error) {
    next(error);
  }
};

const getModuleById = async (
  req,
  res,
  next
) => {
  try {
    const module =
      await moduleService.getModuleById(
        req.params.moduleId
      );

    res.json(module);
  } catch (error) {
    next(error);
  }
};

const createModule = async (
  req,
  res,
  next
) => {
  try {
    const module =
      await moduleService.createModule(
        req.body
      );

    res.status(201).json({
      success: true,
      data: module
    });
  } catch (error) {
    next(error);
  }
};

const updateModule = async (
  req,
  res,
  next
) => {
  try {
    const module =
      await moduleService.updateModule(
        req.params.moduleId,
        req.body
      );

   res.json(modules);
  } catch (error) {
    next(error);
  }
};

const deleteModule = async (
  req,
  res,
  next
) => {
  try {
    await moduleService.deleteModule(
      req.params.moduleId
    );

    res.json({
      success: true,
      message:
        "Module deleted successfully"
    });
  } catch (error) {
    next(error);
  }
};

const reorderModules = async (
  req,
  res,
  next
) => {
  try {
    const result =
      await moduleService.reorderModules(
        req.body.modules
      );

    res.json(result);
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getModules,
  getModuleById,
  createModule,
  updateModule,
  deleteModule,
  reorderModules
};