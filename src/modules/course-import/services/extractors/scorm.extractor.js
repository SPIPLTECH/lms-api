const fs = require("fs");
const path = require("path");
const xml2js = require("xml2js");
const htmlExtractor = require("./html.extractor");
const { buildServedUrl } = require("../assetResolver.service");

/**
 * Best-effort SCORM support (per spec: "SCORM packages if feasible"): reads
 * imsmanifest.xml's organization/item tree + resource hrefs and feeds any
 * HTML resource through the same HTML extractor used elsewhere. No xAPI/
 * runtime tracking — a real but honestly partial adapter, not a full SCORM
 * player.
 */
const detectManifest = (files) => files.find((f) => f.fileName.toLowerCase() === "imsmanifest.xml") || null;

const flatten = (value) => (Array.isArray(value) ? value : value ? [value] : []);

const parseOrganizationItems = (org) =>
  flatten(org.item).map((item) => ({
    title: (item.title && item.title[0]) || "Untitled",
    identifierref: item.$?.identifierref,
    children: flatten(item.item).map((child) => ({
      title: (child.title && child.title[0]) || "Untitled",
      identifierref: child.$?.identifierref,
    })),
  }));

const buildStructureFromManifest = async (manifestFile, files, ctx) => {
  const xml = fs.readFileSync(manifestFile.absolutePath, "utf8");
  const parsed = await xml2js.parseStringPromise(xml);
  const manifest = parsed.manifest;

  const resourceList = manifest.resources?.[0]?.resource || [];
  const resourceMap = new Map(resourceList.map((r) => [r.$.identifier, r.$.href]));

  const org = manifest.organizations?.[0]?.organization?.[0];
  const topItems = org ? parseOrganizationItems(org) : [];

  const manifestDir = path.posix.dirname(manifestFile.relativePath.replace(/\\/g, "/"));

  const buildLessonFromHref = async (href, title) => {
    if (!href) {
      return { title, sourcePath: null, content: [{ kind: "unknown", status: "UNMAPPED", original: { element: "scorm-item", content: title, reason: "no linked resource" } }] };
    }

    const resolvedPath = path.posix.normalize(path.posix.join(manifestDir, href));
    const matchedFile = files.find((f) => f.relativePath === resolvedPath);

    if (!matchedFile) {
      return { title, sourcePath: resolvedPath, content: [{ kind: "unknown", status: "UNMAPPED", original: { element: "scorm-item", content: title, sourcePath: resolvedPath, reason: "resource file missing" } }] };
    }

    if (matchedFile.extension === ".html" || matchedFile.extension === ".htm") {
      const content = await htmlExtractor.extractFromFile(matchedFile, { jobId: ctx.jobId, baseUrl: ctx.baseUrl, sourceRelativePath: matchedFile.relativePath });
      return { title, sourcePath: matchedFile.relativePath, content };
    }

    return {
      title,
      sourcePath: matchedFile.relativePath,
      content: [{ kind: "document", source: "local", url: buildServedUrl(ctx, matchedFile.relativePath), originalPath: matchedFile.relativePath, title, attributes: {} }],
    };
  };

  const modules = [];
  for (const item of topItems) {
    const lessons = [];

    if (item.children.length) {
      for (const child of item.children) {
        lessons.push(await buildLessonFromHref(resourceMap.get(child.identifierref), child.title));
      }
    } else {
      lessons.push(await buildLessonFromHref(resourceMap.get(item.identifierref), item.title));
    }

    modules.push({ title: item.title, sourcePath: manifestDir, lessons });
  }

  const courseTitle = manifest.metadata?.[0]?.lom?.[0]?.general?.[0]?.title?.[0]?.string?.[0]?._;

  return { modules, courseTitle: typeof courseTitle === "string" ? courseTitle : undefined };
};

module.exports = { detectManifest, buildStructureFromManifest };
