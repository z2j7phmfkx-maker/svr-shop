const express = require('express');
const fs = require('fs');
const path = require('path');
const axios = require('axios');

const app = express();
app.use(express.json());
app.use(express.static('public'));

const DATA_FILE = path.join(__dirname, 'data.json');
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_REPO = 'z2j7phmfkx-maker/svr-shop';
const GITHUB_BRANCH = 'main';

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

// SAVE DATA WITH GITHUB COMMIT
app.post('/api/save-data', async (req, res) => {
    try {
        const shopData = req.body;
        
        // 1. Sauvegarde local
        fs.writeFileSync(DATA_FILE, JSON.stringify(shopData, null, 2));
        
        // 2. Envoie sur GitHub
        await commitToGitHub(shopData);
        
        res.json({ success: true, message: 'Données sauvegardées sur GitHub!' });
    } catch (error) {
        console.error('❌ Save error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// GITHUB COMMIT FUNCTION
async function commitToGitHub(data) {
    try {
        if (!GITHUB_TOKEN) {
            throw new Error('GITHUB_TOKEN not set in environment');
        }

        const content = Buffer.from(JSON.stringify(data, null, 2)).toString('base64');
        const timestamp = new Date().toLocaleString('fr-FR');
        
        // 1. Récupère le SHA du fichier actuel
        const getFileResponse = await axios.get(
            `https://api.github.com/repos/${GITHUB_REPO}/contents/data.json?ref=${GITHUB_BRANCH}`,
            {
                headers: {
                    'Authorization': `token ${GITHUB_TOKEN}`,
                    'Accept': 'application/vnd.github.v3+json'
                }
            }
        );
        
        const sha = getFileResponse.data.sha;
        
        // 2
