
const express = require('express');
const app = express();
app.get('/', (req, res) => res.send('Hello from my web app on port 3000!'));
app.get('/test', (req, res) => res.send('Hello from my web app on port 3000/test!'));
app.listen(3000, () => console.log('Web app running on port 3000'));