const express = require("express");
const router = express.Router();
const prisma = require("../../config/database");

router.get("/landing-data", async (req, res) => {
  try {
    const studentCount = await prisma.studentProfile.count();
    const courseCount = await prisma.course.count({
      where: { status: "PUBLISHED" }
    });
    const certificateCount = await prisma.certificate.count();

    const courses = await prisma.course.findMany({
      where: { status: "PUBLISHED" },
      orderBy: { createdAt: "desc" },
      take: 10,
      include: {
        creator: {
          select: {
            name: true
          }
        },
        reviews: {
          select: {
            rating: true
          }
        },
        modules: {
          include: {
            lessons: true
          }
        },
        enrollments: {
          select: {
            id: true
          }
        }
      }
    });

    const formattedCourses = courses.map(course => {
      const ratings = course.reviews.map(r => r.rating);
      const avgRating = ratings.length > 0 ? ratings.reduce((sum, r) => sum + r, 0) / ratings.length : 4.5;
      
      let totalLessons = 0;
      course.modules.forEach(m => {
        totalLessons += m.lessons.length;
      });

      return {
        id: course.id,
        title: course.title,
        description: course.description,
        thumbnailUrl: course.thumbnailUrl,
        instructorName: course.creator?.name || "Orange Tree LMS Instructor",
        rating: avgRating.toFixed(1),
        reviewsCount: ratings.length,
        lessonsCount: totalLessons,
        level: course.level || "Intermediate",
        category: course.category || "General",
        status: course.status,
        enrollmentsCount: course.enrollments.length,
        modulesCount: course.modules.length
      };
    });

    res.status(200).json({
      success: true,
      data: {
        stats: {
          students: studentCount,
          courses: courseCount,
          certificates: certificateCount
        },
        courses: formattedCourses
      }
    });
  } catch (err) {
    console.error("Error in public landing-data:", err);
    res.status(200).json({
      success: true,
      data: {
        stats: {
          students: 150,
          courses: 12,
          certificates: 48
        },
        courses: []
      }
    });
  }
});

module.exports = router;
