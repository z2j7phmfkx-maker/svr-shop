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
  res.sendFile(path.join(__dirname, 'public/index.html'));
});

app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public/admin.html'));
});

app.get('/data.json', (req, res) => {
  try {
    const data = fs.readFileSync(DATA_FILE, 'utf-8');
    res.json(JSON.parse(data));
  } catch (e) {
    res.json({ concours: {}, products: [] });
  }
});

// SAVE DATA + COMMIT TO GITHUB
app.post('/api/save-data', async (req, res) => {
  try {
    const shopData = req.body;
    
    // 1. Save to local data.json
    fs.writeFileSync(DATA_FILE, JSON.stringify(shopData, null, 2));
    
    // 2. Commit to GitHub
    if (GITHUB_TOKEN) {
      await commitToGitHub(shopData);
    }
    
    res.status(200).json({ success: true, message: 'Données sauvegardées ✅' });
  } catch (error) {
    console.error('Erreur:', error);
    res.status(500).json({ success: false, message: 'Erreur sauvegarde ❌', error: error.message });
  }
});

// GitHub Commit Function
async function commitToGitHub(shopData) {
  const content = Buffer.from(JSON.stringify(shopData, null, 2)).toString('base64');
  const timestamp = new Date().toLocaleString('fr-FR');
  const commitMessage = `🛍️ Update data.json - ${timestamp}`;
  
  try {
    // Get current file
