const { PrismaClient } = require("@prisma/client");
const bcrypt = require("bcrypt");
const p = new PrismaClient();
const TAG = "ytembed_verify";
const PASS = "Password123!";

(async () => {
  const hash = await bcrypt.hash(PASS, 10);
  const inst = await p.user.upsert({
    where: { email: `${TAG}_instructor@test.com` },
    update: { password: hash },
    create: { id: `${TAG}_inst`, name: "YT Verify Instructor", email: `${TAG}_instructor@test.com`, password: hash, role: "INSTRUCTOR", isVerified: true },
  });
  const stu = await p.user.upsert({
    where: { email: `${TAG}_student@test.com` },
    update: { password: hash },
    create: { id: `${TAG}_stu`, name: "YT Verify Student", email: `${TAG}_student@test.com`, password: hash, role: "STUDENT", isVerified: true },
  });
  const sp = await p.studentProfile.upsert({ where: { userId: stu.id }, update: {}, create: { userId: stu.id } });

  const course = await p.course.upsert({
    where: { id: `${TAG}_course` },
    update: { status: "PUBLISHED" },
    create: { id: `${TAG}_course`, title: "YT Embed Verification", description: "Fixture", creatorId: inst.id, status: "PUBLISHED", publishedAt: new Date() },
  });
  const mod = await p.module.upsert({ where: { id: `${TAG}_m` }, update: {}, create: { id: `${TAG}_m`, title: "Module 1", order: 1, courseId: course.id, isPublished: true } });
  const les = await p.lesson.upsert({ where: { id: `${TAG}_l` }, update: {}, create: { id: `${TAG}_l`, title: "Lesson 1", order: 1, moduleId: mod.id, isPublished: true } });
  const top = await p.topic.upsert({ where: { id: `${TAG}_t` }, update: {}, create: { id: `${TAG}_t`, title: "Topic 1", order: 1, lessonId: les.id, isPublished: true } });

  const rows = [
    { id: `${TAG}_c1`, order: 1, title: "TEST 1 — youtu.be short link + ?si", videoUrl: "https://youtu.be/wRejGDZKJiM?si=UGX7S_nInxL7ueAP" },
    { id: `${TAG}_c2`, order: 2, title: "TEST 2 — standard watch?v=",        videoUrl: "https://www.youtube.com/watch?v=wRejGDZKJiM" },
    { id: `${TAG}_c3`, order: 3, title: "TEST 3 — shorts link",              videoUrl: "https://www.youtube.com/shorts/wRejGDZKJiM" },
    { id: `${TAG}_c4`, order: 4, title: "TEST 4 — direct MP4",               videoUrl: "https://test-videos.co.uk/vids/bigbuckbunny/mp4/h264/360/Big_Buck_Bunny_360_10s_1MB.mp4" },
    { id: `${TAG}_c5`, order: 5, title: "TEST 5 — invalid YouTube (playlist)", videoUrl: "https://www.youtube.com/playlist?list=PLnotavideo" },
  ];
  for (const r of rows) {
    await p.content.upsert({ where: { id: r.id }, update: { videoUrl: r.videoUrl, title: r.title }, create: { ...r, type: "VIDEO", topicId: top.id } });
  }
  await p.enrollment.upsert({ where: { studentId_courseId: { studentId: sp.id, courseId: course.id } }, update: {}, create: { studentId: sp.id, courseId: course.id } });

  console.log("FIXTURE READY");
  console.log("instructor:", inst.email, PASS);
  console.log("student:   ", stu.email, PASS);
  console.log("courseId:  ", course.id, "lessonId:", les.id);
  await p.$disconnect();
})().catch(async e => { console.error("ERR", e); await p.$disconnect(); process.exit(1); });
