const certificateService = require("./certificate.service");

const getCertificates = async (req, res, next) => {
try {
const certificates =
await certificateService.getCertificates(
req.user,
req.query.userId,
req.query.courseId
);

res.json({
  success: true,
  data: certificates
});

} catch (error) {
next(error);
}
};

const getCertificateById = async (
req,
res,
next
) => {
try {
const certificate =
await certificateService.getCertificateById(
req.params.certificateId
);

if (!certificate) {
  return res.status(404).json({
    success: false,
    message: "Certificate not found"
  });
}

res.json({
  success: true,
  data: certificate
});

} catch (error) {
next(error);
}
};

const deleteCertificate = async (
req,
res,
next
) => {
try {
await certificateService.deleteCertificate(
req.params.certificateId
);

res.json({
  success: true,
  message:
    "Certificate deleted successfully"
});

} catch (error) {
next(error);
}
};

module.exports = {
getCertificates,
getCertificateById,
deleteCertificate
};