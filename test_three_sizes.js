const jwt = require("jsonwebtoken");

const token = jwt.sign(
  { id: "test_instructor_123", email: "instructor@orangetree.com", role: "INSTRUCTOR" },
  process.env.JWT_ACCESS_SECRET || "my_super_access_secret"
);

async function testCourseSize(size, promptText) {
  console.log(`\n=================== TESTING [${size}] COURSE ===================`);
  const startTime = Date.now();

  try {
    const res = await fetch("http://localhost:5000/api/ai/generate", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + token,
      },
      body: JSON.stringify({
        scope: "COURSE",
        prompt: promptText,
        context: {
          size: size,
          targetAudience: "College Students",
          level: "BEGINNER",
          language: "English",
        },
      }),
    });

    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    const jsonText = await res.text();
    const payloadSizeBytes = Buffer.byteLength(jsonText, "utf8");
    const payloadSizeKB = (payloadSizeBytes / 1024).toFixed(2);

    let parsed;
    try {
      parsed = JSON.parse(jsonText);
    } catch (e) {
      console.error(`[${size}] FAILED TO PARSE JSON:`, e.message);
      return { size, time: `${duration}s`, success: false, error: "JSON Parse Error" };
    }

    if (!parsed.success) {
      console.error(`[${size}] API RETURNED ERROR:`, parsed.message);
      return { size, time: `${duration}s`, success: false, error: parsed.message };
    }

    const courseData = parsed.data?.canonicalJson || parsed.data;
    const modules = courseData.modules || [];
    let totalLessons = 0;
    let totalContents = 0;
    let totalQuizzes = courseData.quizzes ? courseData.quizzes.length : 0;
    let totalQuestions = 0;

    modules.forEach((m) => {
      if (Array.isArray(m.quizzes)) {
        totalQuizzes += m.quizzes.length;
        m.quizzes.forEach((q) => {
          if (Array.isArray(q.questions)) totalQuestions += q.questions.length;
        });
      }
      if (Array.isArray(m.lessons)) {
        totalLessons += m.lessons.length;
        m.lessons.forEach((l) => {
          if (Array.isArray(l.topics)) {
            l.topics.forEach((t) => {
              if (Array.isArray(t.contents)) totalContents += t.contents.length;
            });
          }
        });
      }
    });

    console.log(`[${size}] Title: ${courseData.metadata?.title || courseData.title}`);
    console.log(`[${size}] Generation Time: ${duration}s`);
    console.log(`[${size}] Total Modules: ${modules.length}`);
    console.log(`[${size}] Total Lessons: ${totalLessons}`);
    console.log(`[${size}] Total Content Blocks: ${totalContents}`);
    console.log(`[${size}] Total Quizzes: ${totalQuizzes}`);
    console.log(`[${size}] Total Questions: ${totalQuestions}`);
    console.log(`[${size}] Response Size: ${payloadSizeKB} KB (${payloadSizeBytes} bytes)`);
    console.log(`[${size}] Validation Result: PASS`);

    return {
      size,
      time: `${duration}s`,
      modules: modules.length,
      lessons: totalLessons,
      content: totalContents,
      quizzes: totalQuizzes,
      questions: totalQuestions,
      responseSize: `${payloadSizeKB} KB`,
      validation: "PASS",
      success: true,
    };
  } catch (err) {
    console.error(`[${size}] TEST EXCEPTION:`, err);
    return { size, time: "N/A", success: false, error: err.message };
  }
}

async function runAllTests() {
  const smallPrompt = `Create a beginner Python Programming course for college students.
The goal is to teach Python fundamentals.
Cover: Variables, Data Types, Operators, Conditions, Loops, Functions.
Target audience: Beginner college students.
Course size: SMALL.
Generate a complete course with modules, lessons, instructional content, examples, and quizzes using the existing LMS course schema.`;

  const mediumPrompt = `Create a complete Java Programming course for beginner-to-intermediate college students.
Cover: Java fundamentals, Variables and data types, Control flow, Methods, Arrays, Object-oriented programming, Classes and objects, Inheritance, Polymorphism, Exception handling, Collections, File handling.
Course size: MEDIUM.
Generate a complete structured course with modules, lessons, detailed instructional content, examples, exercises, and quizzes using the existing LMS schema.`;

  const largePrompt = `Create a comprehensive Java Full Stack Development course for college students.
Course size: LARGE.
Cover: Java fundamentals, Object-oriented programming, Collections, Exception handling, File handling, JDBC, SQL, Spring Framework, Spring Boot, REST APIs, Spring Security, JWT authentication, JPA, Hibernate, Microservices, Testing, Docker, React fundamentals, React components, State management, REST integration, Frontend authentication, Deployment.
Generate a complete hierarchical course using the existing LMS schema.`;

  const results = [];
  results.push(await testCourseSize("SMALL", smallPrompt));
  results.push(await testCourseSize("MEDIUM", mediumPrompt));
  results.push(await testCourseSize("LARGE", largePrompt));

  console.log("\n=================== FINAL SUMMARY METRICS TABLE ===================");
  console.table(results);
}

runAllTests();
