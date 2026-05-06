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

// ==================== UTILITAIRES ====================

function loadData() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    }
  } catch (err) {
    console.error('❌ Erreur chargement data.json:', err.message);
  }
  return { 
    telegram_users: [], 
    userTokens: {}, 
    usernames: {}, 
    shop_settings: {}, 
    products: [],
    concours: {}
  };
}

function saveData(data) {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf8');
    console.log('✅ data.json sauvegardé');
  } catch (err) {
    console.error('❌ Erreur sauvegarde:', err.message);
  }
}

async function commitToGithub(message, data) {
  if (!GITHUB_TOKEN) {
    console.warn('⚠️ GITHUB_TOKEN non défini');
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
    console.log(`✅ GitHub: "${message}"`);
  } catch (err) {
    console.error('❌ Erreur commit:', err.response?.data?.message || err.message);
  }
}

async function isChannelMember(userId) {
  if (!BOT_TOKEN || !CHANNEL_ID) return false;
  try {
    const response = await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/getChatMember`, {
      chat_id: CHANNEL_ID,
      user_id: userId
    });
    const status = response.data.result.status;
    return ['member', 'administrator', 'creator', 'restricted'].includes(status);
  } catch (err) {
    console.error('❌ Erreur vérification canal:', err.message);
    return false;
  }
}

function generateToken() {
  return 'svr_' + Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
}

// ==================== ROUTES EXPRESS ====================

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

app.get('/data.json', (req, res) => {
  res.json(loadData());
});

app.post('/api/verify-token', (req, res) => {
  const { token, userId } = req.body;
  const data = loadData();
  
  if (data.userTokens[token] && data.userTokens[token].toString() === userId.toString()) {
    return res.json({ valid: true });
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
    return res.status(403).json({ error: 'Accès refusé' });
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
    await commitToGithub(`Nouvel user: @${userName} (${userId})`, data);
  }
  
  const link = `${SITE_URL}?token=${token}&userId=${userId}`;
  res.json({ token, link });
});

app.post('/api/save-data', async (req, res) => {
  const { products, shop_settings } = req.body;
  const oldData = loadData();
  const newData = { ...oldData, products, shop_settings };
  
  saveData(newData);
  
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
  
  await commitToGithub('Mise à jour produits', newData);
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
    console.log('✅ Commande notifiée');
    res.json({ success: true });
  } catch (err) {
    console.error('❌ Erreur notification:', err.message);
    res.status(500).json({ error: 'Erreur' });
  }
});

// ==================== BOT TELEGRAM ====================

let bot;

if (BOT_TOKEN) {
  bot = new Telegraf(BOT_TOKEN);
  
  bot.start(async (ctx) => {
    try {
      const userId = ctx.from.id;
      const userName = ctx.from.username || ctx.from.first_name || `User${userId}`;
      const data = loadData();
      
      console.log(`📱 /start: ${userName} (${userId})`);
      
      const isMember = await isChannelMember(userId);
      if (!isMember) {
        return ctx.reply('❌ Tu dois être membre de @SVR_TO\n🔗 https://t.me/SVR_TO');
      }
      
      const existingToken = Object.keys(data.userTokens || {}).find(
        t => data.userTokens[t].toString() === userId.toString()
      );
      
      if (!existingToken) {
        const token = generateToken();
        data.userTokens[token] = userId;
        data.usernames = data.usernames || {};
        data.usernames[userId] = userName;
        data.telegram_users = data.telegram_users || [];
        
        if (!data.telegram_users.includes(userId)) {
          data.telegram_users.push(userId);
        }
        
        saveData(data);
        await commitToGithub(`Nouvel user: @${userName}`, data);
        
        const link = `${SITE_URL}?token=${token}&userId=${userId}`;
        const msg = `✅ Bienvenue @${userName} !\n\n📢 Tu recevras :\n✨ Nouveaux produits\n⚠️ Ruptures de stock\n🔥 Offres limitées\n\n🛍️ Lien: ${link}\n\n⚠️ Ne le partage pas!`;
        return ctx.reply(msg, { parse_mode: 'Markdown', disable_web_page_preview: true });
      } else {
        const link = `${SITE_URL}?token=${existingToken}&userId=${userId}`;
        return ctx.reply(`Tu as déjà accès !\n\n🔗 ${link}`, { disable_web_page_preview: true });
      }
    } catch (err) {
      console.error('❌ Erreur /start:', err);
      ctx.reply('❌ Erreur. Réessaie.');
    }
  });
  
  bot.catch((err) => {
    console.error('🚨 Erreur bot:', err);
  });
  
  // Supprimer webhook et lancer polling
  axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/deleteWebhook`)
    .then(() => {
      bot.launch({
        polling: {
          interval: 3000,
          timeout: 30,
          allowedUpdates: ['message', 'callback_query']
        }
      }).then(() => {
        console.log('✅ Bot lancé (polling)');
      }).catch(err => {
        console.error('❌ Erreur launch:', err);
      });
    })
    .catch(err => {
      console.error('❌ Erreur deleteWebhook:', err.message);
    });
  
  process.once('SIGINT', () => {
    console.log('Arrêt du bot...');
    bot.stop('SIGINT');
  });
  process.once('SIGTERM', () => {
    console.log('Arrêt du bot...');
    bot.stop('SIGTERM');
  });
} else {
  console.error('❌ TELEGRAM_BOT_TOKEN manquant');
}

// ==================== SYNCHRONISATION ====================

const data = loadData();
if (data.userTokens && typeof data.userTokens === 'object') {
  const userIds = Object.values(data.userTokens).map(id => parseInt(id));
  const telegramUsers = new Set(data.telegram_users || []);
  userIds.forEach(id => {
    if (!isNaN(id)) telegramUsers.add(id);
  });
  data.telegram_users = Array.from(telegramUsers);
  saveData(data);
  console.log(`✅ ${data.telegram_users.length} utilisateurs synchro`);
}

setInterval(() => {
  notificationService.checkShopHours();
}, 60000);

// ==================== DÉMARRAGE ====================

app.listen(PORT, () => {
  console.log(`🚀 Serveur port ${PORT}`);
  console.log(`📋 BOT_TOKEN: ${BOT_TOKEN ? '✅' : '❌'}`);
  console.log(`📋 CHANNEL_ID: ${CHANNEL_ID ? '✅' : '❌'}`);
  console.log(`📋 OWNER_ID: ${OWNER_TELEGRAM_ID ? '✅' : '❌'}`);
});
