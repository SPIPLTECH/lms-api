const jwt = require("jsonwebtoken");
require('dotenv').config({ path: 'c:/SP Nagpur/Backend/lms-api/.env' });

const token = jwt.sign(
  { id: 'cms58cb9o0000tptkdq5ciqvi', email: 'gunvantrao2017@gmail.com', role: 'INSTRUCTOR' },
  process.env.JWT_ACCESS_SECRET || process.env.JWT_SECRET || 'secret',
  { expiresIn: '1h' }
);
console.log(token);
