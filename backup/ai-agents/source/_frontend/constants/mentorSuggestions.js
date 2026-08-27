export const MENTOR_ROLE_SUGGESTIONS = {
  STUDENT: [
    { label: "Explain my progress", prompt: "Can I see my overall dashboard progress?" },
    { label: "What should I study next?", prompt: "What are my knowledge gaps and weak areas?" },
    { label: "Help me understand my quiz result", prompt: "Can you help me analyze my quiz results?" },
    { label: "What concepts should I review?", prompt: "Which concepts do I need to review?" },
  ],
  INSTRUCTOR: [
    { label: "How are my courses performing?", prompt: "Give me an overview of my course performance" },
    { label: "Which areas need attention?", prompt: "Which students or courses need attention?" },
    { label: "Show me quiz performance", prompt: "Show me results analytics for my quizzes" },
  ],
  ADMIN: [
    { label: "Give me a platform overview", prompt: "Give me a platform overview" },
    { label: "How many active users are there?", prompt: "Show me a breakdown of platform users" },
    { label: "Show me course statistics", prompt: "Show me platform course statistics" },
  ],
};
