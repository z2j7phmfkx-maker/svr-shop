const express = require('express');
const path = require('path');
const { Telegraf } = require('telegraf');
const axios = require('axios');
const fs = require('fs');
const notificationService = require('./notificationService');

const app = express();
app.use(express.json());
app.use(express.static('public'));

// Configuration
const DATA_FILE = path.join(__dirname, 'data.json');
const PORT = process.env.PORT || 10000;
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHANNEL_ID = process.env.CHANNEL_ID;
const OWNER_TELEGRAM_ID = process.env.OWNER_TELEGRAM_ID;
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_REPO = 'z2j7phmfkx-maker/svr-shop';
const SITE_URL = process.env.SITE_URL || 'https://svr-shop.onrender.com';

// Utilitaires
function loadData() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    }
  } catch (err) {
    console.error('❌ Erreur lors du chargement de data.json:', err.message);
  }
  return { telegram_users: [], userTokens: {}, usernames: {}, shop_settings: {}, products: [] };
}

function saveData(data) {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf8');
    console.log('✅ data.json sauvegardé');
  } catch (err) {
    console.error('❌ Erreur lors de la sauvegarde:', err.message);
  }
}

async function commitToGithub(message, data) {
  if (!GITHUB_TOKEN) {
    console.warn('⚠️ GITHUB_TOKEN non défini, commit ignoré');
    return;
  }
  try {
    const content = Buffer.from(JSON.stringify(data, null, 2)).toString('base64');
    const url = `https://api.github.com/repos/${GITHUB_REPO}/contents/data.json`;
    const response = await axios.get(url, {
      headers: { Authorization: `token ${GITHUB_TOKEN}` }
    });
    await axios.put(url, {
      message,
      content,
      sha: response.data.sha
    }, {
      headers: { Authorization: `token ${GITHUB_TOKEN}` }
    });
    console.log(`✅ Commit GitHub: "${message}"`);
  } catch (err) {
    console.error('❌ Erreur commit GitHub:', err.response?.data?.message || err.message);
  }
}

async function isChannelMember(userId) {
  if (!BOT_TOKEN || !CHANNEL_ID) return false;
  try {
    const url = `https://api.telegram.org/bot${BOT_TOKEN}/getChatMember`;
    const response = await axios.post(url, {
      chat_id: CHANNEL_ID,
      user_id: userId
    });
    const status = response.data.result.status;
    const valid = ['member', 'administrator', 'creator', 'restricted'].includes(status);
    console.log(`🔍 Vérification canal pour utilisateur ${userId}, status: ${status}, Valid: ${valid}`);
    return valid;
  } catch (err) {
    console.error('❌ Erreur vérification canal:', err.response?.data?.description || err.message);
    return false;
  }
}

function generateToken() {
  return 'svr_' + Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
}

// Routes Express
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

app.post('/api/verify-token', (req, res) => {
  const { token, userId } = req.body;
  const data = loadData();
  
  if (data.userTokens[token] && data.userTokens[token].toString() === userId.toString()) {
    return res.json({ valid: true, userId });
  }
  res.json({ valid: false });
});

app.post('/api/generate-token', async (req, res) => {
  const { userId, userName } = req.body;
  
  if (!userId) {
    return res.status(400).json({ error: 'userId manquant' });
  }
  
  const isMember = await isChannelMember(userId);
  if (!isMember) {
    return res.status(403).json({ error: 'Accès refusé - pas membre du canal' });
  }
  
  const data = loadData();
  let token = data.userTokens[userId];
  
  if (!token) {
    token = generateToken();
    data.userTokens[token] = userId;
    data.usernames = data.usernames || {};
    data.usernames[userId] = userName;
    saveData(data);
    await commitToGithub(`Token généré pour @${userName} (${userId})`, data);
  }
  
  const link = `${SITE_URL}?token=${token}&userId=${userId}`;
  res.json({ token, link });
});

app.post('/api/save-data', async (req, res) => {
  const { products, shop_settings } = req.body;
  const oldData = loadData();
  const newData = { ...oldData, products, shop_settings };
  
  saveData(newData);
  
  // Vérifier les changements de stock
  for (const newProd of products) {
    const oldProd = oldData.products.find(p => p.id === newProd.id);
    
    if (!oldProd) {
      // Nouveau produit
      await notificationService.notifyNewProduct(newProd.name, newProd.price, newProd.category);
    } else if (newProd.stock === 0 && oldProd.stock > 0) {
      // Rupture de stock
      await notificationService.notifyOutOfStock(newProd.name);
    } else if (newProd.stock > 0 && oldProd.stock === 0) {
      // Retour en stock
      await notificationService.notifyBackInStock(newProd.name, newProd.price);
    } else if (newProd.stock <= 3 && newProd.stock > 0 && oldProd.stock > 3) {
      // Stock limité
      await notificationService.notifyLimitedStock(newProd.name, newProd.price);
    }
  }
  
  await commitToGithub('Mise à jour produits/paramètres', newData);
  res.json({ success: true });
});

app.post('/api/order', async (req, res) => {
  const { userId, items, total } = req.body;
  const data = loadData();
  
  let userName = 'Utilisateur inconnu';
  if (data.usernames && data.usernames[userId]) {
    userName = `@${data.usernames[userId]}`;
  }
  
  let itemsText = items.map(item => 
    `• ${item.name} - ${item.size} x${item.quantity} = ${item.price * item.quantity}€`
  ).join('\n');
  
  const message = `
📦 *Nouvelle commande*

👤 Client: ${userName}

*Articles:*
${itemsText}

*Total:* ${total}€
⏰ ${new Date().toLocaleString('fr-FR')}
  `;
  
  try {
    await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      chat_id: OWNER_TELEGRAM_ID,
      text: message,
      parse_mode: 'Markdown'
    });
    console.log('✅ Notification commande envoyée');
    res.json({ success: true });
  } catch (err) {
    console.error('❌ Erreur envoi notification:', err.response?.data?.description || err.message);
    res.status(500).json({ error: 'Erreur lors de l\'envoi' });
  }
});

// Bot Telegram
let bot;
if (BOT_TOKEN) {
  bot = new Telegraf(BOT_TOKEN);
  
  bot.start(async (ctx) => {
    const userId = ctx.from.id;
    const userName = ctx.from.username || ctx.from.first_name || `User${userId}`;
    const data = loadData();
    
    // Vérifier si déjà membre
    const isExisting = data.userTokens[userId];
    
    // Vérifier l'appartenance au canal
    const isMember = await isChannelMember(userId);
    
    if (!isMember) {
      return ctx.reply('❌ Accès refusé - Tu dois être membre de @SVR_TO pour accéder à la boutique.\n\n🔗 Rejoins le canal: https://t.me/SVR_TO');
    }
    
    // Si nouvel utilisateur
    if (!isExisting) {
      const token = generateToken();
      data.userTokens[token] = userId;
      data.usernames = data.usernames || {};
      data.usernames[userId] = userName;
      
      // Ajouter aux utilisateurs Telegram
      if (!data.telegram_users.includes(userId)) {
        data.telegram_users.push(userId);
      }
      
      saveData(data);
      await commitToGithub(`Nouvel utilisateur: @${userName} (${userId})`, data);
      
      const link = `${SITE_URL}?token=${token}&userId=${userId}`;
      const welcomeMessage = `✅ *Bienvenue @${userName} !*

Tu recevras maintenant :
📢 Les horaires d'ouverture/fermeture
✨ Les nouveaux produits
⚠️ Les ruptures de stock
🔥 Les offres limitées

🛍️ *Accès à la boutique :* ${link}

⚠️ _Ne le partage pas, il est unique à toi !_ 👍`;
      
      return ctx.reply(welcomeMessage, { parse_mode: 'Markdown', disable_web_page_preview: true });
    }
    
    // Utilisateur existant
    const token = Object.keys(data.userTokens).find(t => data.userTokens[t].toString() === userId.toString());
    if (token) {
      const link = `${SITE_URL}?token=${token}&userId=${userId}`;
      return ctx.reply(`Tu as déjà accès à la boutique ! 👍\n\n🔗 Ton lien : ${link}`, { disable_web_page_preview: true });
    }
  });
  
  bot.launch();
  console.log('✅ Bot Telegram lancé');
  
  process.once('SIGINT', () => bot.stop('SIGINT'));
  process.once('SIGTERM', () => bot.stop('SIGTERM'));
} else {
  console.warn('⚠️ BOT_TOKEN non défini, bot désactivé');
}

// Synchronisation au démarrage
const data = loadData();
if (data.userTokens && typeof data.userTokens === 'object') {
  const userIds = Object.values(data.userTokens);
  const telegramUsers = new Set(data.telegram_users || []);
  userIds.forEach(id => telegramUsers.add(id));
  data.telegram_users = Array.from(telegramUsers);
  saveData(data);
  console.log(`✅ ${data.telegram_users.length} utilisateurs synchronisés`);
}

// Vérification horaires chaque minute
setInterval(() => {
  notificationService.checkShopHours();
}, 60000);

app.listen(PORT, () => {
  console.log(`🚀 Serveur démarré sur le port ${PORT}`);
});
