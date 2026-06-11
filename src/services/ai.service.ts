import { openai } from "../config/openai";
import { prisma } from "../config/database";


export const chatWithAI = async (
  message: string
) => {

  const response =
    await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "user",
          content: message,
        },
      ],
    });

  return response.choices[0].message.content;
};

export const explainLesson = async (
  lessonId: string
) => {

  const lesson =
    await prisma.lesson.findUnique({
      where: {
        id: lessonId,
      },
    });

  if (!lesson) {
    throw new Error("Lesson not found");
  }

  const response =
    await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content:
            "You are an LMS tutor. Explain lessons simply.",
        },
        {
          role: "user",
          content: `
            Lesson Title:
            ${lesson.title}

            Content:
            ${lesson.description}
          `,
        },
      ],
    });

  return response.choices[0].message.content;
};
export const generateQuizAI =
  async (lessonId: string) => {

    const lesson =
      await prisma.lesson.findUnique({
        where: {
          id: lessonId,
        },
      });

    if (!lesson) {
      throw new Error(
        "Lesson not found"
      );
    }

    const response =
      await openai.chat.completions.create({
        model: "gpt-4o-mini",

        messages: [
          {
            role: "system",
            content:
              "Generate 5 multiple choice questions in JSON format.",
          },

          {
            role: "user",
            content: `
            Lesson:
            ${lesson.title}

            Content:
            ${lesson.description}
          `,
          },
        ],
      });

    return response.choices[0]
      .message.content;
  };
  export const courseChat =
  async (
    courseId: string,
    question: string
  ) => {

    const lessons =
      await prisma.lesson.findMany({
        where: {
          courseId,
        },
      });

    const context =
      lessons
        .map(
          (lesson) =>
            `${lesson.title}
            ${lesson.description}`
        )
        .join("\n");

    const response =
      await openai.chat.completions.create({
        model: "gpt-4o-mini",

        messages: [
          {
            role: "system",
            content:
              "Answer only using course content.",
          },

          {
            role: "user",
            content: `
              Course Content:

              ${context}

              Question:

              ${question}
            `,
          },
        ],
      });

    return response.choices[0]
      .message.content;
  };