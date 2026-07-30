const axios = require('axios');
const token = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6ImNtczU4Y2I5bzAwMDB0cHRrZHE1Y2lxdmkiLCJlbWFpbCI6Imd1bnZhbnRyYW8yMDE3QGdtYWlsLmNvbSIsInJvbGUiOiJJTlNUUlVDVE9SIiwiaWF0IjoxNzg1NDI5MjQ1LCJleHAiOjE3ODU0MzI4NDV9.-a9aotKjEFE-lO2kHfSOHCUOmhZwnb-NJUik7UxMKwg';
axios.get('http://localhost:5000/courses', {
  headers: { Authorization: `Bearer ${token}` }
}).then(res => {
  console.log(JSON.stringify(res.data, null, 2));
}).catch(err => {
  console.error(err.response?.data || err.message);
});
