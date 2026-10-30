const userService = require("./user.service");
const { uploadFile } = require("../../utils/r2Storage");

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

const deleteUser = async (
  req,
  res,
  next
) => {
  try {
    const targetUserId =
      req.params.userId;

    // Prevent self-delete
    if (
      req.user.id === targetUserId
    ) {
      return res.status(403).json({
        success: false,
        message:
          "You cannot delete your own account"
      });
    }

    await userService.deleteUser(
      targetUserId
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
const getMyProfile = async (req, res, next) => {
  try {
    const user = await userService.getUserById(req.user.id);

    res.json({
      success: true,
      data: user
    });
  } catch (error) {
    next(error);
  }
};

const updateMyProfile = async (req, res, next) => {
  try {
    const user = await userService.updateMyProfile(req.user.id, req.body);

    res.json({
      success: true,
      message: "Profile updated successfully",
      data: user,
    });
  } catch (error) {
    next(error);
  }
};

const uploadAvatar = async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: "No avatar image uploaded",
      });
    }

    const { url: avatarUrl } = await uploadFile(req.file, "avatars");
    const user = await userService.updateMyProfile(req.user.id, { avatar: avatarUrl });

    res.json({
      success: true,
      message: "Profile photo uploaded successfully",
      data: {
        avatarUrl,
        user,
      },
    });
  } catch (error) {
    next(error);
  }
};

const deleteAvatar = async (req, res, next) => {
  try {
    const user = await userService.updateMyProfile(req.user.id, { avatar: null });

    res.json({
      success: true,
      message: "Profile photo removed successfully",
      data: user,
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getUserById,
  updateUser,
  deleteUser,
  updateUserRole,
  getMyProfile,
  updateMyProfile,
  uploadAvatar,
  deleteAvatar,
};