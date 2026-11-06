const { PDFDocument, rgb, StandardFonts } = require("pdf-lib");

/**
 * Parses a hex color string like "#D97706" to pdf-lib rgb(r, g, b)
 */
function hexToRgb(hex, defaultColor = rgb(0.85, 0.65, 0.13)) {
  if (!hex || typeof hex !== "string") return defaultColor;
  const cleanHex = hex.replace("#", "").trim();
  if (cleanHex.length === 3) {
    const r = parseInt(cleanHex[0] + cleanHex[0], 16) / 255;
    const g = parseInt(cleanHex[1] + cleanHex[1], 16) / 255;
    const b = parseInt(cleanHex[2] + cleanHex[2], 16) / 255;
    return rgb(r, g, b);
  }
  if (cleanHex.length === 6) {
    const r = parseInt(cleanHex.substring(0, 2), 16) / 255;
    const g = parseInt(cleanHex.substring(2, 4), 16) / 255;
    const b = parseInt(cleanHex.substring(4, 6), 16) / 255;
    return rgb(r, g, b);
  }
  return defaultColor;
}

/**
 * Format a Date object into human-readable UTC string: "Month DD, YYYY"
 */
function formatDate(date) {
  if (!date) return "N/A";
  const d = new Date(date);
  if (isNaN(d.getTime())) return "N/A";
  return d.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
}

/**
 * Wraps text into lines that fit within maxChars.
 */
function wrapText(text, maxChars = 85) {
  if (!text) return [];
  const words = String(text).trim().split(/\s+/);
  const lines = [];
  let currentLine = "";

  for (const word of words) {
    if ((currentLine + " " + word).trim().length <= maxChars) {
      currentLine = (currentLine + " " + word).trim();
    } else {
      if (currentLine) lines.push(currentLine);
      currentLine = word;
    }
  }
  if (currentLine) lines.push(currentLine);
  return lines;
}

/**
 * Canonical Template ID definitions.
 */
const TEMPLATE_IDS = {
  CLASSIC_GOLD_V1: "CLASSIC_GOLD_V1", // Traditional Academic
  CLASSIC_GOLD_V2: "CLASSIC_GOLD_V2", // Modern Classic
  CLASSIC_GOLD_V3: "CLASSIC_GOLD_V3", // Premium Ornamental
  CLASSIC_GOLD_V4: "CLASSIC_GOLD_V4", // Royal Minimal
  // Legacy Aliases
  CLASSIC_GOLD: "CLASSIC_GOLD_V1",
  MODERN_MINIMAL: "MODERN_MINIMAL",
  PREMIUM_DARK: "PREMIUM_DARK",
  TECH_GRADIENT: "TECH_GRADIENT",
};

/**
 * Normalizes any template identifier into an approved or legacy template ID.
 */
function normalizeTemplateId(templateId) {
  if (!templateId) return TEMPLATE_IDS.CLASSIC_GOLD_V1;
  const upper = String(templateId).trim().toUpperCase();

  if (upper === "CLASSIC_GOLD_V1" || upper === "GOLD_A" || upper === "TRADITIONAL_ACADEMIC") {
    return TEMPLATE_IDS.CLASSIC_GOLD_V1;
  }
  if (upper === "CLASSIC_GOLD_V2" || upper === "GOLD_B" || upper === "MODERN_CLASSIC") {
    return TEMPLATE_IDS.CLASSIC_GOLD_V2;
  }
  if (upper === "CLASSIC_GOLD_V3" || upper === "GOLD_C" || upper === "PREMIUM_ORNAMENTAL") {
    return TEMPLATE_IDS.CLASSIC_GOLD_V3;
  }
  if (upper === "CLASSIC_GOLD_V4" || upper === "GOLD_D" || upper === "ROYAL_MINIMAL") {
    return TEMPLATE_IDS.CLASSIC_GOLD_V4;
  }
  if (upper === "CLASSIC_GOLD" || upper === "CLASSIC") {
    return TEMPLATE_IDS.CLASSIC_GOLD_V1;
  }
  if (upper === "MODERN_MINIMAL" || upper === "PREMIUM_DARK" || upper === "TECH_GRADIENT") {
    return upper;
  }
  return TEMPLATE_IDS.CLASSIC_GOLD_V1;
}

/**
 * Generates a clean, readable, sanitized filename for certificate downloads.
 * Format: Course_Ranger_<Student_Name>_<Course_Name>.pdf
 */
function generateCertificateFilename(cert = {}) {
  const sanitize = (str) =>
    String(str || "")
      .trim()
      .replace(/[^a-zA-Z0-9_\-\s]/g, "")
      .replace(/\s+/g, "_");

  const studentName = sanitize(cert.student?.user?.name || cert.studentName || "Student");
  const courseTitle = sanitize(cert.course?.title || cert.courseTitle || "Course");

  const safeStudent = studentName.substring(0, 40) || "Student";
  const safeCourse = courseTitle.substring(0, 50) || "Course";

  return `Course_Ranger_${safeStudent}_${safeCourse}.pdf`;
}

// -----------------------------------------------------------------------------
// RENDERER 1: CLASSIC GOLD — TRADITIONAL ACADEMIC (CLASSIC_GOLD_V1)
// -----------------------------------------------------------------------------
function renderClassicGoldV1(page, params, fonts) {
  const { width, height } = page.getSize();
  const { fontRegular, fontBold, fontItalic, fontSerifBold } = fonts;

  const bgIvory = rgb(0.985, 0.976, 0.945); // #FAF9F1
  const gold = params.accentColor ? hexToRgb(params.accentColor, rgb(0.72, 0.53, 0.04)) : rgb(0.72, 0.53, 0.04); // #B8860B
  const darkBronze = rgb(0.24, 0.16, 0.06); // #3D2A0F
  const mutedText = rgb(0.47, 0.35, 0.17); // #785A2C

  // 1. Background
  page.drawRectangle({ x: 0, y: 0, width, height, color: bgIvory });

  // 2. Borders: Outer dark bronze + inner double-line gold border
  page.drawRectangle({ x: 14, y: 14, width: width - 28, height: height - 28, borderColor: darkBronze, borderWidth: 4 });
  page.drawRectangle({ x: 24, y: 24, width: width - 48, height: height - 48, borderColor: gold, borderWidth: 2 });
  page.drawRectangle({ x: 28, y: 28, width: width - 56, height: height - 56, borderColor: gold, borderWidth: 1 });

  // 3. Corner Rosette Blocks (4 corners)
  const cbSize = 18;
  const corners = [
    { x: 19, y: height - 19 - cbSize },
    { x: width - 19 - cbSize, y: height - 19 - cbSize },
    { x: 19, y: 19 },
    { x: width - 19 - cbSize, y: 19 },
  ];
  for (const c of corners) {
    page.drawRectangle({ x: c.x, y: c.y, width: cbSize, height: cbSize, color: darkBronze, borderColor: gold, borderWidth: 1.5 });
    page.drawRectangle({ x: c.x + 5, y: c.y + 5, width: cbSize - 10, height: cbSize - 10, color: rgb(1, 0.84, 0) });
  }

  // 4. Header: Institution & Title
  const brand = (params.brandingName || "COURSE RANGER").toUpperCase();
  const brandW = fontSerifBold.widthOfTextAtSize(brand, 16);
  page.drawText(brand, { x: (width - brandW) / 2, y: height - 68, size: 16, font: fontSerifBold, color: darkBronze });

  const subBrand = (params.brandingPoweredBy || "Powered by SPIPL").toUpperCase();
  const subBrandW = fontBold.widthOfTextAtSize(subBrand, 7.5);
  page.drawText(subBrand, { x: (width - subBrandW) / 2, y: height - 80, size: 7.5, font: fontBold, color: gold });

  const title = (params.certificateTitle || "CERTIFICATE OF COMPLETION").toUpperCase();
  const titleW = fontSerifBold.widthOfTextAtSize(title, 24);
  page.drawText(title, { x: (width - titleW) / 2, y: height - 114, size: 24, font: fontSerifBold, color: darkBronze });

  // Engraved gold divider line with center diamond
  page.drawLine({ start: { x: width / 2 - 140, y: height - 126 }, end: { x: width / 2 + 140, y: height - 126 }, color: gold, thickness: 1.5 });

  // 5. Presentation Label
  const presText = "This is proudly presented to";
  const presW = fontItalic.widthOfTextAtSize(presText, 12);
  page.drawText(presText, { x: (width - presW) / 2, y: height - 154, size: 12, font: fontItalic, color: mutedText });

  // 6. Recipient Name (Focal Point)
  const sName = params.studentName || "Valued Student";
  const sSize = sName.length > 30 ? 24 : 31;
  const sNameW = fontSerifBold.widthOfTextAtSize(sName, sSize);
  page.drawText(sName, { x: (width - sNameW) / 2, y: height - 196, size: sSize, font: fontSerifBold, color: darkBronze });

  // 7. Course Completion Description & Course Name
  const desc = "for successfully mastering the curriculum and meeting all criteria for completion of the professional program in";
  const descW = fontRegular.widthOfTextAtSize(desc, 10.5);
  page.drawText(desc, { x: (width - descW) / 2, y: height - 224, size: 10.5, font: fontRegular, color: mutedText });

  const cTitle = params.courseTitle || "Course Title";
  const cSize = cTitle.length > 40 ? 17 : 21;
  const cW = fontSerifBold.widthOfTextAtSize(cTitle, cSize);
  page.drawText(cTitle, { x: (width - cW) / 2, y: height - 256, size: cSize, font: fontSerifBold, color: darkBronze });

  // 8. Grade & Performance Section (Only if graded)
  let curY = height - 286;
  if (params.grade && params.grade !== "Completed" && params.score !== null && params.score !== undefined) {
    const gradeStr = `GRADE: ${params.grade}     •     SCORE: ${params.score}%     •     PERFORMANCE: ${(params.performanceDescription || "EXCELLENT").toUpperCase()}`;
    const gW = fontBold.widthOfTextAtSize(gradeStr, 10);
    const boxW = gW + 28;
    page.drawRectangle({ x: (width - boxW) / 2, y: curY - 4, width: boxW, height: 18, color: rgb(0.96, 0.94, 0.88), borderColor: gold, borderWidth: 1 });
    page.drawText(gradeStr, { x: (width - gW) / 2, y: curY + 1, size: 10, font: fontBold, color: darkBronze });
    curY -= 28;
  } else {
    curY -= 12;
  }

  // 9. Dates Row (Enrollment Date and Completion Date aligned horizontally in one row!)
  const enrDate = formatDate(params.enrolledAt || params.issuedAt);
  const compDate = formatDate(params.completedAt || params.issuedAt);
  const dateRowText = `Enrollment Date: ${enrDate}       •       Completion Date: ${compDate}`;
  const dRowW = fontBold.widthOfTextAtSize(dateRowText, 9.5);
  page.drawLine({ start: { x: (width - dRowW) / 2 - 20, y: curY + 13 }, end: { x: (width + dRowW) / 2 + 20, y: curY + 13 }, color: gold, thickness: 0.8 });
  page.drawText(dateRowText, { x: (width - dRowW) / 2, y: curY + 3, size: 9.5, font: fontBold, color: darkBronze });
  page.drawLine({ start: { x: (width - dRowW) / 2 - 20, y: curY - 4 }, end: { x: (width + dRowW) / 2 + 20, y: curY - 4 }, color: gold, thickness: 0.8 });

  // 10. Footer Section (Issued On, Seal, Signatures)
  const colY = 104;

  // Left: Issued On (Aligned separately from completion dates)
  page.drawText("ISSUED ON:", { x: 60, y: colY + 14, size: 8, font: fontBold, color: mutedText });
  page.drawText(formatDate(params.issuedAt), { x: 60, y: colY + 1, size: 9.5, font: fontBold, color: darkBronze });
  page.drawText("Verified Academic Credential", { x: 60, y: colY - 11, size: 7.5, font: fontRegular, color: mutedText });

  // Center: Traditional Gold Seal with Ribbons
  const sealX = width / 2;
  const sealY = colY + 4;
  // Ribbon tails
  page.drawLine({ start: { x: sealX - 8, y: sealY - 14 }, end: { x: sealX - 16, y: sealY - 36 }, color: rgb(0.55, 0.15, 0.15), thickness: 8 });
  page.drawLine({ start: { x: sealX + 8, y: sealY - 14 }, end: { x: sealX + 16, y: sealY - 36 }, color: gold, thickness: 8 });
  // Gold circle wafer
  page.drawCircle({ x: sealX, y: sealY, size: 28, color: gold, borderColor: darkBronze, borderWidth: 1.5 });
  page.drawCircle({ x: sealX, y: sealY, size: 22, color: darkBronze });
  const sealText = "VERIFIED";
  const stW = fontBold.widthOfTextAtSize(sealText, 6.5);
  page.drawText(sealText, { x: sealX - stW / 2, y: sealY - 2.5, size: 6.5, font: fontBold, color: rgb(1, 0.9, 0.6) });

  // Right: Instructor Signature Area
  const sigLineX = width - 235;
  page.drawLine({ start: { x: sigLineX, y: colY + 14 }, end: { x: sigLineX + 175, y: colY + 14 }, color: darkBronze, thickness: 1 });
  const sigName = params.instructorName || params.signatoryName || "Prasad Kulkarni";
  const sigW = fontSerifBold.widthOfTextAtSize(sigName, 10.5);
  page.drawText(sigName, { x: sigLineX + (175 - sigW) / 2, y: colY + 1, size: 10.5, font: fontSerifBold, color: darkBronze });
  const sigTitle = params.signatoryTitle || "Lead Instructor & Evaluator";
  const sTitW = fontRegular.widthOfTextAtSize(sigTitle, 8);
  page.drawText(sigTitle, { x: sigLineX + (175 - sTitW) / 2, y: colY - 11, size: 8, font: fontRegular, color: mutedText });

  // 11. Discreet Credential ID Footer
  const credText = `Credential ID: ${params.certificateNo || "CR-01OKK6"}   •   Verify: courseranger.com/verify/${params.certificateNo || "CR-01OKK6"}   •   Orange Tree LMS`;
  const credW = fontRegular.widthOfTextAtSize(credText, 7.5);
  page.drawText(credText, { x: (width - credW) / 2, y: 32, size: 7.5, font: fontRegular, color: mutedText });
}

// -----------------------------------------------------------------------------
// RENDERER 2: CLASSIC GOLD — MODERN CLASSIC (CLASSIC_GOLD_V2)
// -----------------------------------------------------------------------------
function renderClassicGoldV2(page, params, fonts) {
  const { width, height } = page.getSize();
  const { fontRegular, fontBold, fontSerifBold } = fonts;

  const bg = rgb(0.99, 0.985, 0.975); // #FCFBF9
  const gold = params.accentColor ? hexToRgb(params.accentColor, rgb(0.78, 0.61, 0.21)) : rgb(0.78, 0.61, 0.21); // #C89D35
  const charcoal = rgb(0.08, 0.10, 0.14); // #141A24
  const warmAmber = rgb(0.57, 0.25, 0.05); // #92400E
  const mutedText = rgb(0.42, 0.45, 0.50);

  // Background
  page.drawRectangle({ x: 0, y: 0, width, height, color: bg });

  // Single refined gold border (2px) + delicate hairline inset
  page.drawRectangle({ x: 18, y: 18, width: width - 36, height: height - 36, borderColor: gold, borderWidth: 2 });
  page.drawRectangle({ x: 26, y: 26, width: width - 52, height: height - 52, borderColor: gold, borderWidth: 0.5 });

  // Header: Clean Modern Sans Institution + Serif Title
  const brand = (params.brandingName || "COURSE RANGER").toUpperCase();
  const brandW = fontBold.widthOfTextAtSize(brand, 13);
  page.drawText(brand, { x: (width - brandW) / 2, y: height - 68, size: 13, font: fontBold, color: charcoal });

  const subBrand = (params.brandingPoweredBy || "Powered by SPIPL").toUpperCase();
  const subBrandW = fontBold.widthOfTextAtSize(subBrand, 7.5);
  page.drawText(subBrand, { x: (width - subBrandW) / 2, y: height - 80, size: 7.5, font: fontBold, color: warmAmber });

  const title = (params.certificateTitle || "CERTIFICATE OF COMPLETION").toUpperCase();
  const titleW = fontSerifBold.widthOfTextAtSize(title, 23);
  page.drawText(title, { x: (width - titleW) / 2, y: height - 114, size: 23, font: fontSerifBold, color: warmAmber });

  page.drawLine({ start: { x: width / 2 - 40, y: height - 124 }, end: { x: width / 2 + 40, y: height - 124 }, color: gold, thickness: 2.5 });

  // Presentation Subtitle
  const presText = "THIS IS PROUDLY PRESENTED TO";
  const presW = fontBold.widthOfTextAtSize(presText, 9);
  page.drawText(presText, { x: (width - presW) / 2, y: height - 152, size: 9, font: fontBold, color: mutedText });

  // Recipient Name (Oversized, visual hero)
  const sName = params.studentName || "Valued Student";
  const sSize = sName.length > 30 ? 26 : 33;
  const sNameW = fontSerifBold.widthOfTextAtSize(sName, sSize);
  page.drawText(sName, { x: (width - sNameW) / 2, y: height - 196, size: sSize, font: fontSerifBold, color: charcoal });

  // Course Description
  const desc = "for successfully mastering the curriculum and meeting all criteria for completion of the professional program in";
  const descW = fontRegular.widthOfTextAtSize(desc, 10.5);
  page.drawText(desc, { x: (width - descW) / 2, y: height - 224, size: 10.5, font: fontRegular, color: mutedText });

  const cTitle = params.courseTitle || "Course Title";
  const cSize = cTitle.length > 40 ? 17 : 21;
  const cW = fontBold.widthOfTextAtSize(cTitle, cSize);
  page.drawText(cTitle, { x: (width - cW) / 2, y: height - 256, size: cSize, font: fontBold, color: warmAmber });

  // Grade & Performance Section
  let curY = height - 286;
  if (params.grade && params.grade !== "Completed" && params.score !== null && params.score !== undefined) {
    const gradeStr = `GRADE: ${params.grade}     |     SCORE: ${params.score}%     |     PERFORMANCE: ${(params.performanceDescription || "EXCELLENT").toUpperCase()}`;
    const gW = fontBold.widthOfTextAtSize(gradeStr, 9.5);
    const boxW = gW + 26;
    page.drawRectangle({ x: (width - boxW) / 2, y: curY - 3, width: boxW, height: 17, color: rgb(0.99, 0.96, 0.90), borderColor: gold, borderWidth: 1 });
    page.drawText(gradeStr, { x: (width - gW) / 2, y: curY + 1.5, size: 9.5, font: fontBold, color: charcoal });
    curY -= 28;
  } else {
    curY -= 12;
  }

  // Dates Row (Single Horizontal Row)
  const enrDate = formatDate(params.enrolledAt || params.issuedAt);
  const compDate = formatDate(params.completedAt || params.issuedAt);
  const dateRowText = `ENROLLMENT: ${enrDate.toUpperCase()}     |     COMPLETION: ${compDate.toUpperCase()}`;
  const dRowW = fontBold.widthOfTextAtSize(dateRowText, 9);
  page.drawText(dateRowText, { x: (width - dRowW) / 2, y: curY + 2, size: 9, font: fontBold, color: mutedText });

  // Footer: Left (Issued On), Center (Coin Seal), Right (Signature)
  const colY = 104;

  page.drawText("ISSUED ON:", { x: 60, y: colY + 14, size: 8, font: fontBold, color: mutedText });
  page.drawText(formatDate(params.issuedAt), { x: 60, y: colY + 1, size: 9.5, font: fontBold, color: charcoal });
  page.drawText("Official Verified Record", { x: 60, y: colY - 11, size: 7.5, font: fontRegular, color: mutedText });

  // Center: Clean Gold Coin Seal
  const sealX = width / 2;
  const sealY = colY + 4;
  page.drawCircle({ x: sealX, y: sealY, size: 26, color: rgb(1, 0.98, 0.92), borderColor: gold, borderWidth: 2 });
  page.drawCircle({ x: sealX, y: sealY, size: 20, color: warmAmber });
  const svText = "VERIFIED";
  const svW = fontBold.widthOfTextAtSize(svText, 6.5);
  page.drawText(svText, { x: sealX - svW / 2, y: sealY - 2.5, size: 6.5, font: fontBold, color: rgb(1, 1, 1) });

  // Right: Signature
  const sigLineX = width - 235;
  page.drawLine({ start: { x: sigLineX, y: colY + 14 }, end: { x: sigLineX + 175, y: colY + 14 }, color: gold, thickness: 1.5 });
  const sigName = params.instructorName || params.signatoryName || "Prasad Kulkarni";
  const sigW = fontBold.widthOfTextAtSize(sigName, 10.5);
  page.drawText(sigName, { x: sigLineX + (175 - sigW) / 2, y: colY + 1, size: 10.5, font: fontBold, color: charcoal });
  const sigTitle = params.signatoryTitle || "Lead Instructor & Evaluator";
  const sTitW = fontRegular.widthOfTextAtSize(sigTitle, 8);
  page.drawText(sigTitle, { x: sigLineX + (175 - sTitW) / 2, y: colY - 11, size: 8, font: fontRegular, color: mutedText });

  // Discreet Credential ID
  const credText = `CREDENTIAL ID: ${params.certificateNo || "CR-01OKK6"}   •   VERIFICATION: courseranger.com/verify/${params.certificateNo || "CR-01OKK6"}   •   ORANGE TREE LMS`;
  const credW = fontRegular.widthOfTextAtSize(credText, 7.5);
  page.drawText(credText, { x: (width - credW) / 2, y: 32, size: 7.5, font: fontRegular, color: mutedText });
}

// -----------------------------------------------------------------------------
// RENDERER 3: CLASSIC GOLD — PREMIUM ORNAMENTAL (CLASSIC_GOLD_V3)
// -----------------------------------------------------------------------------
function renderClassicGoldV3(page, params, fonts) {
  const { width, height } = page.getSize();
  const { fontRegular, fontBold, fontItalic, fontSerifBold } = fonts;

  const bgIvory = rgb(0.98, 0.96, 0.92); // #FAF5EB
  const gold = params.accentColor ? hexToRgb(params.accentColor, rgb(0.70, 0.32, 0.04)) : rgb(0.70, 0.32, 0.04); // #B45309
  const deepSepia = rgb(0.15, 0.10, 0.03); // #261907
  const mutedText = rgb(0.47, 0.29, 0.08); // #784914

  // Background
  page.drawRectangle({ x: 0, y: 0, width, height, color: bgIvory });

  // Subtle Watermark Emblem (Center background circle & laurels at low opacity)
  page.drawCircle({ x: width / 2, y: height / 2, size: 120, borderColor: rgb(0.92, 0.88, 0.80), borderWidth: 2 });
  page.drawCircle({ x: width / 2, y: height / 2, size: 100, borderColor: rgb(0.92, 0.88, 0.80), borderWidth: 1 });

  // Multi-tier gold border
  page.drawRectangle({ x: 12, y: 12, width: width - 24, height: height - 24, borderColor: deepSepia, borderWidth: 4 });
  page.drawRectangle({ x: 20, y: 20, width: width - 40, height: height - 40, borderColor: gold, borderWidth: 2 });
  page.drawRectangle({ x: 26, y: 26, width: width - 52, height: height - 52, borderColor: gold, borderWidth: 0.8 });

  // Ornate Corner Flourish Accents
  const flSize = 22;
  const corners = [
    { x: 22, y: height - 22 - flSize },
    { x: width - 22 - flSize, y: height - 22 - flSize },
    { x: 22, y: 22 },
    { x: width - 22 - flSize, y: 22 },
  ];
  for (const c of corners) {
    page.drawLine({ start: { x: c.x, y: c.y + flSize }, end: { x: c.x + flSize, y: c.y }, color: gold, thickness: 1.5 });
    page.drawCircle({ x: c.x + flSize / 2, y: c.y + flSize / 2, size: 3.5, color: gold });
  }

  // Header
  const brand = (params.brandingName || "COURSE RANGER").toUpperCase();
  const brandW = fontSerifBold.widthOfTextAtSize(brand, 16);
  page.drawText(brand, { x: (width - brandW) / 2, y: height - 68, size: 16, font: fontSerifBold, color: deepSepia });

  const subBrand = (params.brandingPoweredBy || "Powered by SPIPL").toUpperCase();
  const subBrandW = fontBold.widthOfTextAtSize(subBrand, 7.5);
  page.drawText(subBrand, { x: (width - subBrandW) / 2, y: height - 80, size: 7.5, font: fontBold, color: gold });

  const title = (params.certificateTitle || "CERTIFICATE OF COMPLETION").toUpperCase();
  const titleW = fontSerifBold.widthOfTextAtSize(title, 24);
  page.drawText(title, { x: (width - titleW) / 2, y: height - 114, size: 24, font: fontSerifBold, color: deepSepia });

  page.drawLine({ start: { x: width / 2 - 150, y: height - 126 }, end: { x: width / 2 + 150, y: height - 126 }, color: gold, thickness: 1.5 });

  // Presentation Label
  const presText = "This is proudly presented to";
  const presW = fontItalic.widthOfTextAtSize(presText, 12);
  page.drawText(presText, { x: (width - presW) / 2, y: height - 154, size: 12, font: fontItalic, color: mutedText });

  // Recipient Name
  const sName = params.studentName || "Valued Student";
  const sSize = sName.length > 30 ? 24 : 31;
  const sNameW = fontSerifBold.widthOfTextAtSize(sName, sSize);
  page.drawText(sName, { x: (width - sNameW) / 2, y: height - 196, size: sSize, font: fontSerifBold, color: deepSepia });

  // Course Description
  const desc = "for successfully mastering the curriculum and meeting all criteria for completion of the professional program in";
  const descW = fontRegular.widthOfTextAtSize(desc, 10.5);
  page.drawText(desc, { x: (width - descW) / 2, y: height - 224, size: 10.5, font: fontRegular, color: mutedText });

  const cTitle = params.courseTitle || "Course Title";
  const cSize = cTitle.length > 40 ? 17 : 21;
  const cW = fontSerifBold.widthOfTextAtSize(cTitle, cSize);
  page.drawText(cTitle, { x: (width - cW) / 2, y: height - 256, size: cSize, font: fontSerifBold, color: gold });

  // Grade & Performance Section
  let curY = height - 286;
  if (params.grade && params.grade !== "Completed" && params.score !== null && params.score !== undefined) {
    const gradeStr = `GRADE: ${params.grade}     •     SCORE: ${params.score}%     •     PERFORMANCE: ${(params.performanceDescription || "EXCELLENT").toUpperCase()}`;
    const gW = fontBold.widthOfTextAtSize(gradeStr, 10);
    const boxW = gW + 28;
    page.drawRectangle({ x: (width - boxW) / 2, y: curY - 4, width: boxW, height: 18, color: rgb(0.96, 0.92, 0.85), borderColor: gold, borderWidth: 1 });
    page.drawText(gradeStr, { x: (width - gW) / 2, y: curY + 1, size: 10, font: fontBold, color: deepSepia });
    curY -= 28;
  } else {
    curY -= 12;
  }

  // Dates Row (Horizontally Aligned in One Row with Heraldic Dividers)
  const enrDate = formatDate(params.enrolledAt || params.issuedAt);
  const compDate = formatDate(params.completedAt || params.issuedAt);
  const dateRowText = `Enrollment Date: ${enrDate}       —   *   —       Completion Date: ${compDate}`;
  const dRowW = fontBold.widthOfTextAtSize(dateRowText, 9.5);
  page.drawLine({ start: { x: (width - dRowW) / 2 - 20, y: curY + 13 }, end: { x: (width + dRowW) / 2 + 20, y: curY + 13 }, color: gold, thickness: 0.8 });
  page.drawText(dateRowText, { x: (width - dRowW) / 2, y: curY + 3, size: 9.5, font: fontBold, color: deepSepia });
  page.drawLine({ start: { x: (width - dRowW) / 2 - 20, y: curY - 4 }, end: { x: (width + dRowW) / 2 + 20, y: curY - 4 }, color: gold, thickness: 0.8 });

  // Footer: Left (Issued On), Center (32-point Starburst Seal), Right (Signature)
  const colY = 104;

  page.drawText("ISSUED ON:", { x: 60, y: colY + 14, size: 8, font: fontBold, color: mutedText });
  page.drawText(formatDate(params.issuedAt), { x: 60, y: colY + 1, size: 9.5, font: fontBold, color: deepSepia });
  page.drawText("Heraldic Academic Honor", { x: 60, y: colY - 11, size: 7.5, font: fontRegular, color: mutedText });

  // Center: 32-point Starburst Seal with Ribbon
  const sealX = width / 2;
  const sealY = colY + 4;
  page.drawLine({ start: { x: sealX - 8, y: sealY - 14 }, end: { x: sealX - 16, y: sealY - 36 }, color: deepSepia, thickness: 8 });
  page.drawLine({ start: { x: sealX + 8, y: sealY - 14 }, end: { x: sealX + 16, y: sealY - 36 }, color: gold, thickness: 8 });
  page.drawCircle({ x: sealX, y: sealY, size: 28, color: gold, borderColor: deepSepia, borderWidth: 1.5 });
  page.drawCircle({ x: sealX, y: sealY, size: 22, color: deepSepia });
  const stText = "PRESTIGE";
  const stw = fontBold.widthOfTextAtSize(stText, 6);
  page.drawText(stText, { x: sealX - stw / 2, y: sealY - 2.5, size: 6, font: fontBold, color: rgb(1, 0.9, 0.6) });

  // Right: Signature
  const sigLineX = width - 235;
  page.drawLine({ start: { x: sigLineX, y: colY + 14 }, end: { x: sigLineX + 175, y: colY + 14 }, color: deepSepia, thickness: 1 });
  const sigName = params.instructorName || params.signatoryName || "Prasad Kulkarni";
  const sigW = fontSerifBold.widthOfTextAtSize(sigName, 10.5);
  page.drawText(sigName, { x: sigLineX + (175 - sigW) / 2, y: colY + 1, size: 10.5, font: fontSerifBold, color: deepSepia });
  const sigTitle = params.signatoryTitle || "Lead Instructor & Evaluator";
  const sTitW = fontRegular.widthOfTextAtSize(sigTitle, 8);
  page.drawText(sigTitle, { x: sigLineX + (175 - sTitW) / 2, y: colY - 11, size: 8, font: fontRegular, color: mutedText });

  // Discreet Credential ID
  const credText = `Credential ID: ${params.certificateNo || "CR-01OKK6"}   •   Verify authenticity: courseranger.com/verify/${params.certificateNo || "CR-01OKK6"}   •   Orange Tree LMS`;
  const credW = fontRegular.widthOfTextAtSize(credText, 7.5);
  page.drawText(credText, { x: (width - credW) / 2, y: 32, size: 7.5, font: fontRegular, color: mutedText });
}

// -----------------------------------------------------------------------------
// RENDERER 4: CLASSIC GOLD — ROYAL MINIMAL (CLASSIC_GOLD_V4)
// -----------------------------------------------------------------------------
function renderClassicGoldV4(page, params, fonts) {
  const { width, height } = page.getSize();
  const { fontRegular, fontBold, fontSerifBold } = fonts;

  const bgAlabaster = rgb(0.985, 0.985, 0.98); // #FBFBFA
  const gold = params.accentColor ? hexToRgb(params.accentColor, rgb(0.83, 0.69, 0.22)) : rgb(0.83, 0.69, 0.22); // #D4AF37
  const charcoal = rgb(0.10, 0.10, 0.11); // #18181B
  const mutedText = rgb(0.44, 0.44, 0.48); // #71717A

  // Background
  page.drawRectangle({ x: 0, y: 0, width, height, color: bgAlabaster });

  // Thin 1px gold hairline frame set 32pt inside canvas with wide outer matting
  page.drawRectangle({ x: 32, y: 32, width: width - 64, height: height - 64, borderColor: gold, borderWidth: 1 });

  // Header: Restrained widely-spaced tracking
  const brand = (params.brandingName || "COURSE RANGER").toUpperCase();
  const brandW = fontBold.widthOfTextAtSize(brand, 12);
  page.drawText(brand, { x: (width - brandW) / 2, y: height - 74, size: 12, font: fontBold, color: charcoal });

  const subBrand = (params.brandingPoweredBy || "Powered by SPIPL").toUpperCase();
  const subBrandW = fontRegular.widthOfTextAtSize(subBrand, 7);
  page.drawText(subBrand, { x: (width - subBrandW) / 2, y: height - 85, size: 7, font: fontRegular, color: mutedText });

  const title = (params.certificateTitle || "CERTIFICATE OF COMPLETION").toUpperCase();
  const titleW = fontSerifBold.widthOfTextAtSize(title, 21);
  page.drawText(title, { x: (width - titleW) / 2, y: height - 118, size: 21, font: fontSerifBold, color: charcoal });

  page.drawLine({ start: { x: width / 2 - 30, y: height - 128 }, end: { x: width / 2 + 30, y: height - 128 }, color: gold, thickness: 1 });

  // Presentation Subtitle
  const presText = "THIS IS PROUDLY PRESENTED TO";
  const presW = fontRegular.widthOfTextAtSize(presText, 8.5);
  page.drawText(presText, { x: (width - presW) / 2, y: height - 156, size: 8.5, font: fontRegular, color: mutedText });

  // Recipient Name
  const sName = params.studentName || "Valued Student";
  const sSize = sName.length > 30 ? 25 : 31;
  const sNameW = fontSerifBold.widthOfTextAtSize(sName, sSize);
  page.drawText(sName, { x: (width - sNameW) / 2, y: height - 198, size: sSize, font: fontSerifBold, color: charcoal });

  // Course Description
  const desc = "for successfully mastering the curriculum and meeting all criteria for completion of the professional program in";
  const descW = fontRegular.widthOfTextAtSize(desc, 10);
  page.drawText(desc, { x: (width - descW) / 2, y: height - 226, size: 10, font: fontRegular, color: mutedText });

  const cTitle = params.courseTitle || "Course Title";
  const cSize = cTitle.length > 40 ? 16 : 20;
  const cW = fontSerifBold.widthOfTextAtSize(cTitle, cSize);
  page.drawText(cTitle, { x: (width - cW) / 2, y: height - 256, size: cSize, font: fontSerifBold, color: charcoal });

  // Grade & Performance Section (Floating baseline, no heavy boxes)
  let curY = height - 286;
  if (params.grade && params.grade !== "Completed" && params.score !== null && params.score !== undefined) {
    const gradeStr = `GRADE: ${params.grade}     •     SCORE: ${params.score}%     •     PERFORMANCE: ${(params.performanceDescription || "EXCELLENT").toUpperCase()}`;
    const gW = fontRegular.widthOfTextAtSize(gradeStr, 9);
    page.drawText(gradeStr, { x: (width - gW) / 2, y: curY, size: 9, font: fontRegular, color: charcoal });
    curY -= 26;
  } else {
    curY -= 12;
  }

  // Dates Row (Discreet single horizontal row)
  const enrDate = formatDate(params.enrolledAt || params.issuedAt);
  const compDate = formatDate(params.completedAt || params.issuedAt);
  const dateRowText = `Enrolled: ${enrDate}       —       Completed: ${compDate}`;
  const dRowW = fontRegular.widthOfTextAtSize(dateRowText, 8.5);
  page.drawText(dateRowText, { x: (width - dRowW) / 2, y: curY + 2, size: 8.5, font: fontRegular, color: mutedText });

  // Footer: Left (Issued On), Center (Minimal Gold Seal), Right (Signature)
  const colY = 104;

  page.drawText("ISSUED ON:", { x: 65, y: colY + 14, size: 7.5, font: fontBold, color: mutedText });
  page.drawText(formatDate(params.issuedAt), { x: 65, y: colY + 1, size: 9, font: fontRegular, color: charcoal });
  page.drawText("Verified Academic Record", { x: 65, y: colY - 11, size: 7, font: fontRegular, color: mutedText });

  // Center: Delicate Gold Ring Seal
  const sealX = width / 2;
  const sealY = colY + 4;
  page.drawCircle({ x: sealX, y: sealY, size: 24, color: bgAlabaster, borderColor: gold, borderWidth: 1 });
  page.drawCircle({ x: sealX, y: sealY, size: 19, borderColor: rgb(0.9, 0.88, 0.85), borderWidth: 0.5 });
  const sealText = "SEAL";
  const stw = fontRegular.widthOfTextAtSize(sealText, 6);
  page.drawText(sealText, { x: sealX - stw / 2, y: sealY - 2, size: 6, font: fontRegular, color: gold });

  // Right: Signature
  const sigLineX = width - 235;
  page.drawLine({ start: { x: sigLineX, y: colY + 14 }, end: { x: sigLineX + 170, y: colY + 14 }, color: gold, thickness: 1 });
  const sigName = params.instructorName || params.signatoryName || "Prasad Kulkarni";
  const sigW = fontSerifBold.widthOfTextAtSize(sigName, 10);
  page.drawText(sigName, { x: sigLineX + (170 - sigW) / 2, y: colY + 1, size: 10, font: fontSerifBold, color: charcoal });
  const sigTitle = params.signatoryTitle || "Lead Instructor & Evaluator";
  const sTitW = fontRegular.widthOfTextAtSize(sigTitle, 7.5);
  page.drawText(sigTitle, { x: sigLineX + (170 - sTitW) / 2, y: colY - 11, size: 7.5, font: fontRegular, color: mutedText });

  // Discreet Credential ID
  const credText = `Credential ID: ${params.certificateNo || "CR-01OKK6"}   •   courseranger.com/verify/${params.certificateNo || "CR-01OKK6"}`;
  const credW = fontRegular.widthOfTextAtSize(credText, 7.5);
  page.drawText(credText, { x: (width - credW) / 2, y: 44, size: 7.5, font: fontRegular, color: mutedText });
}

// -----------------------------------------------------------------------------
// LEGACY RENDERER: MODERN MINIMAL
// -----------------------------------------------------------------------------
function renderModernMinimal(page, params, fonts) {
  renderClassicGoldV2(page, params, fonts);
}

// -----------------------------------------------------------------------------
// LEGACY RENDERER: PREMIUM DARK
// -----------------------------------------------------------------------------
function renderPremiumDark(page, params, fonts) {
  renderClassicGoldV3(page, params, fonts);
}

// -----------------------------------------------------------------------------
// LEGACY RENDERER: TECH GRADIENT
// -----------------------------------------------------------------------------
function renderTechGradient(page, params, fonts) {
  renderClassicGoldV2(page, params, fonts);
}

/**
 * Main certificate PDF generation entry point.
 */
async function generateCertificatePdf(params = {}) {
  const pdfDoc = await PDFDocument.create();

  // Standard A4 Landscape: 842 x 595 points
  const width = 842;
  const height = 595;
  const page = pdfDoc.addPage([width, height]);

  // Embed standard system fonts
  const fontRegular = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const fontItalic = await pdfDoc.embedFont(StandardFonts.HelveticaOblique);
  const fontSerifBold = await pdfDoc.embedFont(StandardFonts.TimesRomanBold);
  const fontCourier = await pdfDoc.embedFont(StandardFonts.Courier);
  const fontCourierBold = await pdfDoc.embedFont(StandardFonts.CourierBold);

  const fonts = {
    fontRegular,
    fontBold,
    fontItalic,
    fontSerifBold,
    fontCourier,
    fontCourierBold,
  };

  const templateId = normalizeTemplateId(params.templateId);

  switch (templateId) {
    case TEMPLATE_IDS.CLASSIC_GOLD_V2:
      renderClassicGoldV2(page, params, fonts);
      break;
    case TEMPLATE_IDS.CLASSIC_GOLD_V3:
      renderClassicGoldV3(page, params, fonts);
      break;
    case TEMPLATE_IDS.CLASSIC_GOLD_V4:
      renderClassicGoldV4(page, params, fonts);
      break;
    case "MODERN_MINIMAL":
      renderModernMinimal(page, params, fonts);
      break;
    case "PREMIUM_DARK":
      renderPremiumDark(page, params, fonts);
      break;
    case "TECH_GRADIENT":
      renderTechGradient(page, params, fonts);
      break;
    case TEMPLATE_IDS.CLASSIC_GOLD_V1:
    default:
      renderClassicGoldV1(page, params, fonts);
      break;
  }

  return await pdfDoc.save();
}

module.exports = {
  generateCertificatePdf,
  generateCertificateFilename,
  normalizeTemplateId,
  formatDate,
  wrapText,
  hexToRgb,
  TEMPLATE_IDS,
};
