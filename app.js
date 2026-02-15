
const express = require('express');
const bodyParser = require('body-parser');
const deviceRoutes = require('./routes/devices');

const app = express();
const PORT = 3000;

app.use(bodyParser.json());
app.use('/devices', deviceRoutes);

app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});