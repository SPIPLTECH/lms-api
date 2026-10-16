/**
 * Course / Module / Lesson / Topic / SubTopic / Concept breadcrumbs for
 * gradable items.
 *
 * Assignment, Content and Quiz all attach at any ONE of six levels — a row
 * carries exactly one of courseId / moduleId / lessonId / topicId /
 * subTopicId / conceptId. To label a concept-level item with its full path we
 * have to walk UP the hierarchy, so each relation selects its own ancestors.
 *
 * This generalises the coalescing chain that quiz.service.js already used for
 * the student's quiz history, so an item's breadcrumb reads the same wherever
 * it is shown.
 */

/**
 * Course fields every breadcrumb consumer needs, including the enrolled-student
 * count that is the denominator of the instructor's submission gauges.
 */
const COURSE_NODE = {
    select: {
        id: true,
        title: true,
        status: true,
        _count: { select: { enrollments: true } },
    },
};

/**
 * Prisma `include` fragment resolving all four breadcrumb levels from whichever
 * one the item is actually attached to. Spread into an existing `include`.
 */
const BREADCRUMB_INCLUDE = {
    course: COURSE_NODE,
    module: { select: { title: true, course: COURSE_NODE } },
    lesson: {
        select: {
            title: true,
            module: { select: { title: true, course: COURSE_NODE } },
        },
    },
    topic: {
        select: {
            title: true,
            lesson: {
                select: {
                    title: true,
                    module: { select: { title: true, course: COURSE_NODE } },
                },
            },
        },
    },
    subTopic: {
        select: {
            title: true,
            topic: {
                select: {
                    title: true,
                    lesson: {
                        select: {
                            title: true,
                            module: { select: { title: true, course: COURSE_NODE } },
                        },
                    },
                },
            },
        },
    },
    concept: {
        select: {
            title: true,
            subTopic: {
                select: {
                    title: true,
                    topic: {
                        select: {
                            title: true,
                            lesson: {
                                select: {
                                    title: true,
                                    module: { select: { title: true, course: COURSE_NODE } },
                                },
                            },
                        },
                    },
                },
            },
        },
    },
};

/**
 * The six parent foreign keys a Content / Quiz / Assignment row can hang off,
 * ordered shallowest -> deepest. Single source of truth for "what counts as a
 * hierarchy parent", so adding a level never means hunting down copies of this
 * list. Order matters to callers that pick the FIRST present field.
 */
const PARENT_FIELDS = [
    "courseId",
    "moduleId",
    "lessonId",
    "topicId",
    "subTopicId",
    "conceptId",
];

/**
 * Prisma `include`/`select` fragment that resolves the owning courseId from
 * whichever of the six levels an item is attached to. Deliberately narrow —
 * it selects only the ids needed to answer "which course is this in?", so it
 * is cheap enough to spread into hot paths (progress mutations, access checks).
 */
const COURSE_ID_INCLUDE = {
    module: { select: { courseId: true } },
    lesson: { select: { module: { select: { courseId: true } } } },
    topic: {
        select: { lesson: { select: { module: { select: { courseId: true } } } } },
    },
    subTopic: {
        select: {
            topic: {
                select: { lesson: { select: { module: { select: { courseId: true } } } } },
            },
        },
    },
    concept: {
        select: {
            subTopic: {
                select: {
                    topic: {
                        select: { lesson: { select: { module: { select: { courseId: true } } } } },
                    },
                },
            },
        },
    },
};

/**
 * Resolves the owning courseId for a Content / Quiz / Assignment row fetched
 * with COURSE_ID_INCLUDE (or with any fuller include that still nests
 * module -> courseId, e.g. `topic: { include: { lesson: { include: { module: true } } } }`).
 *
 * This replaces the coalescing chain that used to be copy-pasted at seven call
 * sites. Every one of those chains stopped at `topic`, so a SubTopic- or
 * Concept-attached row would have resolved to `undefined` — and because each
 * caller guards with `if (courseId)`, the access check would have been SKIPPED
 * rather than failed. Centralising it is what makes adding two levels safe.
 *
 * Deepest-first: Quiz.courseId is a required column, so a topic-level quiz has
 * BOTH `courseId` and a resolvable parent chain. Reading the chain first keeps
 * the answer consistent with how Content resolves.
 */
const resolveCourseId = (row) =>
    row?.concept?.subTopic?.topic?.lesson?.module?.courseId ??
    row?.subTopic?.topic?.lesson?.module?.courseId ??
    row?.topic?.lesson?.module?.courseId ??
    row?.lesson?.module?.courseId ??
    row?.module?.courseId ??
    row?.courseId ??
    null;

/**
 * Flattens a row fetched with BREADCRUMB_INCLUDE into the labels and counts the
 * instructor views render. Segments above the attachment point resolve; those
 * below stay null so the UI can omit them rather than print empty crumbs.
 *
 * `enrolledCount` is the course's enrollment total — the denominator for "how
 * many students have submitted", which is meaningful because both
 * AssignmentSubmission and ContentSubmission are unique per student per item.
 */
const resolveBreadcrumb = (row) => {
    // Shorthands for the two deep paths, so each label below stays readable.
    const subTopicOfConcept = row.concept?.subTopic || null;
    const topicOfSubTopic = row.subTopic?.topic || subTopicOfConcept?.topic || null;

    const course =
        row.course ||
        row.module?.course ||
        row.lesson?.module?.course ||
        row.topic?.lesson?.module?.course ||
        topicOfSubTopic?.lesson?.module?.course ||
        null;

    return {
        course: course ? { id: course.id, title: course.title, status: course.status } : null,
        moduleTitle:
            row.module?.title ||
            row.lesson?.module?.title ||
            row.topic?.lesson?.module?.title ||
            topicOfSubTopic?.lesson?.module?.title ||
            null,
        lessonTitle:
            row.lesson?.title ||
            row.topic?.lesson?.title ||
            topicOfSubTopic?.lesson?.title ||
            null,
        topicTitle: row.topic?.title || topicOfSubTopic?.title || null,
        // New segments. They stay null for the existing four levels, so
        // consumers that never read them are unaffected.
        subTopicTitle: row.subTopic?.title || subTopicOfConcept?.title || null,
        conceptTitle: row.concept?.title || null,
        enrolledCount: course?._count?.enrollments ?? 0,
    };
};

module.exports = {
    BREADCRUMB_INCLUDE,
    COURSE_NODE,
    PARENT_FIELDS,
    COURSE_ID_INCLUDE,
    resolveCourseId,
    resolveBreadcrumb,
};
