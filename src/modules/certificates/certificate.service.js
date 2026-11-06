const prisma = require("../../config/database");
const ApiError = require("../../utils/ApiError");
const { normalizeTemplateId, TEMPLATE_IDS } = require("../../utils/certificatePdf");

/**
 * Serializes template snapshot and optional remarks into instructorRemarks field.
 */
function serializeCertificateSnapshot({
  templateId = "CLASSIC_GOLD_V1",
  accentColor = null,
  signatoryName = null,
  signatoryTitle = null,
  remarks = null,
}) {
  return JSON.stringify({
    __snapshot: true,
    templateId: normalizeTemplateId(templateId),
    accentColor: accentColor || null,
    signatoryName: signatoryName || null,
    signatoryTitle: signatoryTitle || null,
    remarks: remarks || null,
  });
}

/**
 * Deserializes snapshotted template metadata and plain remarks from a certificate record.
 */
function deserializeCertificate(cert) {
  if (!cert) return null;

  let snapshotted = null;
  let cleanRemarks = cert.instructorRemarks;

  if (cleanRemarks && typeof cleanRemarks === "string" && cleanRemarks.trim().startsWith("{")) {
    try {
      const parsed = JSON.parse(cleanRemarks.trim());
      if (parsed && (parsed.__snapshot || parsed.templateId)) {
        snapshotted = {
          templateId: normalizeTemplateId(parsed.templateId),
          accentColor: parsed.accentColor || null,
          signatoryName: parsed.signatoryName || null,
          signatoryTitle: parsed.signatoryTitle || null,
        };
        cleanRemarks = parsed.remarks || null;
      }
    } catch {
      // Plain text, not JSON
    }
  }

  const courseTemplate = cert.course?.certificateTemplate;
  const rawTpl = snapshotted?.templateId || courseTemplate?.templateId || courseTemplate?.style || "CLASSIC_GOLD_V1";
  const templateId = normalizeTemplateId(rawTpl);
  const accentColor = snapshotted?.accentColor || courseTemplate?.accentColor || null;
  const signatoryName = snapshotted?.signatoryName || courseTemplate?.signatoryName || cert.course?.creator?.name || null;
  const signatoryTitle = snapshotted?.signatoryTitle || courseTemplate?.signatoryTitle || "Lead Instructor & Evaluator";

  return {
    ...cert,
    templateId,
    accentColor,
    signatoryName,
    signatoryTitle,
    instructorRemarks: cleanRemarks,
    _isTemplateSnapshotted: Boolean(snapshotted),
  };
}

const getCertificates = async (requester, studentId, courseId) => {
  const where = {};

  if (requester.role === "ADMIN") {
    if (studentId) where.studentId = studentId;
  } else if (requester.role === "INSTRUCTOR") {
    if (studentId) where.studentId = studentId;
    where.course = { creatorId: requester.id };
  } else {
    // Student can only see their own certificates
    where.studentId = studentId;
  }

  if (courseId) {
    where.courseId = courseId;
  }

  const certs = await prisma.certificate.findMany({
    where,
    include: {
      student: {
        include: {
          user: {
            select: {
              id: true,
              name: true,
              email: true,
            },
          },
        },
      },
      course: {
        select: {
          id: true,
          title: true,
          creatorId: true,
          certificatesEnabled: true,
          courseMemo: true,
          certificateTitle: true,
          certificateTemplate: true,
          creator: {
            select: { id: true, name: true, email: true },
          },
        },
      },
    },
    orderBy: {
      issuedAt: "desc",
    },
  });

  if (certs.length === 0) return [];

  const enrollments = await prisma.enrollment.findMany({
    where: {
      OR: certs.map((c) => ({
        studentId: c.studentId,
        courseId: c.courseId,
      })),
    },
    select: {
      studentId: true,
      courseId: true,
      enrolledAt: true,
      completedAt: true,
      completed: true,
      expiresAt: true,
    },
  });

  const enrollmentMap = new Map();
  for (const enr of enrollments) {
    enrollmentMap.set(`${enr.studentId}:${enr.courseId}`, enr);
  }

  return certs.map((c) => {
    const enr = enrollmentMap.get(`${c.studentId}:${c.courseId}`);
    const hydrated = {
      ...c,
      enrolledAt: enr?.enrolledAt || null,
      completedAt: enr?.completedAt || c.issuedAt,
    };
    return deserializeCertificate(hydrated);
  });
};

const getCertificateById = async (id) => {
  const cert = await prisma.certificate.findUnique({
    where: { id },
    include: {
      student: {
        include: {
          user: {
            select: {
              id: true,
              name: true,
              email: true,
            },
          },
        },
      },
      course: {
        select: {
          id: true,
          title: true,
          creatorId: true,
          certificatesEnabled: true,
          courseMemo: true,
          certificateTitle: true,
          certificateTemplate: true,
          creator: {
            select: { id: true, name: true, email: true },
          },
        },
      },
    },
  });

  if (!cert) {
    throw new ApiError(404, "Certificate not found");
  }

  const enrollment = await prisma.enrollment.findUnique({
    where: {
      studentId_courseId: {
        studentId: cert.studentId,
        courseId: cert.courseId,
      },
    },
    select: {
      enrolledAt: true,
      completedAt: true,
      completed: true,
      expiresAt: true,
    },
  });

  const hydrated = {
    ...cert,
    enrolledAt: enrollment?.enrolledAt || null,
    completedAt: enrollment?.completedAt || cert.issuedAt,
  };

  return deserializeCertificate(hydrated);
};

const createOrUpdateCertificate = async ({
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
}) => {
  const course = await prisma.course.findUnique({
    where: { id: courseId },
    select: {
      id: true,
      title: true,
      certificatesEnabled: true,
      courseMemo: true,
      certificateTemplate: true,
      creator: { select: { id: true, name: true } },
    },
  });
  if (!course) {
    throw new ApiError(404, "Course not found");
  }

  const enrollment = await prisma.enrollment.findUnique({
    where: {
      studentId_courseId: {
        studentId,
        courseId,
      },
    },
  });
  if (!enrollment) {
    throw new ApiError(400, "Student is not enrolled in this course");
  }
  if (!enrollment.completed) {
    throw new ApiError(400, "Cannot issue certificate: student has not completed the course");
  }

  const existing = await prisma.certificate.findUnique({
    where: {
      studentId_courseId: {
        studentId,
        courseId,
      },
    },
  });

  const parsedScore = score !== undefined && score !== null && score !== "" ? parseInt(score, 10) : undefined;
  const resolvedMemo = courseMemo !== undefined ? courseMemo : (course.courseMemo || null);

  const tConfig = course.certificateTemplate || {};
  const resolvedTemplateId = normalizeTemplateId(templateId || tConfig.templateId || tConfig.style || "CLASSIC_GOLD_V1");
  const resolvedAccentColor = accentColor !== undefined ? accentColor : (tConfig.accentColor || null);
  const resolvedSigName = signatoryName !== undefined ? signatoryName : (tConfig.signatoryName || course.creator?.name || null);
  const resolvedSigTitle = signatoryTitle !== undefined ? signatoryTitle : (tConfig.signatoryTitle || "Lead Instructor & Evaluator");

  const serializedRemarks = serializeCertificateSnapshot({
    templateId: resolvedTemplateId,
    accentColor: resolvedAccentColor,
    signatoryName: resolvedSigName,
    signatoryTitle: resolvedSigTitle,
    remarks: instructorRemarks || null,
  });

  if (existing) {
    // If existing already has a snapshot, preserve original template unless explicitly overridden
    let existingTemplateId = resolvedTemplateId;
    let existingAccent = resolvedAccentColor;
    let existingSig = resolvedSigName;
    let existingTit = resolvedSigTitle;

    if (existing.instructorRemarks && existing.instructorRemarks.trim().startsWith("{")) {
      try {
        const parsed = JSON.parse(existing.instructorRemarks);
        if (parsed && (parsed.__snapshot || parsed.templateId)) {
          existingTemplateId = templateId ? normalizeTemplateId(templateId) : normalizeTemplateId(parsed.templateId);
          existingAccent = accentColor !== undefined ? accentColor : (parsed.accentColor || resolvedAccentColor);
          existingSig = signatoryName !== undefined ? signatoryName : (parsed.signatoryName || resolvedSigName);
          existingTit = signatoryTitle !== undefined ? signatoryTitle : (parsed.signatoryTitle || resolvedSigTitle);
        }
      } catch {
        // Plain text
      }
    }

    const updatedSerialized = serializeCertificateSnapshot({
      templateId: existingTemplateId,
      accentColor: existingAccent,
      signatoryName: existingSig,
      signatoryTitle: existingTit,
      remarks: instructorRemarks !== undefined ? instructorRemarks : null,
    });

    const updated = await prisma.certificate.update({
      where: { id: existing.id },
      data: {
        courseMemo: resolvedMemo !== undefined ? resolvedMemo : existing.courseMemo,
        grade: grade !== undefined ? grade : existing.grade,
        score: parsedScore !== undefined ? parsedScore : existing.score,
        performanceDescription: performanceDescription !== undefined ? performanceDescription : existing.performanceDescription,
        instructorRemarks: updatedSerialized,
        brandingName: brandingName || existing.brandingName || "Course Ranger",
        brandingPoweredBy: brandingPoweredBy || existing.brandingPoweredBy || "Course Powered By SPIPL",
        issuedAt: issuedAt ? new Date(issuedAt) : existing.issuedAt,
      },
      include: {
        student: {
          include: {
            user: {
              select: { id: true, name: true, email: true },
            },
          },
        },
        course: {
          select: { id: true, title: true, certificateTemplate: true, creator: true },
        },
      },
    });

    return deserializeCertificate(updated);
  }

  const certificateNo = "CR-" + Math.random().toString(36).substring(2, 8).toUpperCase();

  const created = await prisma.certificate.create({
    data: {
      certificateNo,
      courseId,
      studentId,
      courseMemo: resolvedMemo,
      grade: grade || null,
      score: parsedScore ?? null,
      performanceDescription: performanceDescription || null,
      instructorRemarks: serializedRemarks,
      brandingName: brandingName || "Course Ranger",
      brandingPoweredBy: brandingPoweredBy || "Course Powered By SPIPL",
      issuedAt: issuedAt ? new Date(issuedAt) : (enrollment.completedAt || new Date()),
    },
    include: {
      student: {
        include: {
          user: {
            select: { id: true, name: true, email: true },
          },
        },
      },
      course: {
        select: { id: true, title: true, certificateTemplate: true, creator: true },
      },
    },
  });

  return deserializeCertificate(created);
};

const createCertificate = async (data) => {
  return createOrUpdateCertificate(data);
};

module.exports = {
  getCertificates,
  getCertificateById,
  createCertificate,
  createOrUpdateCertificate,
  serializeCertificateSnapshot,
  deserializeCertificate,
  normalizeTemplateId,
  TEMPLATE_IDS,
};
