const prisma = require("../config/database");

const verifyCertificateOwnership = async (
  req,
  res,
  next
) => {
  try {
    const certificate = await prisma.certificate.findUnique({
      where: {
        id: req.params.certificateId
      }
    });

    if (!certificate) {
      return res.status(404).json({
        message: "Certificate not found"
      });
    }

    if (
      req.user.role !== "ADMIN" &&
      certificate.userId !== req.user.id
    ) {
      return res.status(403).json({
        message: "Access denied"
      });
    }

    next();
  } catch (error) {
    next(error);
  }
};

module.exports = verifyCertificateOwnership;