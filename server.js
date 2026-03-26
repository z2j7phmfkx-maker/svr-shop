const express = require('express');
const path = require('path');
const fs = require('fs');
const app = express();

app.use(express.static(path.join(__dirname)));
app.use(express.json());

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, 'admin.html'));
});

app.get('/data.json', (req, res) => {
    res.sendFile(path.join(__dirname, 'data.json'));
});

app.post('/api/save-data', (req, res) => {
    try {
        fs.writeFileSync(
            path.join(__dirname, 'data.json'),
            JSON.stringify(req.body, null, 2)
        );
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
