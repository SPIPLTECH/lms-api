/**
 * @typedef {"PLATFORM"|"DEPARTMENT"|"FACULTY"|"COURSE"|"STUDENT"} ScopeType
 *
 * @typedef {Object} InstitutionContext
 * @property {Date} now
 * @property {{kpis: object[], trends: object[]}} platformSnapshot
 * @property {{id: string, title: string, category: string|null, description: string|null, status: string, creatorId: string, createdAt: Date}[]} courses
 * @property {{id: string, name: string, status: string}[]} instructors
 * @property {Record<string, object>} teacherDashboards - instructorId -> getTeacherDashboard() result
 * @property {Record<string, object>} courseHealthByCourseId - courseId -> CourseHealth entry
 * @property {Record<string, object[]>} courseKpisByCourse - courseId -> Analytics COURSE-scope KPI entries
 * @property {Record<string, object[]>} instructorKpisByInstructor - instructorId -> Analytics INSTRUCTOR-scope KPI entries
 * @property {{studentId: string, dropoutRiskScore: number, dropoutRiskLevel: string, inactivityDays: number}[]} highRiskStudents
 * @property {{studentId: string, courseId: string, enrolledAt: Date}[]} enrollments
 * @property {{studentId: string, courseId: string, issuedAt: Date}[]} certificates
 * @property {number} totalStudentCount
 *
 * @typedef {Object} ForecastResult
 * @property {number} predictedValue
 * @property {number} confidenceScore
 * @property {"LINEAR_REGRESSION"|"RATIO_PROJECTION"|"TREND_EXTRAPOLATION"} method
 * @property {number} basedOnDataPoints
 * @property {Date} forecastDate
 */

module.exports = {};
