const prisma = require("../../config/database");

const getCertificates = async (
requester,
userId,
courseId
) => {
const where = {};

if (
requester.role === "ADMIN" ||
requester.role === "INSTRUCTOR"
) {
if (userId) {
where.userId = userId;
}
} else {
where.userId = requester.id;
}

if (courseId) {
where.courseId = courseId;
}

return prisma.certificate.findMany({
where,
include: {
user: {
select: {
id: true,
name: true,
email: true
}
},
course: {
select: {
id: true,
title: true
}
}
},
orderBy: {
issuedAt: "desc"
}
});
};

const getCertificateById = async (
certificateId
) => {
return prisma.certificate.findUnique({
where: {
id: certificateId
},
include: {
user: {
select: {
id: true,
name: true,
email: true
}
},
course: {
select: {
id: true,
title: true
}
}
}
});
};

const deleteCertificate = async (
certificateId
) => {
return prisma.certificate.delete({
where: {
id: certificateId
}
});
};

module.exports = {
getCertificates,
getCertificateById,
deleteCertificate
};
