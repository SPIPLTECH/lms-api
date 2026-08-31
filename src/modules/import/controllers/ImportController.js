const CourseImportService = require("../services/CourseImportService");

class ImportController {
  static async validateZip(req, res, next) {
    try {
      if (!req.file) {
        return res.status(400).json({
          success: false,
          message: "Please upload a ZIP file.",
        });
      }

      const result = await CourseImportService.validateZip(req.file.buffer);
      return res.status(200).json({
        success: true,
        data: result,
      });
    } catch (err) {
      next(err);
    }
  }

  static async importCourse(req, res, next) {
    try {
      if (!req.file) {
        return res.status(400).json({
          success: false,
          message: "Please upload a ZIP file.",
        });
      }

      const instructorId = req.user.id;
      const course = await CourseImportService.importCourse(req.file.buffer, instructorId);

      return res.status(201).json({
        success: true,
        message: "Course package imported successfully!",
        data: course,
      });
    } catch (err) {
      next(err);
    }
  }
}

module.exports = ImportController;
