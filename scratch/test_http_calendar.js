const axios = require("axios");

async function testHttp() {
  try {
    console.log("Requesting GET http://localhost:5000/calendar ...");
    const response = await axios.get("http://localhost:5000/calendar");
    console.log("Response status:", response.status);
    console.log("Response data:", response.data);
  } catch (error) {
    console.error("HTTP request failed:");
    if (error.response) {
      console.error("Status:", error.response.status);
      console.error("Headers:", error.response.headers);
      console.error("Body:", error.response.data);
    } else {
      console.error(error.message);
    }
  }
}

testHttp();
