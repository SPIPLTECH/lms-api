require("dotenv").config();

const app = require("./src/app");

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
const cors = require("cors");

app.use(
  cors({
    origin: [
      "http://localhost:3000",
    
    ],
    credentials: true,
  })
);