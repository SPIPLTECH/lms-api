import { Router } from "express";
import {  submit,} from "../controllers/quiz-attempt.controller";
import {  create,  getOne,} from "../controllers/quiz.controller";
import {  authenticate,} from "../middlewares/auth.middleware";
import {  authorize,} from "../middlewares/role.middleware";



const router = Router();
router.post(
  "/",
  authenticate,
  authorize("ADMIN", "TEACHER"),
  create
);

router.post(
  "/submit",
  authenticate,
  authorize("STUDENT", "ADMIN"),
  submit
);

router.get("/:id", getOne);

export default router;