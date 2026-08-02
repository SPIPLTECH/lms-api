const examService = require("./exam.service");

const getExams = async (req, res, next) => {
  try {
    const exams = await examService.getInstructorExams(req.user.id, req.query.courseId);
    res.json({ success: true, data: exams });
  } catch (error) {
    next(error);
  }
};

const getExamById = async (req, res, next) => {
  try {
    const exam = await examService.getExamById(req.params.examId);
    res.json({ success: true, data: exam });
  } catch (error) {
    next(error);
  }
};

const createExam = async (req, res, next) => {
  try {
    const exam = await examService.createExam(req.body);
    res.status(201).json({ success: true, data: exam });
  } catch (error) {
    next(error);
  }
};

const updateExam = async (req, res, next) => {
  try {
    const exam = await examService.updateExam(req.params.examId, req.body);
    res.json({ success: true, data: exam });
  } catch (error) {
    next(error);
  }
};

const deleteExam = async (req, res, next) => {
  try {
    await examService.deleteExam(req.params.examId);
    res.status(204).send();
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getExams,
  getExamById,
  createExam,
  updateExam,
  deleteExam
};
