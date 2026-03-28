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

// Bot config
const BOT_TOKEN = '8774455983:AAHkE3OlVnrfaZ6-ni3W4d4vL1YLUdtpufs';
const CHANNEL_ID = -100298886801;

// TEST MODE
const TEST_MODE = true;

console.log('🔐 GitHub Token:', GITHUB_TOKEN ? '✅ Configuré' : '❌ Manquant');
console.log('🧪 TEST MODE:', TEST_MODE ? '✅ ON' : '❌ OFF');

// ===== TOKEN MANAGEMENT =====
let userTokens = {
  '8536904445': {
    token: 'svr_shop_test_token_v1',
    createdAt: new Date(),
    userId: 8536904445
  }
};

function generateToken() {
  return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
}

async function isChannelMember(userId) {
  // En mode test, accepte ton ID
  if (TEST_MODE && userId === 8536904445) {
    console.log(`✅ TEST MODE: User ${userId} accepté`);
    return true;
  }

  try {
    const response = await axios.get(
      `https://api.telegram.org/bot${BOT_TOKEN}/getChatMember`,
      { params: { chat_id: CHANNEL_ID, user_id: userId } }
    );
    const status = response.data.result.status;
    return ['member', 'administrator', 'creator'].includes(status);
  } catch (error) {
    console.error('Error checking member:', error.message);
    return false;
  }
}

// ===== ROUTES =====
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
    res.json({ concours: { description: '' }, products: [] });
  }
});

// ===== TOKEN VERIFICATION =====
app.get('/api/verify-token', async (req, res) => {
  const token = req.query.token;

  if (!token) {
    return res.json({ valid: false, message: 'Token manquant' });
  }

  // Check if token exists
  let userId = null;
  for (const [id, data] of Object.entries(userTokens)) {
    if (data.token === token) {
      userId = id;
      break;
    }
  }

  if (!userId) {
    return res.json({ valid: false, message: 'Token invalide' });
  }

  // Verify user is still in channel
  const isMember = await isChannelMember(parseInt(userId));
  
  if (!isMember) {
    delete userTokens[userId];
    return res.json({ valid: false, message: 'Vous n\'êtes plus membre du channel' });
  }

  res.json({ valid: true, userId: userId, message: 'Accès autorisé' });
});

// ===== GENERATE TOKEN (for bot) =====
app.post('/api/generate-token', async (req, res) => {
  const userId = req.body.userId;

  if (!userId) {
    return res.json({ success: false, message: 'User ID manquant' });
  }

  // Verify user is in channel
  const isMember = await isChannelMember(userId);
  if (!isMember) {
    return res.json({ success: false, message: 'Utilisateur pas dans le channel' });
  }

  // Generate token
  if (!userTokens[userId]) {
    userTokens[userId] = {
      token: generateToken(),
      createdAt: new Date(),
      userId: userId
    };
  }

  res.json({ 
    success: true, 
    token: userTokens[userId].token,
    message: 'Token généré'
  });
});

// ===== TEST ENDPOINT =====
app.post('/api/test-generate-token', (req, res) => {
  if (!TEST_MODE) {
    return res.json({ success: false, message: 'Test mode disabled' });
  }

  const userId = 8536904445;
  const token = userTokens[userId].token;
  const link = `https://svr-shop.onrender.com?token=${token}`;

  res.json({ 
    success: true, 
    userId: userId,
    token: token,
    link: link,
    message: 'Token généré pour test'
  });
});

// ===== SAVE DATA =====
app.post('/api/save-data', async (req, res) => {
  try {
    const shopData = req.body;
    
    // Save locally
    fs.writeFileSync(DATA_FILE, JSON.stringify(shopData, null, 2));
    console.log('✅ Local save OK');
    
    // Commit to GitHub (async)
    if (GITHUB_TOKEN) {
      commitToGithub(shopData).catch(err => {
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

// ===== GITHUB COMMIT =====
async function commitToGithub(shopData) {
  try {
    const content = Buffer.from(JSON.stringify(shopData, null, 2)).toString('base64');
    const timestamp = new Date().toLocaleString('fr-FR');
    const commitMessage = `🛍️ Update data.json - ${timestamp}`;
    
    console.log('📤 Fetching file SHA...');
    
    const getShaRes = await axios.get(
      `https://api.github.com/repos/${GITHUB_REPO}/contents/data.json?ref=${GITHUB_BRANCH}`,
      { headers: { Authorization: `token ${GITHUB_TOKEN}` } }
    );
    
    const sha = getShaRes.data.sha;
    console.log('✅ SHA fetched:', sha.substring(0, 10) + '...');
    
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
  console.log(`🧪 TEST TOKEN: svr_shop_test_token_v1`);
  console.log(`🔗 TEST LINK: https://svr-shop.onrender.com?token=svr_shop_test_token_v1`);
});
