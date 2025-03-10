
const express = require('express');
const app = express();
app.get('/', (req, res) => res.json({message: "hello from localhost3000"}))
app.listen(3000, () => console.log('Web app running on port 3000'));