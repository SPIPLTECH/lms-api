const adminService = require("./admin.service");

/* Dashboard */
const getDashboardStats = async (req, res, next) => {
  try {
    const stats = await adminService.getDashboardStats();

    res.json({
      success: true,
      message: "Dashboard stats fetched successfully",
      data: stats
    });
  } catch (error) {
    next(error);
  }
};

/* User Management */
const getUsers = async (req, res, next) => {
  try {
    const users = await adminService.getUsers();

    res.json({
      success: true,
      message: "Users fetched successfully",
      data: users
    });
  } catch (error) {
    next(error);
  }
};

const getUserById = async (req, res, next) => {
  try {
    const { id } = req.params;

    const user = await adminService.getUserById(id);

    res.json({
      success: true,
      message: "User fetched successfully",
      data: user
    });
  } catch (error) {
    next(error);
  }
};

const updateUser = async (req, res, next) => {
  try {
    const { id } = req.params;

    const updatedUser = await adminService.updateUser(
      id,
      req.body
    );

    res.json({
      success: true,
      message: "User updated successfully",
      data: updatedUser
    });
  } catch (error) {
    next(error);
  }
};

const updateUserStatus = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    const user = await adminService.updateUserStatus(
      id,
      status
    );

    res.json({
      success: true,
      message: "User status updated successfully",
      data: user
    });
  } catch (error) {
    next(error);
  }
};

const deleteUser = async (req, res, next) => {
  try {
    const { id } = req.params;

    await adminService.deleteUser(id);

    res.json({
      success: true,
      message: "User deleted successfully"
    });
  } catch (error) {
    next(error);
  }
};

/* Admin Management */
const createAdmin = async (req, res, next) => {
  try {
    const admin = await adminService.createAdmin(req.body);

    res.status(201).json({
      success: true,
      message: "Admin created successfully",
      data: admin
    });
  } catch (error) {
    next(error);
  }
};

const getAdmins = async (req, res, next) => {
  try {
    const admins = await adminService.getAdmins();

    res.json({
      success: true,
      message: "Admins fetched successfully",
      data: admins
    });
  } catch (error) {
    next(error);
  }
};

/* Course Management */
const getCourses = async (req, res, next) => {
  try {
    const courses = await adminService.getCourses();

    res.json({
      success: true,
      message: "Courses fetched successfully",
      data: courses
    });
  } catch (error) {
    next(error);
  }
};

const publishCourse = async (req, res, next) => {
  try {
    const { id } = req.params;

    const course = await adminService.publishCourse(id);

    res.json({
      success: true,
      message: "Course published successfully",
      data: course
    });
  } catch (error) {
    next(error);
  }
};

const archiveCourse = async (req, res, next) => {
  try {
    const { id } = req.params;

    const course = await adminService.archiveCourse(id);

    res.json({
      success: true,
      message: "Course archived successfully",
      data: course
    });
  } catch (error) {
    next(error);
  }
};

const deleteCourse = async (req, res, next) => {
  try {
    const { id } = req.params;

    await adminService.deleteCourse(id);

    res.json({
      success: true,
      message: "Course deleted successfully"
    });
  } catch (error) {
    next(error);
  }
};

/* Teacher Management */
const getTeachers = async (req, res, next) => {
  try {
    const teachers = await adminService.getTeachers();

    res.json({
      success: true,
      message: "Teachers fetched successfully",
      data: teachers
    });
  } catch (error) {
    next(error);
  }
};

const getTeacherById = async (req, res, next) => {
  try {
    const { id } = req.params;

    const teacher = await adminService.getTeacherById(id);

    res.json({
      success: true,
      message: "Teacher fetched successfully",
      data: teacher
    });
  } catch (error) {
    next(error);
  }
};

/* Monitoring */
const getEnrollments = async (req, res, next) => {
  try {
    const enrollments = await adminService.getEnrollments();

    res.json({
      success: true,
      message: "Enrollments fetched successfully",
      data: enrollments
    });
  } catch (error) {
    next(error);
  }
};

const getReviews = async (req, res, next) => {
  try {
    const reviews = await adminService.getReviews();

    res.json({
      success: true,
      message: "Reviews fetched successfully",
      data: reviews
    });
  } catch (error) {
    next(error);
  }
};

const deleteReview = async (req, res, next) => {
  try {
    const { id } = req.params;

    await adminService.deleteReview(id);

    res.json({
      success: true,
      message: "Review deleted successfully"
    });
  } catch (error) {
    next(error);
  }
};

const getCertificates = async (req, res, next) => {
  try {
    const certificates = await adminService.getCertificates();

    res.json({
      success: true,
      message: "Certificates fetched successfully",
      data: certificates
    });
  } catch (error) {
    next(error);
  }
};

/* Reports */
const getReports = async (req, res, next) => {
  try {
    const reports = await adminService.getReports();

    res.json({
      success: true,
      message: "Reports fetched successfully",
      data: reports
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getDashboardStats,
  getUsers,
  getUserById,
  updateUser,
  updateUserStatus,
  deleteUser,
  createAdmin,
  getAdmins,
  getCourses,
  publishCourse,
  archiveCourse,
  deleteCourse,
  getTeachers,
  getTeacherById,
  getEnrollments,
  getReviews,
  deleteReview,
  getCertificates,
  getReports
};