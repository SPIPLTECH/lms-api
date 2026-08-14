const llmGateway = require("./llm.service");

const generate = async (req, res, next) => {
  try {
    const { systemPrompt, prompt, context, think } = req.body;

    const result = await llmGateway.generate({ systemPrompt, prompt, context, think });

    res.json({
      success: true,
      data: result,
    });
  } catch (error) {
    next(error);
  }
};

module.exports = { generate };
