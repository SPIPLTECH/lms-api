const express = require("express");
const router = express.Router();
const prisma = require("../../config/database");

// Public, identical for every visitor and requested on every landing-page view,
// so the computed payload is reused for a short window instead of querying the
// database per visit. Counts can lag by up to this long.
const LANDING_CACHE_TTL_MS = 60 * 1000;
let landingCache = { expiresAt: 0, promise: null };

const loadLandingData = async () => {
  // Independent queries run together. The course query counts relations in the
  // database (_count) and selects only what the response uses — it previously
  // loaded every module's full lesson rows and every enrollment row just to
  // take their lengths, one round trip after another.
  const [studentCount, courseCount, certificateCount, courses] = await Promise.all([
    prisma.studentProfile.count(),
    prisma.course.count({
      where: { status: "PUBLISHED" }
    }),
    prisma.certificate.count(),
    prisma.course.findMany({
      where: { status: "PUBLISHED" },
      orderBy: { createdAt: "desc" },
      take: 10,
      select: {
        id: true,
        title: true,
        description: true,
        thumbnailUrl: true,
        level: true,
        category: true,
        status: true,
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
          select: {
            _count: { select: { lessons: true } }
          }
        },
        _count: {
          select: {
            enrollments: true,
            modules: true
          }
        },
        store: {
          select: {
            price: true,
            discountPrice: true,
            currency: true,
            isFree: true
          }
        }
      }
    })
  ]);

  const formattedCourses = courses.map(course => {
    const ratings = course.reviews.map(r => r.rating);
    const avgRating = ratings.length > 0 ? ratings.reduce((sum, r) => sum + r, 0) / ratings.length : 4.5;

    let totalLessons = 0;
    course.modules.forEach(m => {
      totalLessons += m._count.lessons;
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
      enrollmentsCount: course._count.enrollments,
      modulesCount: course._count.modules,
      store: course.store
        ? {
            price: course.store.price,
            discountPrice: course.store.discountPrice,
            currency: course.store.currency,
            isFree: course.store.isFree
          }
        : null
    };
  });

  return {
    stats: {
      students: studentCount,
      courses: courseCount,
      certificates: certificateCount
    },
    courses: formattedCourses
  };
};

router.get("/landing-data", async (req, res) => {
  try {
    const now = Date.now();
    if (!landingCache.promise || now >= landingCache.expiresAt) {
      // Concurrent visitors during a refresh share the one in-flight query.
      const promise = loadLandingData();
      landingCache = { expiresAt: now + LANDING_CACHE_TTL_MS, promise };
      promise.catch(() => {
        if (landingCache.promise === promise) landingCache = { expiresAt: 0, promise: null };
      });
    }

    const data = await landingCache.promise;

    res.status(200).json({
      success: true,
      data
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
