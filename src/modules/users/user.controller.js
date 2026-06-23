const userService = require("./user.service");

const getUsers = async (
  req,
  res,
  next
) => {
  try {
    const users =
      await userService.getUsers();

    res.json({
      success: true,
      data: users
    });
  } catch (error) {
    next(error);
  }
};

const getUserById = async (
  req,
  res,
  next
) => {
  try {
    const user =
      await userService.getUserById(
        req.params.userId
      );

    res.json({
      success: true,
      data: user
    });
  } catch (error) {
    next(error);
  }
};
const updateUserRole = async (
  req,
  res,
  next
) => {
  try {
    const user =
      await userService.updateUserRole(
        req.params.userId,
        req.body.role
      );

    res.json({
      success: true,
      message:
        "User role updated successfully",
      data: user
    });
  } catch (error) {
    next(error);
  }
};

const updateUser = async (
  req,
  res,
  next
) => {
  try {
    const user =
      await userService.updateUser(
        req.params.userId,
        req.body
      );

    res.json({
      success: true,
      message:
        "User updated successfully",
      data: user
    });
  } catch (error) {
    next(error);
  }
};
const updateUserStatus = async (
  req,
  res,
  next
) => {
  try {
    const user =
      await userService.updateUserStatus(
        req.params.userId,
        req.body.status
      );

    res.json({
      success: true,
      message:
        "User status updated successfully",
      data: user
    });
  } catch (error) {
    next(error);
  }
};

const deleteUser = async (
  req,
  res,
  next
) => {
  try {
    await userService.deleteUser(
      req.params.userId
    );

    res.json({
      success: true,
      message:
        "User deleted successfully"
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getUsers,
  getUserById,
  updateUser,
  deleteUser,
  updateUserRole,
  updateUserStatus
};