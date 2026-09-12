const contentService = require(
  "./content.service"
);
const prisma = require("../../config/database");

const getContents = async (
  req,
  res,
  next
) => {
  try {
    const contents =
      await contentService.getContents(
        req.query,
        req.user.role,
        req.user.id
      );

    res.json(contents);
  } catch (error) {
    next(error);
  }
};

const getContentById = async (
  req,
  res,
  next
) => {
  try {
    const content =
      await contentService.getContentById(
        req.params.contentId
      );

    if (!content) {
      return res.status(404).json({
        message: "Content not found"
      });
    }

    res.json(content);
  } catch (error) {
    next(error);
  }
};

const createContent = async (
  req,
  res,
  next
) => {
  try {
    const content =
      await contentService.createContent(
        req.body
      );

    res.status(201).json(content);
  } catch (error) {
    next(error);
  }
};

const updateContent = async (
  req,
  res,
  next
) => {
  try {
    const content =
      await contentService.updateContent(
        req.params.contentId,
        req.body
      );

    res.json(content);
  } catch (error) {
    next(error);
  }
};

const deleteContent = async (
  req,
  res,
  next
) => {
  try {
    await contentService.deleteContent(
      req.params.contentId
    );

    res.status(204).send();
  } catch (error) {
    next(error);
  }
};

const reorderContents = async (
  req,
  res,
  next
) => {
  try {
    const result =
      await contentService.reorderContents(
        req.body.contents
      );

    res.json(result);
  } catch (error) {
    next(error);
  }
};

const getStudentProfileId = async (userId) => {
  const studentProfile = await prisma.studentProfile.findUnique({
    where: { userId }
  });
  if (!studentProfile) {
    const err = new Error("Student profile not found.");
    err.statusCode = 404;
    throw err;
  }
  return studentProfile.id;
};

const getMySubmission = async (
  req,
  res,
  next
) => {
  try {
    const studentId = await getStudentProfileId(req.user.id);
    const submission =
      await contentService.getMyContentSubmission(
        req.params.contentId,
        studentId,
        req.user
      );

    res.json({ success: true, data: submission });
  } catch (error) {
    next(error);
  }
};

const submitContent = async (
  req,
  res,
  next
) => {
  try {
    const studentId = await getStudentProfileId(req.user.id);
    const submission =
      await contentService.submitContentAssignment(
        req.params.contentId,
        studentId,
        req.body,
        req.user
      );

    res.json({
      success: true,
      message: "Assignment submitted successfully.",
      data: submission
    });
  } catch (error) {
    next(error);
  }
};

const getAssignmentContents = async (
  req,
  res,
  next
) => {
  try {
    const contents =
      await contentService.getInstructorAssignmentContents(
        req.user.id,
        req.user.role
      );

    res.json({ success: true, data: contents });
  } catch (error) {
    next(error);
  }
};

const getContentSubmissions = async (
  req,
  res,
  next
) => {
  try {
    const result =
      await contentService.getContentSubmissions(
        req.params.contentId
      );

    res.json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
};

const gradeContentSubmission = async (
  req,
  res,
  next
) => {
  try {
    const result =
      await contentService.gradeContentSubmission(
        req.params.contentId,
        req.params.submissionId,
        req.body
      );

    res.json({ success: true, message: "Grade saved.", data: result });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getContents,
  getContentById,
  createContent,
  updateContent,
  deleteContent,
  reorderContents,
  getMySubmission,
  submitContent,
  getAssignmentContents,
  getContentSubmissions,
  gradeContentSubmission
};