const fs = require("fs");
const path = require("path");
const { Readable } = require("stream");
const ExcelJS = require("exceljs");
const csv = require("csv-parser");

const FORBIDDEN_HEADER_KEYS = new Set(["__proto__", "constructor", "prototype"]);
const MAX_SPREADSHEET_ROWS = 10000;
const MAX_SPREADSHEET_COLUMNS = 100;

/**
 * Normalizes any ExcelJS cell value (richText, formula result, hyperlink,
 * Date, primitive, null) into a clean JS primitive, defaulting empty cells to "".
 */
function unwrapExcelCellValue(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? "" : value.toISOString();
  }
  if (typeof value === "object") {
    if (Array.isArray(value.richText)) {
      return value.richText.map((part) => (part && part.text ? String(part.text) : "")).join("");
    }
    if ("result" in value) {
      if (value.result && typeof value.result === "object" && "error" in value.result) {
        return "";
      }
      return unwrapExcelCellValue(value.result);
    }
    if ("text" in value && value.text !== undefined) {
      return unwrapExcelCellValue(value.text);
    }
    if ("hyperlink" in value && typeof value.hyperlink === "string") {
      return value.hyperlink;
    }
  }
  return String(value);
}

function sanitizeHeaderKey(rawHeader) {
  const cleaned = String(rawHeader ?? "")
    .replace(/^\uFEFF/, "")
    .trim();
  if (!cleaned || FORBIDDEN_HEADER_KEYS.has(cleaned)) return null;
  return cleaned;
}

/**
 * Extracts row objects from an ExcelJS Workbook's first worksheet, matching
 * `sheet_to_json(ws, { defval: "" })` semantics while preventing prototype
 * pollution and bounding row/column counts.
 */
function extractWorksheetRows(workbook) {
  const worksheet = workbook.worksheets && workbook.worksheets[0];
  if (!worksheet || worksheet.rowCount === 0) return [];

  if (worksheet.rowCount > MAX_SPREADSHEET_ROWS + 1) {
    const err = new Error(`Spreadsheet exceeds the maximum of ${MAX_SPREADSHEET_ROWS} rows.`);
    err.statusCode = 400;
    throw err;
  }

  let headerRowNumber = null;
  const columns = []; // Array<{ colNumber: number, key: string }>

  worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (headerRowNumber !== null) return;
    const maxCol = Math.min(row.cellCount, MAX_SPREADSHEET_COLUMNS);
    const detected = [];
    for (let col = 1; col <= maxCol; col++) {
      const val = unwrapExcelCellValue(row.getCell(col).value);
      const key = sanitizeHeaderKey(val);
      if (key) {
        detected.push({ colNumber: col, key });
      }
    }
    if (detected.length > 0) {
      headerRowNumber = rowNumber;
      columns.push(...detected);
    }
  });

  if (headerRowNumber === null || columns.length === 0) {
    return [];
  }

  const rows = [];
  worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber <= headerRowNumber) return;

    const record = {};
    let hasNonEmptyValue = false;

    for (const { colNumber, key } of columns) {
      const cellVal = unwrapExcelCellValue(row.getCell(colNumber).value);
      const normalized = typeof cellVal === "string" ? cellVal : cellVal;
      if (normalized !== "" && String(normalized).trim() !== "") {
        hasNonEmptyValue = true;
      }
      record[key] = normalized;
    }

    if (hasNonEmptyValue) {
      rows.push(record);
    }
  });

  return rows;
}

function assertSupportedExcelExtension(filenameOrPath) {
  const ext = path.extname(String(filenameOrPath || "")).toLowerCase();
  if (ext === ".xls" || ext === ".ods") {
    const err = new Error(
      `Legacy ${ext} spreadsheets are not supported. Please save the file as .xlsx or .csv and upload again.`
    );
    err.statusCode = 400;
    throw err;
  }
}

async function parseXlsxBuffer(buffer, filename = "upload.xlsx") {
  assertSupportedExcelExtension(filename);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  return extractWorksheetRows(workbook);
}

async function parseXlsxFile(filePath) {
  assertSupportedExcelExtension(filePath);
  const buffer = await fs.promises.readFile(filePath);
  return parseXlsxBuffer(buffer, filePath);
}

function parseDelimitedBuffer(buffer, separator = ",") {
  return new Promise((resolve, reject) => {
    const rows = [];
    // Strip UTF-8 BOM if present at start of buffer
    let content = buffer.toString("utf-8");
    if (content.charCodeAt(0) === 0xfeff) {
      content = content.slice(1);
    }

    Readable.from([content])
      .pipe(
        csv({
          separator,
          mapHeaders: ({ header }) => sanitizeHeaderKey(header),
        })
      )
      .on("data", (rawRow) => {
        if (rows.length >= MAX_SPREADSHEET_ROWS) {
          reject(new Error(`CSV exceeds the maximum of ${MAX_SPREADSHEET_ROWS} rows.`));
          return;
        }
        const cleanRow = {};
        let hasValue = false;
        for (const [k, v] of Object.entries(rawRow || {})) {
          if (!k || k === "null" || FORBIDDEN_HEADER_KEYS.has(k)) continue;
          const strVal = v === undefined || v === null ? "" : String(v);
          if (strVal.trim() !== "") hasValue = true;
          cleanRow[k] = strVal;
        }
        if (hasValue) rows.push(cleanRow);
      })
      .on("end", () => resolve(rows))
      .on("error", reject);
  });
}

module.exports = {
  unwrapExcelCellValue,
  parseXlsxBuffer,
  parseXlsxFile,
  parseDelimitedBuffer,
};
