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
  if (!BOT_TOKEN || !CHANNEL_ID) {
    console.warn('⚠️ BOT_TOKEN ou CHANNEL_ID manquant');
    return false;
  }
  try {
    const url = `https://api.telegram.org/bot${BOT_TOKEN}/getChatMember`;
    const response = await axios.post(url, {
      chat_id: CHANNEL_ID,
      user_id: userId
    });
    const status = response.data.result.status;
    const valid = ['member', 'administrator', 'creator', 'restricted'].includes(status);
    console.log(`🔍 Vérification canal pour utilisateur ${userId}, status: ${status}`);
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
    data.telegram_users = data.telegram_users || [];
    
    if (!data.telegram_users.includes(userId)) {
      data.telegram_users.push(userId);
    }
    
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
      await notificationService.notifyNewProduct(newProd.name, newProd.price, newProd.category);
    } else if (newProd.stock === 0 && oldProd.stock > 0) {
      await notificationService.notifyOutOfStock(newProd.name);
    } else if (newProd.stock > 0 && oldProd.stock === 0) {
      await notificationService.notifyBackInStock(newProd.name, newProd.price);
    } else if (newProd.stock <= 3 && newProd.stock > 0 && oldProd.stock > 3) {
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
    `• ${item.name} - ${item.size} x${item.quantity} = ${(item.price * item.quantity).toFixed(2)}€`
  ).join('\n');
  
  const message = `📦 *Nouvelle commande*\n\n👤 Client: ${userName}\n\n*Articles:*\n${itemsText}\n\n*Total:* ${total}€\n⏰ ${new Date().toLocaleString('fr-FR')}`;
  
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
    try {
      const userId = ctx.from.id;
      const userName = ctx.from.username || ctx.from.first_name || `User${userId}`;
      const data = loadData();
      
      console.log(`📱 /start reçu de ${userName} (${userId})`);
      
      // Vérifier l'appartenance au canal
      const isMember = await isChannelMember(userId);
      
      if (!isMember) {
        return ctx.reply('❌ Accès refusé - Tu dois être membre de @SVR_TO pour accéder à la boutique.\n\n🔗 Rejoins le canal: https://t.me/SVR_TO');
      }
      
      // Vérifier si nouvel utilisateur
      const existingToken = Object.keys(data.userTokens || {}).find(t => data.userTokens[t].toString() === userId.toString());
      
      if (!existingToken) {
        // Nouvel utilisateur
        const token = generateToken();
        data.userTokens[token] = userId;
        data.usernames = data.usernames || {};
        data.usernames[userId] = userName;
        data.telegram_users = data.telegram_users || [];
        
        if (!data.telegram_users.includes(userId)) {
          data.telegram_users.push(userId);
        }
        
        saveData(data);
        await commitToGithub(`Nouvel utilisateur: @${userName} (${userId})`, data);
        
        const link = `${SITE_URL}?token=${token}&userId=${userId}`;
        const welcomeMessage = `✅ *Bienvenue @${userName} !*\n\nTu recevras maintenant :\n📢 Les horaires d'ouverture/fermeture\n✨ Les nouveaux produits\n⚠️ Les ruptures de stock\n🔥 Les offres limitées\n\n🛍️ *Accès à la boutique :* ${link}\n\n⚠️ _Ne le partage pas, il est unique à toi !_ 👍`;
        
        return ctx.reply(welcomeMessage, { parse_mode: 'Markdown', disable_web_page_preview: true });
      } else {
        // Utilisateur existant
        const link = `${SITE_URL}?token=${existingToken}&userId=${userId}`;
        return ctx.reply(`Tu as déjà accès à la boutique ! 👍\n\n🔗 Ton lien : ${link}`, { disable_web_page_preview: true });
      }
    } catch (err) {
      console.error('❌ Erreur dans /start:', err);
      ctx.reply('❌ Une erreur s\'est produite. Réessaie plus tard.');
    }
  });
  
  bot.catch((err, ctx) => {
    console.error('🚨 Erreur bot:', err);
  });
  
  bot.launch()
    .then(() => console.log('✅ Bot Telegram lancé avec succès'))
    .catch(err => console.error('❌ Erreur au lancement du bot:', err));
  
  process.once('SIGINT', () => {
    console.log('Arrêt du bot...');
    bot.stop('SIGINT');
  });
  process.once('SIGTERM', () => {
    console.log('Arrêt du bot...');
    bot.stop('SIGTERM');
  });
} else {
  console.error('❌ TELEGRAM_BOT_TOKEN non défini ! Le bot ne peut pas démarrer.');
}

// Synchronisation au démarrage
const data = loadData();
if (data.userTokens && typeof data.userTokens === 'object') {
  const userIds = Object.values(data.userTokens).map(id => parseInt(id));
  const telegramUsers = new Set(data.telegram_users || []);
  userIds.forEach(id => {
    if (!isNaN(id)) telegramUsers.add(id);
  });
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
  console.log(`📋 BOT_TOKEN: ${BOT_TOKEN ? '✅' : '❌'}`);
  console.log(`📋 CHANNEL_ID: ${CHANNEL_ID ? '✅' : '❌'}`);
  console.log(`📋 OWNER_TELEGRAM_ID: ${OWNER_TELEGRAM_ID ? '✅' : '❌'}`);
});
