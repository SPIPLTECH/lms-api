# Assignment auto-evaluation

Proposes marks for a student's written or PDF assignment answer against the instructor's marking scheme, using a deterministic rule-based evaluator (no external AI service). **Nothing is shown to a student until an instructor approves the proposal or sets the marks.**

## Workflow

```
submitted ─> evaluating ─> ready / needs-review ─> published
   (job queued)   │                │                 (instructor approves or sets marks)
                  └─> failed       └─> outdated (scheme changed: re-evaluate)
```

1. The instructor sets up **Auto-evaluation** on the assignment (or while creating it): ideal answer, total marks, criteria (keywords, key phrases, contradicting statements), synonyms, misconceptions. The scheme's total **is** the assignment's marks: saving sets `Assignment.marks`, and editing the marks elsewhere is refused (409 `MARKS_FROM_RUBRIC`) while a scheme exists. Every save is a new scheme `version`, and ungraded submissions are queued again.
2. A student submits as before (typed answer and/or PDF). `assignment.service.submitAssignment` calls `onSubmitted`, which records a job in `AssignmentEvaluationJob` before the response goes out. A resubmission unpublishes earlier results (the existing code clears the grade).
3. The worker (`evaluationQueue.js`, started by `server.js`) runs the job. The result is stored as a new `AssignmentEvaluation` version with `source: "AUTO"`, `isPublished: false`, plus the scheme version and the submission's `submittedAt`. If either changed while it ran, the result is discarded (a newer job is already queued).
4. The instructor reviews it (Grading & Results → assignment → student): evidence per criterion, review reasons, history, activity log. They either:
   * **approve** it (`…/accept`, with the `expectedVersion` they were looking at), or
   * **set different marks** (`…/override`): per criterion or as a total, with a required reason.

   Both create an `INSTRUCTOR` version that is published: `AssignmentSubmission.grade` (`"3.5/4"`), `feedback`, status `Graded`.
5. The student sees the grade, the feedback and, for evaluated grades, the marks per point (`studentView`: published version only, no evidence or internal notes).

A graded submission is never re-marked automatically. **Reopening** it (`…/re-evaluate` with `{ reopen: true }`) creates a new proposal; the student keeps the published grade until a new decision. Hand grading (`PATCH /assignments/:id/submissions/:sid/grade`) still works and replaces the evaluation (it is unpublished and the action is logged).

Without a marking scheme (or with it switched off), an assignment works exactly as before.

## Guarantees and how they are enforced

| Rule | Where |
|---|---|
| Automated results are never published | No code path publishes an AUTO version; CHECK `AssignmentEvaluation_published_check` |
| One current and one published version per submission | Partial unique indexes `…_one_current_key`, `…_one_published_key` |
| Decisions are made on what the instructor saw | `expectedVersion` + `SELECT … FOR UPDATE` on the submission → 409 `VERSION_CONFLICT` |
| No decision while an evaluation runs | 409 `EVALUATION_RUNNING` |
| Stale results never become current | Scheme version and `submittedAt` re-checked under the row lock |
| Duplicate requests do not duplicate work | One job row per submission (`INSERT … ON CONFLICT`); a request mid-run sets `rerun` |
| Jobs survive restarts; failures retry | `FOR UPDATE SKIP LOCKED` claim, stale-lock takeover after 10 min, 3 attempts with back-off, then a `failed` result |
| Approved marks are not overwritten | Automatic jobs skip graded submissions; reopening is explicit |
| Audit trail | `AssignmentEvaluationAudit` (who, what, when) + every version kept |

## What gets evaluated

`submissionText.service.js` combines the typed answer with the text of the PDF:

* PDFs are read only from the student-submission folder of our **R2** bucket (`https://<R2_ACCOUNT_ID>.r2.cloudflarestorage.com/<R2_PRIVATE_BUCKET>/assignment-submissions/…`, read through a short-lived signed URL) or this API's `uploads/attachments` folder. Nothing else is fetched. Limit 20 MB, 30 pages.
* Typed PDFs: text layer (`pdf-parse`). Scanned pages: local OCR (`tesseract.js`; the English model downloads to `.cache/tesseract` on first use).
* OCR'd pages, PDFs without readable text, PDFs with images, and unreadable or untrusted files are flagged for review, with confidence capped at 50%.
* R2 needs the `R2_*` settings in the API's environment.

Each result records what is needed to reproduce it: the scheme snapshot and version (`inputMeta.rubric`), the synonym-dictionary fingerprint, the engine version and the evaluated text.

## Endpoints

Instructor/admin, owner of the assignment (`verifyAssignmentOwnership`):

| Method | Path | |
|---|---|---|
| GET / PUT / DELETE | `/assignments/:assignmentId/rubric` | Marking scheme (PUT also sets the assignment's marks) |
| POST | `/assignments/:assignmentId/rubric/preview` | Score a sample answer (nothing saved) |
| POST | `/assignments/:assignmentId/evaluate-all` | Queue every ungraded submission → `{ queued, skippedGraded }` |
| GET | `/assignments/:assignmentId/submissions/:submissionId/evaluation` | `{ status, current, published, job, history, audit }` |
| POST | `…/evaluation/accept` | `{ expectedVersion, comment? }` |
| POST | `…/evaluation/override` | `{ expectedVersion, reason, comment?, criteria[] \| marksAwarded }` |
| POST | `…/evaluation/re-evaluate` | `{ reopen? }` (required for a graded submission) |

Shared synonym dictionary (instructor/admin; a group is deleted only by its author or an admin): `GET/POST /assignment-evaluation/synonyms`, `POST …/synonyms/starter`, `DELETE …/synonyms/:groupId`.

`GET /assignments/:id/submissions` carries each row's evaluation status; `GET /assignments/:id` (student) carries the published breakdown only.

## Database

Created by `scripts/add-assignment-evaluation.sql` and `scripts/assignment-evaluation-2-review-workflow.sql` (`npx prisma db execute --file …`), never `db push`: the partial indexes and CHECK constraints are not in `schema.prisma`. A branch whose `schema.prisma` lacks these models must not run `prisma db push` against the shared database: it would drop them.

## Configuration

`EVALUATION_WORKER=off` (do not run jobs in this process), `EVALUATION_POLL_MS` (30000), `EVALUATION_MAX_ATTEMPTS` (3), `EVALUATION_STALE_LOCK_MINUTES` (10), `EVALUATION_OCR_ENABLED`, `EVALUATION_OCR_MAX_PAGES`, `EVALUATION_PDF_MAX_PAGES`, `EMBEDDING_PROVIDER` (`none` | `http`; any other value stops the API at start-up).

## Engine

`engine/` is the rule-based evaluator (normalisation, synonyms, keyword and phrase matching, TF-IDF similarity, rubric scoring, feedback). It has no database or HTTP dependencies and is a copy of the standalone test bed's (`Assignment Evaluator/backend/src/modules/assignment-evaluator`); keep the two in step. How marks are decided and the limitations: `Assignment Evaluator/docs/EVALUATION_ENGINE.md`. It matches wording; it does not understand answers.

## Tests

* No database: `node --test src/modules/assignment-evaluation/tests/*.test.js` (the workflow suite is skipped).
* Workflow against PostgreSQL: create a disposable schema from the project schema plus both SQL scripts, then run with `EVALUATION_DB_TESTS=1 TEST_DATABASE_URL=<url>?schema=<name>_test`. The suite refuses any schema whose name does not end in `_test`, and deletes what it creates.
