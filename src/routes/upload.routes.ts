import { Router } from "express";
import { upload } from "../middlewares/upload.middleware";
import { uploadFile } from "../controllers/upload.controller";
import { authenticate } from "../middlewares/auth.middleware";

const router = Router();

router.post(
  "/",
  authenticate,
  upload.single("file"),
  uploadFile
);

export default router;