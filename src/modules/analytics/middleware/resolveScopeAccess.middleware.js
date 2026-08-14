const prisma = require("../../../config/database");
const ApiError = require("../../../utils/ApiError");

const { assertStudentScopeAccess, assertInstructorScopeAccess, assertCourseScopeAccess, assertPlatformAccess } = require("../utils/accessControl.util");
const { SCOPE_TYPE, PLATFORM_SCOPE_ID } = require("../constants");

/**
 * Factory: extracts { scopeType, scopeId } via `getScope(req)` (query for
 * GET /kpis, /trends, /forecast; body for POST /recalculate) and asserts
 * the authenticated actor may see that scope before the controller runs —
 * dispatching to whichever of the four access rules applies. Attaches
 * req.resolvedScope for the controller to reuse.
 *
 * @param {(req: import('express').Request) => {scopeType?: string, scopeId?: string}} getScope
 */
const resolveScopeAccess = (getScope) => {
  return async (req, res, next) => {
    try {
      const { scopeType, scopeId: rawScopeId } = getScope(req);

      if (!scopeType || !Object.values(SCOPE_TYPE).includes(scopeType)) {
        throw new ApiError(400, `scopeType must be one of: ${Object.values(SCOPE_TYPE).join(", ")}`);
      }

      const scopeId = scopeType === SCOPE_TYPE.PLATFORM ? PLATFORM_SCOPE_ID : rawScopeId;
      if (!scopeId) throw new ApiError(400, "scopeId is required for this scopeType");

      switch (scopeType) {
        case SCOPE_TYPE.PLATFORM:
          assertPlatformAccess(req.analyticsActor);
          break;
        case SCOPE_TYPE.STUDENT:
          assertStudentScopeAccess(req.analyticsActor, scopeId);
          break;
        case SCOPE_TYPE.INSTRUCTOR:
          assertInstructorScopeAccess(req.analyticsActor, scopeId);
          break;
        case SCOPE_TYPE.COURSE: {
          const course = await prisma.course.findUnique({ where: { id: scopeId }, select: { id: true, creatorId: true } });
          if (!course) throw new ApiError(404, "Course not found");
          assertCourseScopeAccess(req.analyticsActor, course);
          break;
        }
      }

      req.resolvedScope = { scopeType, scopeId };
      next();
    } catch (error) {
      next(error);
    }
  };
};

module.exports = resolveScopeAccess;
