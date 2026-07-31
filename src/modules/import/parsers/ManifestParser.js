class ManifestParser {
  static parse(jsonBuffer) {
    let data;
    try {
      data = JSON.parse(jsonBuffer.toString("utf-8"));
    } catch (err) {
      throw new Error("Invalid course.json format: Unable to parse JSON.");
    }

    if (!data.title || typeof data.title !== "string" || !data.title.trim()) {
      throw new Error("Invalid course.json: 'title' field is required.");
    }

    return {
      title: data.title.trim(),
      description: data.description || "",
      category: data.category || "General",
      level: data.level || "BEGINNER",
      thumbnail: data.thumbnail || null,
      price: typeof data.price === "number" ? data.price : 0,
      modules: Array.isArray(data.modules) ? data.modules : [],
    };
  }
}

module.exports = ManifestParser;
