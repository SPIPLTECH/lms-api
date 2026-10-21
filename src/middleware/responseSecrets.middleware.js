const { stripSecrets } = require("../utils/responseSecrets");

/**
 * Removes authentication secrets (password hashes, reset codes, credential
 * hashes) from every JSON response, for every role. See
 * utils/responseSecrets.js.
 */
const stripResponseSecrets = (req, res, next) => {
  const json = res.json.bind(res);
  res.json = (body) => json(stripSecrets(body));
  next();
};

module.exports = stripResponseSecrets;
