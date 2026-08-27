const ApiError = require("../../../utils/ApiError");
const {
  getMyDashboardSummaryTool,
  getMyLearnerStateTool,
  getMyQuizResultTool,
} = require("./student.tools");
const {
  getMyInstructorAnalyticsTool,
  getCourseResultsAnalyticsTool,
  getCourseStudentsTool,
} = require("./instructor.tools");
const {
  getPlatformOverviewTool,
  getPlatformUsersSummaryTool,
  getPlatformCourseSummaryTool,
} = require("./admin.tools");

class ToolRegistry {
  constructor() {
    this.tools = new Map();
    // Student Tools
    this.registerTool(getMyDashboardSummaryTool);
    this.registerTool(getMyLearnerStateTool);
    this.registerTool(getMyQuizResultTool);

    // Instructor Tools
    this.registerTool(getMyInstructorAnalyticsTool);
    this.registerTool(getCourseResultsAnalyticsTool);
    this.registerTool(getCourseStudentsTool);

    // Admin Tools
    this.registerTool(getPlatformOverviewTool);
    this.registerTool(getPlatformUsersSummaryTool);
    this.registerTool(getPlatformCourseSummaryTool);
  }

  registerTool(tool) {
    if (!tool.name || !tool.allowedRoles || typeof tool.execute !== "function") {
      throw new Error(`Invalid tool definition: ${tool?.name || "unnamed"}`);
    }
    this.tools.set(tool.name, tool);
  }

  getTool(name) {
    return this.tools.get(name) || null;
  }

  getToolsForRole(role) {
    const list = [];
    for (const tool of this.tools.values()) {
      if (tool.allowedRoles.includes(role)) {
        list.push({
          name: tool.name,
          allowedRoles: tool.allowedRoles,
          inputSchema: tool.inputSchema,
        });
      }
    }
    return list;
  }

  async executeTool(name, reqUser, params = {}) {
    const tool = this.getTool(name);
    if (!tool) {
      throw new ApiError(404, `Tool '${name}' not found`);
    }

    if (!reqUser || !reqUser.role || !tool.allowedRoles.includes(reqUser.role)) {
      throw new ApiError(403, `Access denied: Role '${reqUser?.role}' cannot execute tool '${name}'`);
    }

    if (typeof tool.authorize === "function") {
      await tool.authorize(reqUser, params);
    }

    return await tool.execute(reqUser, params);
  }
}

module.exports = new ToolRegistry();
