import express from "express";
import authRoutes from "./routes/auth.routes";
import adminRoutes from "./routes/admin.routes";
import courseRoutes from "./routes/course.routes";
import lessonRoutes from "./routes/lesson.routes";
import enrollmentRoutes from "./routes/enrollment.routes";
import quizRoutes from "./routes/quiz.routes";
import questionRoutes from "./routes/question.routes";
import assignmentRoutes from "./routes/assignment.routes";
import submissionRoutes from "./routes/submission.routes";
import certificateRoutes from "./routes/certificate.routes";
import analyticsRoutes from "./routes/analytics.routes";
import aiRoutes from "./routes/ai.routes";
import uploadRoutes from "./routes/upload.routes";
import notificationRoutes from "./routes/notification.routes";
import { errorHandler } from "./middlewares/error.middleware";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import swaggerUi   from "swagger-ui-express";
import YAML from "yamljs";
import paymentRoutes
from "./routes/payment.routes";



const app = express();
app.use(cors());

app.use(helmet());

app.use(
  rateLimit({
    windowMs:
      15 * 60 * 1000,

    max: 100,
  })
);

app.use(express.json());

app.use(express.json());

app.get("/", (req, res) => {
  res.send("Orange Tree LMS API");
});

app.use("/api/auth", authRoutes);

export default app;


app.use("/api/admin", adminRoutes);

app.use("/api/courses", courseRoutes);

app.use("/api/lessons", lessonRoutes);

app.use(
  "/api/enrollments",
  enrollmentRoutes
);

app.use(
  "/api/quizzes",
  quizRoutes
);

app.use("/api/questions", questionRoutes);
app.use("/api/assignments", assignmentRoutes);
app.use("/api/submissions", submissionRoutes);
app.use(
  "/api/certificates",
  certificateRoutes
);

app.use(
  "/api/analytics",
  analyticsRoutes
);
app.use("/api/ai", aiRoutes);

app.use("/api/uploads", uploadRoutes);

app.use(
  "/api/notifications",
  notificationRoutes
);
app.use(errorHandler);


const swaggerDocument =
  YAML.load(
    "./docs/swagger.yaml"
  );

app.use(
  "/api-docs",
  swaggerUi.serve,
  swaggerUi.setup(
    swaggerDocument
  )
);


app.use(
  "/api/payments",
  paymentRoutes
);