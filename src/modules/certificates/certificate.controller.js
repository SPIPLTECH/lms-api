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

const createCertificate = async (req, res, next) => {
  try {
    const { courseId, userId, issuedAt } = req.body;
    
    // Find student profile from userId or studentId
    let studentId = req.body.studentId;
    if (userId && !studentId) {
      const profile = await prisma.studentProfile.findUnique({
        where: { userId: userId }
      });
      if (profile) studentId = profile.id;
      else studentId = userId; // Fallback in case the frontend already passed the student profile ID as userId
    }

    const certificateNo = "CERT-" + Math.random().toString(36).substring(2, 8).toUpperCase();

    const cert = await certificateService.createCertificate({
      courseId,
      studentId,
      certificateNo,
      issuedAt: issuedAt ? new Date(issuedAt) : undefined,
    });

    res.status(201).json({
      success: true,
      data: cert,
      message: "Certificate created successfully"
    });
  } catch (error) {
    next(error);
  }
};

const updateCertificate = async (req, res, next) => {
  try {
    const { courseId, userId, issuedAt } = req.body;
    const { certificateId } = req.params;

    let studentId = req.body.studentId;
    if (userId && !studentId) {
      const profile = await prisma.studentProfile.findUnique({
        where: { userId: userId }
      });
      if (profile) studentId = profile.id;
      else studentId = userId;
    }

    const dataToUpdate = {};
    if (courseId) dataToUpdate.courseId = courseId;
    if (studentId) dataToUpdate.studentId = studentId;
    if (issuedAt) dataToUpdate.issuedAt = new Date(issuedAt);

    const cert = await certificateService.updateCertificate(certificateId, dataToUpdate);

    res.json({
      success: true,
      data: cert,
      message: "Certificate updated successfully"
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getCertificates,
  getCertificateById,
  deleteCertificate,
  createCertificate,
  updateCertificate
};