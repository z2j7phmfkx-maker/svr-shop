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

console.log('🔐 GitHub Token:', GITHUB_TOKEN ? '✅ Configuré' : '❌ Manquant');

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
    
    // 1. Save locally
    fs.writeFileSync(DATA_FILE, JSON.stringify(shopData, null, 2));
    console.log('✅ Local save OK');
    
    // 2. Commit to GitHub (async, don't wait)
    if (GITHUB_TOKEN) {
      commitToGitHub(shopData).catch(err => {
        console.error('❌ GitHub commit failed:', err.message);
      });
    }
    
    res.status(200).json({ 
      success: true, 
      message: 'Données sauvegardées ✅' 
    });
  } catch (error) {
    console.error('❌ Save error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Erreur sauvegarde ❌',
      error: error.message 
    });
  }
});

// GitHub Commit Function
async function commitToGitHub(shopData) {
  try {
    const content = Buffer.from(JSON.stringify(shopData, null, 2)).toString('base64');
    const timestamp = new Date().toLocaleString('fr-FR');
    const commitMessage = `🛍️ Update data.json - ${timestamp}`;
    
    console.log('📤 Fetching file SHA...');
    
    // Get SHA
    const getShaRes = await axios.get(
      `https://api.github.com/repos/${GITHUB_REPO}/contents/data.json?ref=${GITHUB_BRANCH}`,
      { headers: { Authorization: `token ${GITHUB_TOKEN}` } }
    );
    
    const sha = getShaRes.data.sha;
    console.log('✅ SHA fetched:', sha.substring(0, 10) + '...');
    
    // Update file
    const updateRes = await axios.put(
      `https://api.github.com/repos/${GITHUB_REPO}/contents/data.json`,
      {
        message: commitMessage,
        content: content,
        sha: sha,
        branch: GITHUB_BRANCH
      },
      { headers: { Authorization: `token ${GITHUB_TOKEN}` } }
    );
    
    console.log('✅ GitHub commit success!', commitMessage);
  } catch (error) {
    console.error('❌ GitHub error:', error.response?.data?.message || error.message);
    throw error;
  }
}

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📍 https://svr-shop.onrender.com`);
});
