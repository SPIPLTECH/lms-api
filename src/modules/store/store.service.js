const prisma = require("../../config/database");

const getStoreByCourseId = async (courseId) => {
  const course = await prisma.course.findUnique({ where: { id: courseId } });

  if (!course) {
    const error = new Error("Course not found");
    error.statusCode = 404;
    throw error;
  }

  const store = await prisma.store.findUnique({ where: { courseId } });

  if (!store) {
    return { courseId, price: 0, discountPrice: null, currency: "INR", isFree: true };
  }

  return store;
};

const setCoursePrice = async (courseId, data) => {
  const course = await prisma.course.findUnique({ where: { id: courseId } });

  if (!course) {
    const error = new Error("Course not found");
    error.statusCode = 404;
    throw error;
  }

  const isFree = data.isFree === true || data.price === 0;

  const storeData = {
    price: isFree ? 0 : data.price,
    discountPrice: isFree ? null : (data.discountPrice ?? null),
    currency: data.currency || "INR",
    isFree,
  };

  return prisma.store.upsert({
    where: { courseId },
    update: storeData,
    create: { ...storeData, courseId },
  });
};

const deleteCoursePrice = async (courseId) => {
  const store = await prisma.store.findUnique({ where: { courseId } });

  if (!store) {
    const error = new Error("Price not set for this course");
    error.statusCode = 404;
    throw error;
  }

  return prisma.store.delete({ where: { courseId } });
};

module.exports = { getStoreByCourseId, setCoursePrice, deleteCoursePrice };
