const prisma = require("../config/database");
const ApiError = require("../utils/ApiError");
const { buildOwnershipCheck } = require("./ownership.middleware");

const findCertificateWithOwners = (id) =>
  prisma.certificate.findUnique({
    where: { id },
    include: {
      student: { select: { userId: true } },
      course: { select: { creatorId: true } },
    },
  });

/**
 * Read access (GET /certificates/:certificateId): ADMIN, the INSTRUCTOR who
 * owns the certificate's course, or the STUDENT the certificate was issued
 * to. Everyone else is forbidden.
 *
 * This replaces a prior bug where the check compared against
 * `certificate.userId`, a field that doesn't exist on the Certificate model
 * (only `studentId` does) — the comparison was always `undefined !== id`,
 * so every non-admin request was denied, including the legitimate owner's.
 */
const verifyCertificateAccess = async (req, res, next) => {
  try {
    if (!req.user) {
      return next(new ApiError(401, "Authentication required"));
    }

    const { certificateId } = req.params;

    if (!certificateId) {
      return next(new ApiError(400, "certificateId is required"));
    }

    const certificate = await findCertificateWithOwners(certificateId);

    if (!certificate) {
      return next(new ApiError(404, "Certificate not found"));
    }

    req.certificate = certificate;

    const isAdmin = req.user.role === "ADMIN";
    const isOwningInstructor =
      req.user.role === "INSTRUCTOR" &&
      certificate.course?.creatorId === req.user.id;
    const isOwningStudent =
      req.user.role === "STUDENT" &&
      certificate.student?.userId === req.user.id;

    if (!isAdmin && !isOwningInstructor && !isOwningStudent) {
      return next(
        new ApiError(403, "Forbidden: you do not have access to this certificate")
      );
    }

    next();
  } catch (error) {
    next(error);
  }
};

/**
 * Write access (create/update/delete): ADMIN or the INSTRUCTOR who owns the
 * certificate's course. Students may view their own certificate but may
 * never issue, edit, or delete one.
 */
const verifyCertificateManage = buildOwnershipCheck({
  getResourceId: (req) => req.params.certificateId,
  findResource: findCertificateWithOwners,
  getCourseCreatorId: (certificate) => certificate.course?.creatorId,
  notFoundMessage: "Certificate not found",
  missingIdMessage: "certificateId is required",
  attachAs: "certificate",
});

module.exports = verifyCertificateAccess;
module.exports.verifyCertificateAccess = verifyCertificateAccess;
module.exports.verifyCertificateManage = verifyCertificateManage;
