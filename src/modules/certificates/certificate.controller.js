const certificateService = require("./certificate.service");
const prisma = require("../../config/database");
const { generateCertificatePdf, generateCertificateFilename } = require("../../utils/certificatePdf");
const ApiError = require("../../utils/ApiError");

const getCertificates = async (req, res, next) => {
  try {
    let studentId = req.query.studentId;

    if (req.user.role === "STUDENT") {
      const student = await prisma.studentProfile.findUnique({
        where: {
          userId: req.user.id,
        },
      });

      if (!student) {
        return res.status(404).json({
          success: false,
          message: "Student profile not found",
        });
      }

      studentId = student.id;
    }

    const certificates = await certificateService.getCertificates(
      req.user,
      studentId,
      req.query.courseId
    );

    res.json({
      success: true,
      data: certificates,
    });
  } catch (error) {
    next(error);
  }
};

const getCertificateById = async (req, res, next) => {
  try {
    const certificateId = req.params.certificateId || req.params.id;
    const cert = await certificateService.getCertificateById(certificateId);

    res.json({
      success: true,
      data: cert,
    });
  } catch (error) {
    next(error);
  }
};

const downloadCertificatePdf = async (req, res, next) => {
  try {
    const certificateId = req.params.certificateId || req.params.id;
    const cert = await certificateService.getCertificateById(certificateId);

    const pdfBytes = await generateCertificatePdf({
      templateId: cert.templateId || cert.course?.certificateTemplate?.templateId || "CLASSIC_GOLD_V1",
      accentColor: cert.accentColor || cert.course?.certificateTemplate?.accentColor || null,
      studentName: cert.student?.user?.name || "Student",
      courseTitle: cert.course?.title || "Course",
      certificateTitle: cert.course?.certificateTitle || "Certificate of Completion",
      certificateNo: cert.certificateNo,
      issuedAt: cert.issuedAt,
      enrolledAt: cert.enrolledAt,
      completedAt: cert.completedAt,
      courseMemo: cert.courseMemo || cert.course?.courseMemo || null,
      grade: cert.grade,
      score: cert.score,
      performanceDescription: cert.performanceDescription,
      instructorRemarks: cert.instructorRemarks,
      instructorName: cert.signatoryName || cert.course?.creator?.name || null,
      signatoryName: cert.signatoryName || cert.course?.creator?.name || null,
      signatoryTitle: cert.signatoryTitle || "Lead Instructor & Evaluator",
      brandingName: cert.brandingName || "Course Ranger",
      brandingPoweredBy: cert.brandingPoweredBy || "Course Powered By SPIPL",
    });

    const buffer = Buffer.from(pdfBytes);
    const filename = generateCertificateFilename(cert);

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("Access-Control-Expose-Headers", "Content-Disposition");
    res.setHeader("Content-Length", buffer.length);
    res.status(200).send(buffer);
  } catch (error) {
    next(error);
  }
};

const createCertificate = async (req, res, next) => {
  try {
    const {
      courseId,
      userId,
      courseMemo,
      grade,
      score,
      performanceDescription,
      instructorRemarks,
      templateId,
      accentColor,
      signatoryName,
      signatoryTitle,
      brandingName,
      brandingPoweredBy,
      issuedAt,
    } = req.body;

    let studentId = req.body.studentId;
    if (userId && !studentId) {
      const profile = await prisma.studentProfile.findUnique({
        where: { userId: userId },
      });
      if (profile) studentId = profile.id;
      else studentId = userId;
    }

    if (!studentId) {
      return res.status(400).json({
        success: false,
        message: "studentId or userId is required",
      });
    }

    const cert = await certificateService.createOrUpdateCertificate({
      courseId,
      studentId,
      courseMemo,
      grade,
      score,
      performanceDescription,
      instructorRemarks,
      templateId,
      accentColor,
      signatoryName,
      signatoryTitle,
      brandingName,
      brandingPoweredBy,
      issuedAt,
    });

    res.status(201).json({
      success: true,
      data: cert,
      message: "Certificate generated / updated successfully",
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getCertificates,
  getCertificateById,
  downloadCertificatePdf,
  createCertificate,
};
