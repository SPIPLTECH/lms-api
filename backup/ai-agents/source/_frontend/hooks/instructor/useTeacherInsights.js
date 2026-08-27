import { useQuery } from "@tanstack/react-query";

import useAuth from "@/hooks/useAuth";
import { getTeacherInsights } from "@/services/teacherInsight.service";
import { QUERY_KEYS } from "@/constants/queryKeys";
import { defaultQueryOptions } from "@/lib/queryOptions";

/** Flattens every owned course's teachingRecommendations into one list, tagged with course info. */
function flattenRecommendations(data, recommendationType) {
  if (!data?.courses) return [];

  return data.courses
    .flatMap((course) =>
      (course.teachingRecommendations || [])
        .filter((rec) => rec.recommendationType === recommendationType)
        .map((rec) => ({ ...rec, courseId: course.courseId, courseTitle: course.courseTitle }))
    )
    .sort((a, b) => {
      const priorityRank = { HIGH: 0, MEDIUM: 1, LOW: 2 };
      return (priorityRank[a.priority] ?? 3) - (priorityRank[b.priority] ?? 3);
    });
}

export function useTeacherInsights() {
  const { user } = useAuth();

  return useQuery({
    queryKey: [QUERY_KEYS.TEACHER_INSIGHTS, user?.id],
    queryFn: () => getTeacherInsights(user.id),
    enabled: !!user?.id,
    ...defaultQueryOptions,
  });
}

/** Direct, concrete calls-to-action ("Recommendations" page). */
export function useInstructorActionRecommendations() {
  const query = useTeacherInsights();
  return { ...query, recommendations: flattenRecommendations(query.data, "INSTRUCTOR_ACTION") };
}

/** Softer, exploratory content-improvement ideas ("Suggestions" page). */
export function useTeachingSuggestions() {
  const query = useTeacherInsights();
  return { ...query, recommendations: flattenRecommendations(query.data, "TEACHING_SUGGESTION") };
}
