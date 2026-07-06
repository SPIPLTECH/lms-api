const certificateService = require("./certificate.service");
const prisma = require("../../config/database");

const getCertificates = async (req, res, next) => {
  try {
    let studentId = req.query.studentId;

    if (req.user.role === "STUDENT") {
      const student =
        await prisma.studentProfile.findUnique({
          where: {
            userId: req.user.id
          }
        });

      if (!student) {
        return res.status(404).json({
          success: false,
          message: "Student profile not found"
        });
      }

      studentId = student.id;
    }

    const certificates =
      await certificateService.getCertificates(
        req.user,
        studentId,
        req.query.courseId
      );

    res.json({
      success: true,
      data: certificates
    });
  } catch (error) {
    next(error);
  }
};

const getCertificateById = async (
  req,
  res,
  next
) => {
  try {
    const certificate =
      await certificateService.getCertificateById(
        req.params.certificateId
      );

    if (!certificate) {
      return res.status(404).json({
        success: false,
        message: "Certificate not found"
      });
    }

    res.json({
      success: true,
      data: certificate
    });
  } catch (error) {
    next(error);
  }
};

const deleteCertificate = async (
  req,
  res,
  next
) => {
  try {
    await certificateService.deleteCertificate(
      req.params.certificateId
    );

    res.json({
      success: true,
      message:
        "Certificate deleted successfully"
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getCertificates,
  getCertificateById,
  deleteCertificate
};