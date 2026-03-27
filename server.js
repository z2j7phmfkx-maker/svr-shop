const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(express.json());
app.use(express.static('public'));

const DATA_FILE = path.join(__dirname, 'data.json');

// Routes
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

app.get('/data.json', (req, res) => {
    try {
        const data = fs.readFileSync(DATA_FILE, 'utf8');
        res.json(JSON.parse(data));
    } catch (e) {
        res.json({ concours: {}, products: [] });
    }
});

// SAVE DATA
app.post('/api/save-data', (req, res) => {
    try {
        const shopData = req.body;
        fs.writeFileSync(DATA_FILE, JSON.stringify(shopData, null, 2));
        res.json({ success: true, message: 'Données sauvegardées!' });
    } catch (error) {
        console.error('❌ Save error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
});
