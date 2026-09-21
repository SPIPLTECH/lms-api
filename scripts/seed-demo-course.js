const bcrypt = require("bcrypt");
const prisma = require("../src/config/database");
const { getNextOrder } = require("../src/modules/contents/contentOrder.util");

/**
 * Seeds one complete, working course plus the accounts to explore it with.
 *
 * Written for a freshly-pushed database that has schema but no content. It is
 * idempotent: every write is an upsert keyed on a stable id or a unique field,
 * so running it twice updates rather than duplicates.
 *
 * Two things here are deliberate rather than incidental:
 *
 *  - Question.topic is set to the SAME string as the Topic title it belongs
 *    to. The Phase 6/7 recommendation engine resolves a concept to content by
 *    matching those two, and refuses partial matches on purpose. Seed data
 *    that doesn't line up would leave the whole adaptive surface silently
 *    empty, which is exactly what happened on the previous database.
 *  - The quiz `order` values are the next slot in their lesson's common
 *    sequence (shared with its topics, content and assignments), matching
 *    what claimSequenceOrder would assign, so the seeded course orders the
 *    same way a hand-built one does.
 */

// Each account carries its own password: the instructor is a real account the
// team already uses, the student is a throwaway for walking the course.
const ACCOUNTS = [
  {
    id: "seed_user_instructor",
    email: "gunvantrao2017@gmail.com",
    name: "Gunvantrao",
    role: "INSTRUCTOR",
    password: "OTreeWins"
  },
  {
    id: "seed_user_student",
    email: "student@demo.com",
    name: "Demo Student",
    role: "STUDENT",
    password: "Password123!"
  }
];

/**
 * The course. Topic titles double as the concept names the questions are
 * tagged with — see the note above.
 */
const COURSE = {
  id: "seed_course_java",
  title: "Java Programming Fundamentals",
  description: "A short course covering the core ideas of Java, end to end.",
  modules: [
    {
      id: "seed_mod_1",
      title: "Java Basics",
      lessons: [
        {
          id: "seed_les_1",
          title: "Getting Started with Java",
          topics: [
            {
              id: "seed_top_1",
              title: "Variables",
              body: "<h2>Variables</h2><p>A variable names a piece of memory that holds a value. In Java every variable has a declared type, fixed at compile time.</p><pre>int count = 10;\nString name = \"Ada\";</pre>"
            },
            {
              id: "seed_top_2",
              title: "Data Types",
              body: "<h2>Data Types</h2><p>Java has eight primitive types — <code>byte, short, int, long, float, double, char, boolean</code> — and reference types for everything else.</p>"
            }
          ]
        },
        {
          id: "seed_les_2",
          title: "Control Flow",
          topics: [
            {
              id: "seed_top_3",
              title: "Conditionals",
              body: "<h2>Conditionals</h2><p><code>if</code>, <code>else if</code> and <code>switch</code> choose between branches based on a boolean expression.</p>"
            },
            {
              id: "seed_top_4",
              title: "Loops",
              body: "<h2>Loops</h2><p><code>for</code>, <code>while</code> and <code>do-while</code> repeat work. A <code>for-each</code> loop walks a collection without an index.</p>"
            }
          ]
        }
      ]
    },
    {
      id: "seed_mod_2",
      title: "Object-Oriented Java",
      lessons: [
        {
          id: "seed_les_3",
          title: "Classes and Objects",
          topics: [
            {
              id: "seed_top_5",
              title: "Inheritance",
              body: "<h2>Inheritance</h2><p>A subclass <code>extends</code> a superclass, inheriting its fields and methods. Java allows single inheritance of classes.</p>"
            },
            {
              id: "seed_top_6",
              title: "Polymorphism",
              body: "<h2>Polymorphism</h2><p>A reference of a supertype can point at any subtype instance; the method that runs is the subtype's override.</p>"
            }
          ]
        }
      ]
    }
  ]
};

/**
 * Questions, grouped by the concept (== Topic title) they assess. `hint` is
 * only ever surfaced on a qualifying test, from the student's second attempt.
 */
const QUESTIONS = {
  Variables: [
    {
      id: "seed_q_var_1",
      question: "Which keyword declares a variable whose value cannot change?",
      options: ["final", "const", "static", "immutable"],
      correctAnswer: "final",
      explanation: "Java uses `final`; `const` is reserved but unused.",
      hint: "Think about the keyword Java actually reserves for this."
    },
    {
      id: "seed_q_var_2",
      question: "What is the default value of an uninitialised int field?",
      options: ["0", "null", "undefined", "-1"],
      correctAnswer: "0",
      explanation: "Numeric primitive fields default to zero.",
      hint: "Primitives cannot hold null."
    }
  ],
  "Data Types": [
    {
      id: "seed_q_dt_1",
      question: "How many primitive types does Java have?",
      options: ["8", "6", "10", "12"],
      correctAnswer: "8",
      explanation: "byte, short, int, long, float, double, char, boolean.",
      hint: "Count the numeric ones, then char and boolean."
    },
    {
      id: "seed_q_dt_2",
      question: "Which type holds a single 16-bit Unicode character?",
      options: ["char", "String", "byte", "text"],
      correctAnswer: "char",
      explanation: "`char` is a primitive; `String` is a reference type.",
      hint: "It is a primitive, not a class."
    }
  ],
  Conditionals: [
    {
      id: "seed_q_cond_1",
      question: "Which statement chooses among many constant values?",
      options: ["switch", "if", "for", "try"],
      correctAnswer: "switch",
      explanation: "`switch` branches on a value against case labels.",
      hint: "It uses case labels."
    }
  ],
  Loops: [
    {
      id: "seed_q_loop_1",
      question: "Which loop always runs its body at least once?",
      options: ["do-while", "while", "for", "for-each"],
      correctAnswer: "do-while",
      explanation: "`do-while` tests its condition after the body.",
      hint: "One of them checks the condition at the end."
    }
  ],
  Inheritance: [
    {
      id: "seed_q_inh_1",
      question: "Which keyword makes one class inherit from another?",
      options: ["extends", "implements", "inherits", "super"],
      correctAnswer: "extends",
      explanation: "`extends` for classes; `implements` for interfaces.",
      hint: "`implements` is for interfaces — this is the other one."
    },
    {
      id: "seed_q_inh_2",
      question: "How many classes can a Java class directly extend?",
      options: ["1", "2", "Unlimited", "0"],
      correctAnswer: "1",
      explanation: "Java has single class inheritance.",
      hint: "Java avoids the diamond problem by limiting this."
    }
  ],
  Polymorphism: [
    {
      id: "seed_q_poly_1",
      question: "Calling an overridden method through a supertype reference runs:",
      options: [
        "the subclass version",
        "the superclass version",
        "both versions",
        "neither version"
      ],
      correctAnswer: "the subclass version",
      explanation: "Dispatch is on the runtime type, not the declared type.",
      hint: "Which type does Java look at — declared, or actual?"
    }
  ]
};

const upsertUser = async ({ id, email, name, role, password }) => {
  const hashed = await bcrypt.hash(password, 10);
  return prisma.user.upsert({
    where: { email },
    update: { name, role, password: hashed, isVerified: true },
    create: { id, email, name, role, password: hashed, isVerified: true }
  });
};

const upsertQuestion = async (concept, q, courseId, createdBy) =>
  prisma.question.upsert({
    where: { id: q.id },
    update: {
      question: q.question,
      options: q.options,
      correctAnswer: q.correctAnswer,
      explanation: q.explanation,
      hint: q.hint,
      // The concept the adaptive engine reasons about. Must equal the Topic
      // title for recommendations to resolve to content.
      topic: concept
    },
    create: {
      id: q.id,
      courseId,
      question: q.question,
      questionType: "MCQ_SINGLE",
      options: q.options,
      correctAnswer: q.correctAnswer,
      explanation: q.explanation,
      hint: q.hint,
      topic: concept,
      subject: "Java",
      marks: 1,
      difficulty: "MEDIUM",
      createdBy
    }
  });

/** Links questions to a quiz without duplicating the join rows. */
const linkQuestions = async (quizId, questionIds) => {
  await prisma.quizQuestion.deleteMany({ where: { quizId } });
  await prisma.quizQuestion.createMany({
    data: questionIds.map((questionId, i) => ({ quizId, questionId, order: i + 1, marks: 1 }))
  });
};

async function seed() {
  console.log("=== Seeding demo course ===\n");

  // 1. Accounts
  const [instructor, studentUser] = await Promise.all(ACCOUNTS.map(upsertUser));

  const studentProfile = await prisma.studentProfile.upsert({
    where: { userId: studentUser.id },
    update: {},
    create: { userId: studentUser.id, education: "Computer Science" }
  });

  console.log(`instructor: ${instructor.email}`);
  console.log(`student:    ${studentUser.email}  (profile ${studentProfile.id})`);

  // 2. Course, published so a student can actually open it
  const course = await prisma.course.upsert({
    where: { id: COURSE.id },
    update: { title: COURSE.title, description: COURSE.description, status: "PUBLISHED" },
    create: {
      id: COURSE.id,
      title: COURSE.title,
      description: COURSE.description,
      status: "PUBLISHED",
      category: "Programming",
      level: "Beginner",
      language: "English",
      certificatesEnabled: true,
      publishedAt: new Date(),
      creatorId: instructor.id
    }
  });
  console.log(`course:     ${course.title} (${course.id})`);

  // 3. Hierarchy — everything published, or a student sees nothing
  let moduleOrder = 0;
  for (const mod of COURSE.modules) {
    moduleOrder += 1;
    await prisma.module.upsert({
      where: { id: mod.id },
      update: { title: mod.title, order: moduleOrder, isPublished: true },
      create: { id: mod.id, courseId: course.id, title: mod.title, order: moduleOrder, isPublished: true }
    });

    let lessonOrder = 0;
    for (const lesson of mod.lessons) {
      lessonOrder += 1;
      await prisma.lesson.upsert({
        where: { id: lesson.id },
        update: { title: lesson.title, order: lessonOrder, isPublished: true },
        create: {
          id: lesson.id,
          moduleId: mod.id,
          title: lesson.title,
          order: lessonOrder,
          isPublished: true
        }
      });

      let topicOrder = 0;
      for (const topic of lesson.topics) {
        topicOrder += 1;
        await prisma.topic.upsert({
          where: { id: topic.id },
          update: { title: topic.title, order: topicOrder, isPublished: true },
          create: {
            id: topic.id,
            lessonId: lesson.id,
            title: topic.title,
            order: topicOrder,
            isPublished: true
          }
        });

        // One readable content block per topic, so every topic is completable.
        await prisma.content.upsert({
          where: { id: `${topic.id}_content` },
          update: { title: topic.title, htmlContent: topic.body },
          create: {
            id: `${topic.id}_content`,
            topicId: topic.id,
            type: "HTML",
            title: topic.title,
            htmlContent: topic.body,
            order: 1
          }
        });
      }
    }
  }

  // 4. Questions, tagged with the concept that matches their topic title
  const questionIdsByConcept = {};
  for (const [concept, list] of Object.entries(QUESTIONS)) {
    for (const q of list) await upsertQuestion(concept, q, course.id, instructor.id);
    questionIdsByConcept[concept] = list.map((q) => q.id);
  }
  const totalQuestions = Object.values(questionIdsByConcept).flat().length;
  console.log(`questions:  ${totalQuestions} across ${Object.keys(QUESTIONS).length} concepts`);

  // 5. A Self-Test on lesson 1, and a QUALIFYING test that lets a student
  //    skip lesson 3 — which is what exercises Phases 2, 3, 4 and 7.
  const selfTest = await prisma.quiz.upsert({
    where: { id: "seed_quiz_selftest" },
    update: { title: "Java Basics — Practice", isPublished: true },
    create: {
      id: "seed_quiz_selftest",
      courseId: course.id,
      lessonId: "seed_les_1",
      title: "Java Basics — Practice",
      quizTag: "SELF_TEST",
      passingScore: 60,
      attempts: 0,
      isPublished: true,
      order: await getNextOrder("lessonId", "seed_les_1", prisma)
    }
  });
  await linkQuestions(selfTest.id, [
    ...questionIdsByConcept.Variables,
    ...questionIdsByConcept["Data Types"]
  ]);

  const qualifying = await prisma.quiz.upsert({
    where: { id: "seed_quiz_qualifying" },
    update: { title: "Qualifying Test — Classes and Objects", isPublished: true },
    create: {
      id: "seed_quiz_qualifying",
      courseId: course.id,
      // The lesson this test lets the student SKIP.
      lessonId: "seed_les_3",
      title: "Qualifying Test — Classes and Objects",
      quizTag: "QUALIFYING",
      passingScore: 70,
      attempts: 3,
      isPublished: true,
      order: await getNextOrder("lessonId", "seed_les_3", prisma)
    }
  });
  await linkQuestions(qualifying.id, [
    ...questionIdsByConcept.Inheritance,
    ...questionIdsByConcept.Polymorphism
  ]);

  console.log(`quizzes:    Self-Test (${selfTest.id}), Qualifying (${qualifying.id})`);

  // 6. Enrol the student, or none of the above is reachable
  await prisma.enrollment.upsert({
    where: { studentId_courseId: { studentId: studentProfile.id, courseId: course.id } },
    update: {},
    create: { studentId: studentProfile.id, courseId: course.id }
  });

  console.log("\n==================================================");
  console.log("SEED COMPLETE");
  console.log("==================================================");
  for (const a of ACCOUNTS) {
    console.log(`${a.role.padEnd(11)} ${a.email.padEnd(28)} ${a.password}`);
  }
  console.log(`\ncourse id:   ${course.id}`);
  console.log(`student url: /student/learn/${course.id}`);
  console.log("==================================================\n");

  await prisma.$disconnect();
}

seed().catch(async (err) => {
  console.error("Seed failed:", err);
  await prisma.$disconnect();
  process.exit(1);
});
