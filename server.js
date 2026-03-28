const express = require('express');
const fs = require('fs');
const path = require('path');
const axios = require('axios');

const app = express();
app.use(express.json());
app.use(express.static('public'));

const DATA_FILE = path.join(__dirname, 'data.json');
const GITHUB_REPO = 'z2j7phmfkx-maker/svr-shop';
const GITHUB_BRANCH = 'main';
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;

// Telegram config
const BOT_TOKEN = '8774455983:AAHkE3OlVnrfaZ6-ni3W4d4vL1YLUdtpufs';
const CHANNEL_ID = -1002988868011;

// In-memory token storage
let userTokens = {};

// Load data.json
function loadData() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      return JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
    }
  } catch (err) {
    console.error('Erreur lecture data.json:', err);
  }
  return { concours: { description: '' }, products: [] };
}

// Save data.json
function saveData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

// Generate random token
function generateToken() {
  return 'svr_' + Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
}

// Check channel membership via Telegram API
async function isChannelMember(userId) {
  try {
    const response = await axios.get(`https://api.telegram.org/bot${BOT_TOKEN}/getChatMember`, {
      params: {
        chat_id: CHANNEL_ID,
        user_id: userId
      }
    });
    
    if (response.data.ok) {
      const status = response.data.result.status;
      return ['member', 'administrator', 'creator', 'restricted'].includes(status);
    }
    return false;
  } catch (error) {
    console.error('Erreur vérif channel:', error.message);
    return false;
  }
}

// Routes
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

app.get('/data.json', (req, res) => {
  const data = loadData();
  res.json(data);
});

// Verify token
app.get('/api/verify-token', async (req, res) => {
  const { token, userId } = req.query;

  if (!token || !userId) {
    return res.json({ valid: false });
  }

  // Vérifier que le token existe
  if (!userTokens[token]) {
    return res.json({ valid: false });
  }

  // Vérifier que le token appartient à cet utilisateur
  const tokenOwnerId = userTokens[token];
  if (tokenOwnerId !== parseInt(userId)) {
    return res.json({ valid: false });
  }

  // Vérifier que l'utilisateur est toujours dans le channel
  const isMember = await isChannelMember(userId);
  if (!isMember) {
    return res.json({ valid: false });
  }

  return res.json({ valid: true });
});

// Generate token (appelé par le bot)
app.post('/api/generate-token', async (req, res) => {
  const { userId } = req.body;

  if (!userId) {
    return res.json({ success: false, message: 'userId manquant' });
  }

  // Vérifier que l'utilisateur est dans le channel
  const isMember = await isChannelMember(userId);
  if (!isMember) {
    return res.json({ success: false, message: 'Utilisateur pas dans le channel' });
  }

  // Vérifier si l'utilisateur a déjà un token
  let token = Object.keys(userTokens).find(t => userTokens[t] === userId);

  // Sinon, générer un nouveau
  if (!token) {
    token = generateToken();
    userTokens[token] = userId;
    console.log(`✅ Token généré pour userId ${userId}: ${token}`);
  } else {
    console.log(`♻️ Token réutilisé pour userId ${userId}: ${token}`);
  }

  return res.json({ success: true, token: token });
});

// Save shop data
app.post('/api/save-data', async (req, res) => {
  try {
    const shopData = req.body;
    saveData(shopData);
    console.log('✅ data.json sauvegardé');

    // Commit to GitHub
    if (GITHUB_TOKEN) {
      await commitToGithub(shopData);
    }

    res.json({ success: true, message: 'Données sauvegardées' });
  } catch (error) {
    console.error('Erreur save:', error.message);
    res.json({ success: false, error: error.message });
  }
});

// Commit to GitHub
async function commitToGithub(data) {
  try {
    const fileContent = Buffer.from(JSON.stringify(data, null, 2)).toString('base64');
    const timestamp = new Date().toISOString();

    // Récupérer le SHA du fichier actuel
    const getShaUrl = `https://api.github.com/repos/${GITHUB_REPO}/contents/data.json?ref=${GITHUB_BRANCH}`;
    const shaResponse = await axios.get(getShaUrl, {
      headers: { Authorization: `token ${GITHUB_TOKEN}` }
    });

    const sha = shaResponse.data.sha;

    // Mettre à jour le fichier
    const updateUrl = `https://api.github.com/repos/${GITHUB_REPO}/contents/data.json`;
    await axios.put(updateUrl, {
      message: `Update data.json - ${timestamp}`,
      content: fileContent,
      sha: sha,
      branch: GITHUB_BRANCH
    }, {
      headers: { Authorization: `token ${GITHUB_TOKEN}` }
    });

    console.log('✅ GitHub commit réussi');
  } catch (error) {
    console.error('❌ Erreur GitHub commit:', error.message);
  }
}

// Server start
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
  console.log(`🤖 BOT_TOKEN configuré`);
  console.log(`📢 CHANNEL_ID: ${CHANNEL_ID}`);
  console.log(`🔐 Token storage actif`);
});
