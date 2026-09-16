/**
 * Course / Module / Lesson / Topic breadcrumbs for gradable items.
 *
 * Assignment, Content and Quiz all attach at any ONE of four levels — a row
 * carries exactly one of courseId / moduleId / lessonId / topicId. To label a
 * topic-level item with its full path we have to walk UP the hierarchy, so
 * each relation selects its own ancestors.
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
};

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
    const course =
        row.course ||
        row.module?.course ||
        row.lesson?.module?.course ||
        row.topic?.lesson?.module?.course ||
        null;

    return {
        course: course ? { id: course.id, title: course.title, status: course.status } : null,
        moduleTitle:
            row.module?.title ||
            row.lesson?.module?.title ||
            row.topic?.lesson?.module?.title ||
            null,
        lessonTitle: row.lesson?.title || row.topic?.lesson?.title || null,
        topicTitle: row.topic?.title || null,
        enrolledCount: course?._count?.enrollments ?? 0,
    };
};

module.exports = { BREADCRUMB_INCLUDE, COURSE_NODE, resolveBreadcrumb };
