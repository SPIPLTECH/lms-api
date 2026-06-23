<<<<<<< HEAD
# LMS Backend API Testing Guide

## Base URL

```http
http://localhost:5000
```

---

# Authentication APIs

## Register User

### Endpoint

```http
POST /api/auth/register
```

### Body

```json
{
  "name": "Ayan Khan",
  "email": "ayan@test.com",
  "password": "123456"
}
```

---

## Login User

### Endpoint

```http
POST /api/auth/login
```

### Body

```json
{
  "email": "ayan@test.com",
  "password": "123456"
}
```

### Response

```json
{
  "success": true,
  "token": "JWT_TOKEN"
}
```

---

## Get Current User

### Endpoint

```http
GET /api/auth/me
```

### Headers

```http
Authorization: Bearer JWT_TOKEN
```

---

# Course APIs

## Create Course

### Endpoint

```http
POST /api/courses
```

### Headers

```http
Authorization: Bearer JWT_TOKEN
```

### Body

```json
{
  "title": "React Masterclass",
  "description": "Complete React Course",
  "price": 999
}
```

---

## Get Courses

### Endpoint

```http
GET /api/courses
```

---

# Lesson APIs

## Create Lesson

### Endpoint

```http
POST /api/lessons
```

### Headers

```http
Authorization: Bearer JWT_TOKEN
```

### Body

```json
{
  "title": "Introduction to React",
  "description": "Getting Started",
  "videoUrl": "https://youtube.com/demo",
  "pdfUrl": "https://example.com/react.pdf",
  "order": 1,
  "courseId": "COURSE_ID"
}
```

---

## Get Lessons By Course

### Endpoint

```http
GET /api/lessons/course/COURSE_ID
```

---

# Enrollment APIs

## Enroll Student

### Endpoint

```http
POST /api/enrollments
```

### Headers

```http
Authorization: Bearer JWT_TOKEN
```

### Body

```json
{
  "courseId": "COURSE_ID"
}
```

---

## My Courses

### Endpoint

```http
GET /api/enrollments/my-courses
```

### Headers

```http
Authorization: Bearer JWT_TOKEN
```

---

# Quiz APIs

## Create Quiz

### Endpoint

```http
POST /api/quizzes
```

### Headers

```http
Authorization: Bearer JWT_TOKEN
```

### Body

```json
{
  "title": "React Basics Quiz",
  "courseId": "COURSE_ID"
}
```

---

## Get Quiz

### Endpoint

```http
GET /api/quizzes/QUIZ_ID
```

---

# Question APIs

## Add Question

### Endpoint

```http
POST /api/questions
```

### Headers

```http
Authorization: Bearer JWT_TOKEN
```

### Body

```json
{
  "question": "What is React?",
  "optionA": "Library",
  "optionB": "Database",
  "optionC": "Server",
  "optionD": "Operating System",
  "correctAnswer": "Library",
  "quizId": "QUIZ_ID"
}
```

---

# Quiz Submission APIs

## Submit Quiz

### Endpoint

```http
POST /api/quizzes/submit
```

### Headers

```http
Authorization: Bearer JWT_TOKEN
```

### Body

```json
{
  "quizId": "QUIZ_ID",
  "answers": [
    {
      "questionId": "QUESTION_ID",
      "answer": "Library"
    }
  ]
}
```

---

# Assignment APIs

## Create Assignment

### Endpoint

```http
POST /api/assignments
```

### Headers

```http
Authorization: Bearer JWT_TOKEN
```

### Body

```json
{
  "title": "React Project",
  "description": "Build a Todo App",
  "courseId": "COURSE_ID"
}
```

---

## Get Assignments

### Endpoint

```http
GET /api/assignments/course/COURSE_ID
```

---

# Submission APIs

## Submit Assignment

### Endpoint

```http
POST /api/submissions
```

### Headers

```http
Authorization: Bearer JWT_TOKEN
```

### Body

```json
{
  "assignmentId": "ASSIGNMENT_ID",
  "content": "GitHub Repository Link"
}
```

---

## My Submissions

### Endpoint

```http
GET /api/submissions/my
```

### Headers

```http
Authorization: Bearer JWT_TOKEN
```

---

# Certificate APIs

## Generate Certificate

### Endpoint

```http
POST /api/certificates/generate
```

### Headers

```http
Authorization: Bearer JWT_TOKEN
```

### Body

```json
{
  "courseId": "COURSE_ID"
}
```

---

## My Certificates

### Endpoint

```http
GET /api/certificates/my
```

### Headers

```http
Authorization: Bearer JWT_TOKEN
```

---

# Analytics APIs

## Student Dashboard

```http
GET /api/analytics/student
```

## Teacher Dashboard

```http
GET /api/analytics/teacher
```

## Admin Dashboard

```http
GET /api/analytics/admin
```

### Headers

```http
Authorization: Bearer JWT_TOKEN
```

---

# AI Tutor APIs

## Chat

```http
POST /api/ai/chat
```

### Body

```json
{
  "message": "Explain React Hooks"
}
```

---

## Explain Lesson

```http
POST /api/ai/explain
```

### Body

```json
{
  "lessonId": "LESSON_ID"
}
```

---

## Generate Quiz

```http
POST /api/ai/generate-quiz
```

### Body

```json
{
  "lessonId": "LESSON_ID"
}
```

---

## Course Chat

```http
POST /api/ai/course-chat
```

### Body

```json
{
  "courseId": "COURSE_ID",
  "question": "Summarize this course"
}
```

---

# Upload APIs

## Upload File

```http
POST /api/uploads
```

### Headers

```http
Authorization: Bearer JWT_TOKEN
```

### Body

```text
form-data

file -> select file
```

---

# Notification APIs

## My Notifications

```http
GET /api/notifications/my
```

### Headers

```http
Authorization: Bearer JWT_TOKEN
```

---

# Payment APIs

## Create Razorpay Order

```http
POST /api/payments/create-order
```

### Headers

```http
Authorization: Bearer JWT_TOKEN
```

### Body

```json
{
  "amount": 999
}
```

---

# Swagger

## API Documentation

```http
GET /api-docs
```

---

# Recommended Testing Order

1. Register
2. Login
3. Get Profile
4. Create Course
5. Create Lesson
6. Enroll Student
7. Create Quiz
8. Add Question
9. Submit Quiz
10. Create Assignment
11. Submit Assignment
12. Generate Certificate
13. Analytics
14. AI Tutor
15. Upload File
16. Notifications
17. Payments
18. Swagger Docs

---

END
=======
# Ayan-
>>>>>>> 1210ca0a6fe82fbf019120d8013880cdb08781e9
