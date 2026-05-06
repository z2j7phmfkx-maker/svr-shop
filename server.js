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

// Import notification service
const notifications = require('./notificationService');

// Load data.json
function loadData() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      return JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
    }
  } catch (err) {
    console.error('Erreur lecture data.json:', err);
  }
  return { 
    concours: { description: '' }, 
    shop_settings: {
      opening_time: '10:00',
      closing_time: '22:00',
      closed_days: ['dimanche'],
      timezone: 'Europe/Paris'
    },
    telegram_users: [],
    products: [], 
    userTokens: {} 
  };
}

// Save data.json locally
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

// Commit to GitHub
async function commitToGithub(data) {
  if (!GITHUB_TOKEN) {
    console.warn('⚠️ GITHUB_TOKEN non configuré, commit ignoré');
    return;
  }

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

  const data = loadData();
  const userTokens = data.userTokens || {};

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

  const data = loadData();
  const userTokens = data.userTokens || {};

  // Vérifier si l'utilisateur a déjà un token
  let token = Object.keys(userTokens).find(t => userTokens[t] === userId);

  // Sinon, générer un nouveau
  if (!token) {
    token = generateToken();
    userTokens[token] = userId;
    data.userTokens = userTokens;
    saveData(data);
    console.log(`✅ Token généré pour userId ${userId}: ${token}`);

    // Committer sur GitHub
    await commitToGithub(data);
  } else {
    console.log(`♻️ Token réutilisé pour userId ${userId}: ${token}`);
  }

  return res.json({ success: true, token: token });
});

// Save shop data avec détection des changements
app.post('/api/save-data', async (req, res) => {
  try {
    const newData = req.body;
    const oldData = loadData();

    // Comparer les produits pour détecter les changements
    const oldProducts = oldData.products || [];
    const newProducts = newData.products || [];

    for (const newProduct of newProducts) {
      const oldProduct = oldProducts.find(p => p.id === newProduct.id);

      if (!oldProduct) {
        // Nouveau produit ajouté
        const price = newProduct.tariffs?.split('|')[0]?.split('=')[1];
        await notifications.notifyNewProduct(newProduct.name, price, newProduct.category);
      } else {
        // Produit modifié - vérifier les changements de stock
        if (oldProduct.stock !== newProduct.stock) {
          if (newProduct.stock === 'Rupture de stock') {
            await notifications.notifyOutOfStock(newProduct.name);
          } else if (newProduct.stock === 'Stock limité' && oldProduct.stock !== 'Stock limité') {
            const price = newProduct.tariffs?.split('|')[0]?.split('=')[1];
            await notifications.notifyLimitedStock(newProduct.name, price);
          } else if (newProduct.stock === 'En stock' && oldProduct.stock === 'Rupture de stock') {
            const price = newProduct.tariffs?.split('|')[0]?.split('=')[1];
            await notifications.notifyBackInStock(newProduct.name, price);
          }
        }
      }
    }

    // Sauvegarder les données
    saveData(newData);
    console.log('✅ data.json sauvegardé');

    // Commit to GitHub
    await commitToGithub(newData);

    res.json({ success: true, message: 'Données sauvegardées et notifications envoyées' });
  } catch (error) {
    console.error('Erreur save:', error.message);
    res.json({ success: false, error: error.message });
  }
});

// Nouvel endpoint pour les commandes
app.post('/api/order', async (req, res) => {
    try {
        const order = req.body;

        // Formater la commande pour Telegram
        const items = order.items.map(item => 
            `<b>${item.name}</b>\n  ${item.size} x${item.quantity} = ${item.price * item.quantity}€`
        ).join('\n');

        // Récupérer le username du client via Telegram
        let username = 'Utilisateur inconnu';
        try {
            const userInfo = await axios.get(
                `https://api.telegram.org/bot${BOT_TOKEN}/getChat?chat_id=${order.userId}`
            );
            username = userInfo.data.result.username || userInfo.data.result.first_name || `ID: ${order.userId}`;
        } catch (e) {
            console.log('Impossible de récupérer le username');
        }

        const message = `
📦 <b>NOUVELLE COMMANDE !</b>

<b>Détails :</b>
${items}

💰 <b>Total : ${order.total}€</b>

👤 <b>Client :</b> @${username}
⏰ <b>Heure :</b> ${new Date(order.timestamp).toLocaleString('fr-FR')}

⚠️ <i>Prépare la commande et contacte le client</i>
        `;

        // Envoyer au propriétaire
        const OWNER_TELEGRAM_ID = process.env.OWNER_TELEGRAM_ID;
        await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
            chat_id: OWNER_TELEGRAM_ID,
            text: message,
            parse_mode: 'HTML'
        });

        res.json({ success: true, message: 'Commande reçue' });
    } catch (error) {
        console.error('Erreur commande:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// Server start
const PORT = process.env.PORT || 10000;
const server = app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
  console.log(`🤖 BOT_TOKEN configuré`);
  console.log(`📢 CHANNEL_ID: ${CHANNEL_ID}`);
  console.log(`💾 Tokens stockés dans data.json + GitHub`);

  // Synchroniser les anciens utilisateurs avec les nouveaux au démarrage
  const data = loadData();
  if (data.userTokens && data.telegram_users) {
    const oldUserIds = Object.values(data.userTokens);
    let newUsersAdded = 0;
    
    oldUserIds.forEach(userId => {
      if (!data.telegram_users.includes(userId)) {
        data.telegram_users.push(userId);
        newUsersAdded++;
      }
    });
    
    if (newUsersAdded > 0) {
      saveData(data);
      console.log(`✅ ${newUsersAdded} utilisateurs ajoutés aux notifications`);
    }
    console.log(`📊 Total utilisateurs notifiés: ${data.telegram_users.length}`);
  }
});

// Vérifier les horaires toutes les minutes
setInterval(() => {
    notifications.checkShopHours();
}, 60000);
