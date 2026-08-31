const ApiError = require("../utils/ApiError");

/**
 * Shared factory for "does this INSTRUCTOR own the course behind this resource"
 * checks. Every resource-ownership middleware in this app (course, module,
 * lesson, content, quiz, assignment, live class, certificate-management) is
 * built from this single function so the role/ownership logic only exists once.
 *
 * Contract enforced on every request, in order:
 *   1. Caller is authenticated (401 if not — defensive; verifyToken should
 *      already guarantee this on every route that reaches here).
 *   2. The referenced resource exists (404 if not — this is checked before
 *      any ownership comparison so we never leak existence via a 403).
 *   3. ADMIN always passes.
 *   4. Any other role must be INSTRUCTOR and must own the resource's course
 *      (403 otherwise).
 *
 * @param {object} options
 * @param {(req: import('express').Request) => string | undefined} options.getResourceId
 *   Pulls the id of the resource to check from the request (params or body).
 * @param {(id: string) => Promise<object | null>} options.findResource
 *   Prisma lookup for the resource. Must resolve enough of the relation chain
 *   for getCourseCreatorId to read the owning course's creatorId.
 * @param {(resource: object) => string | undefined} options.getCourseCreatorId
 *   Extracts the owning course's creatorId from the fetched resource.
 * @param {string} [options.notFoundMessage]
 * @param {string} [options.missingIdMessage]
 * @param {string} [options.attachAs]
 *   If set, the fetched resource is stashed on `req[attachAs]` so downstream
 *   controllers/services can reuse it instead of re-querying.
 */
const buildOwnershipCheck = ({
  getResourceId,
  findResource,
  getCourseCreatorId,
  notFoundMessage = "Resource not found",
  missingIdMessage = "Resource id is required",
  attachAs,
}) => {
  return async (req, res, next) => {
    try {
      if (!req.user) {
        return next(new ApiError(401, "Authentication required"));
      }

      const id = getResourceId(req);

      if (!id) {
        return next(new ApiError(400, missingIdMessage));
      }

      const resource = await findResource(id);

      if (!resource) {
        return next(new ApiError(404, notFoundMessage));
      }

      if (attachAs) {
        req[attachAs] = resource;
      }

      if (req.user.role === "ADMIN") {
        return next();
      }

      if (req.user.role !== "INSTRUCTOR") {
        return next(new ApiError(403, "Forbidden: insufficient role"));
      }

      const creatorId = getCourseCreatorId(resource);

      if (!creatorId || creatorId !== req.user.id) {
        return next(
          new ApiError(403, "Forbidden: you do not own this resource")
        );
      }

      next();
    } catch (error) {
      next(error);
    }
  };
};

module.exports = { buildOwnershipCheck };
