# CLAUDE.md — Backend Guidelines (lms-api)

## Project Overview

Orange Tree LMS Backend is a Node.js / Express.js REST API using PostgreSQL and Prisma ORM. It provides authentication, course management, content hierarchy, Razorpay payment processing, and role-based access control (RBAC).

## Stack & Architecture

```text
src/
├── app.js                      # Express app setup and route registrations
├── config/                     # Database connection (`database.js` Prisma client), environment
├── middleware/                 # Shared middleware
│   ├── auth.middleware.js      # `verifyToken`, `optionalToken`
│   ├── role.middleware.js      # `checkRole(["ADMIN", ...])`
│   ├── courseOwnership.middleware.js
│   ├── topicOwnership.middleware.js, lessonOwnership.middleware.js
│   ├── joiValidation.middleware.js
│   └── error.middleware.js
├── modules/                    # Feature modules (route -> controller -> service -> prisma)
│   ├── courses/                # course.routes.js, course.controller.js, course.service.js
│   ├── store/                  # store.routes.js, store.controller.js, store.service.js
│   ├── topics/                 # topic.routes.js, topic.controller.js, topic.service.js
│   ├── payments/               # payment.routes.js, payment.controller.js, payment.service.js, razorpay.service.js
│   ├── enrollments/            # enrollment.routes.js, enrollment.service.js
│   └── modules/, lessons/, contents/, quizzes/, auth/, users/, etc.
prisma/
└── schema.prisma               # Database schema definition
test/                           # Node.js native test suite (`node --test`)
└── payments.test.js, ownership.middleware.test.js, etc.
```

## Canonical Course Hierarchy

```text
Course
  └── Module
      └── Lesson
          └── Topic
              └── Content
```

- `Topic` is a first-class model in `schema.prisma` between `Lesson` and `Content`.
- `Content` connects to `Topic` via `topicId`.
- Backend module `src/modules/topics` is fully mounted at `/topics` in `app.js`.

## Role Boundaries & Critical RBAC Rules

### ADMIN
Only Admin can:
- Create, update, or delete Store pricing (`/store/:courseId`)
- Publish, unpublish, or archive courses (`/courses/:courseId/status`)
- Review submitted courses

### INSTRUCTOR
Instructor can:
- Create courses and edit owned course content
- Manage modules, lessons, topics, content items, and quizzes
Instructor must receive `403 Forbidden` for:
- Store pricing mutations (`POST/PUT/DELETE /store/:courseId`)
- Course status publication mutations (`PATCH /courses/:courseId/status`)

### STUDENT
Student can:
- Browse published courses
- Purchase valid paid courses
- Access courses after successful backend payment verification and enrollment activation

## Current vs Target State Discrepancies

1. **Store Pricing RBAC**:
   - **CURRENT**: `store.routes.js` uses `checkRole(["ADMIN", "INSTRUCTOR"])`.
   - **TARGET**: Restrict `POST/PUT/DELETE /store/:courseId` to `checkRole(["ADMIN"])` only.
2. **Course Status RBAC**:
   - **CURRENT**: `course.routes.js` uses `checkRole(["ADMIN", "INSTRUCTOR"])` for `PATCH /:courseId/status`.
   - **TARGET**: Restrict status changes to `checkRole(["ADMIN"])` only.
3. **Course Publication Guard & Bug**:
   - **CURRENT**: `course.service.js` `updateStatus()` contains undeclared variables (`finalStatus`, `isPublished`) causing a ReferenceError when triggered, and lacks Store pricing validation.
   - **TARGET**: Fix undeclared variable references (`status` instead of `finalStatus`, set `publishedAt`) and reject `PUBLISHED` status if Store is missing, `price <= 0`, or `isFree === true`.

## Payment & Razorpay Rules

- Payment endpoints: `POST /payments/orders`, `POST /payments/verify`, `POST /payments/webhook`.
- Store price is server-authoritative (`store.discountPrice > 0 ? discountPrice : price`). Never trust frontend amounts.
- Enrollment is activated ONLY after successful payment verification (`verifyPayment` or signature-verified webhook).
- `verifyPayment` MUST remain idempotent (repeated verification returns existing `CAPTURED` order & `ACTIVE` enrollment without duplicates).

## Testing & Verification Commands

```bash
# Run Node.js native test runner
npm test

# Run payment test suite specifically
node --test test/payments.test.js

# Database operations
npm run prisma:generate
```
