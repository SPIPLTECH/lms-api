import api from "@/lib/axios";

/**
 * Generate (or fetch, if already generated) this student's AI entry
 * assessment for a course.
 */
export const generateEntryAssessment = async (courseId) => {
    const { data } = await api.post(`/assessment/entry/${courseId}/generate`);
    return data.data;
};

/**
 * Get the current entry assessment (questions, no answer key, unless
 * already evaluated).
 */
export const getEntryAssessment = async (courseId) => {
    const { data } = await api.get(`/assessment/entry/${courseId}`);
    return data.data;
};

/**
 * Submit answers: { [questionId]: selectedOptionIndex }
 */
export const submitEntryAssessment = async (courseId, answers) => {
    const { data } = await api.post(`/assessment/entry/${courseId}/submit`, { answers });
    return data.data;
};

/**
 * Full result, including the answer key + explanations — only available
 * once evaluated.
 */
export const getEntryAssessmentResult = async (courseId) => {
    const { data } = await api.get(`/assessment/entry/${courseId}/result`);
    return data.data;
};

/**
 * Per-course AI personalization baseline (knowledge level, concept
 * mastery/mode/time, time saved) — backs the dashboard widget.
 *
 * 404 means the student hasn't completed (or skipped) the entry assessment
 * for this course, which is a normal, expected state rather than an error —
 * resolve to null instead of throwing so React Query caches it as ordinary
 * data (respecting staleTime/gcTime) instead of an error it re-attempts on
 * every remount.
 */
export const getCourseState = async (courseId) => {
    try {
        const { data } = await api.get(`/student-state/course/${courseId}`);
        return data.data;
    } catch (error) {
        if (error?.response?.status === 404) return null;
        throw error;
    }
};
