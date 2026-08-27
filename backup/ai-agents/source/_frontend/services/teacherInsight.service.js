import api from "@/lib/axios";

/** Every owned course's teacher-insight dashboard (recommendations, health, alerts), keyed by course. */
export const getTeacherInsights = async (teacherId) => {
  const { data } = await api.get(`/teacher-insights/${teacherId}`);
  return data.data;
};
