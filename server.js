const express = require('express');
const path = require('path');
const { Telegraf } = require('telegraf');
const axios = require('axios');
const fs = require('fs');
const multer = require('multer');
const cloudinary = require('cloudinary').v2;
const notificationService = require('./notificationService');

const app = express();
app.use(express.json());
app.use(express.static('public'));

// Configuration Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

// Configuration multer (pour recevoir les fichiers)
const upload = multer({ storage: multer.memoryStorage() });

// Configuration
const DATA_FILE = path.join(__dirname, 'data.json');
const PORT = process.env.PORT || 10000;
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHANNEL_ID = process.env.CHANNEL_ID;
const OWNER_TELEGRAM_ID = process.env.OWNER_TELEGRAM_ID;
const MY_TELEGRAM_ID = process.env.MY_TELEGRAM_ID;
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
    firstNames: {},
    shop_settings: {}, 
    products: [],
    concours: {},
    orderCounter: 1000
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
  if (!BOT_TOKEN || !CHANNEL_ID) {
    console.error('❌ BOT_TOKEN ou CHANNEL_ID manquant');
    return false;
  }
  try {
    console.log(`🔍 Vérification: userId=${userId}, channelId=${CHANNEL_ID}`);
    const response = await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/getChatMember`, {
      chat_id: CHANNEL_ID,
      user_id: userId
    });
    const status = response.data.result.status;
    console.log(`✅ Statut du user: ${status}`);
    const isMember = ['member', 'administrator', 'creator', 'restricted'].includes(status);
    console.log(`${isMember ? '✅' : '❌'} User ${userId} est ${isMember ? 'MEMBRE' : 'PAS MEMBRE'}`);
    return isMember;
  } catch (err) {
    console.error('❌ Erreur vérification canal:', err.response?.data?.description || err.message);
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

// ✅ ROUTE POUR RÉCUPÉRER LES PRODUITS
app.get('/api/products', (req, res) => {
  const data = loadData();
  res.json(data.products || []);
});

app.post('/api/verify-token', (req, res) => {
  const { token, userId } = req.body;
  const data = loadData();
  
  console.log('\n[VERIFY-TOKEN] ========================');
  console.log(`  Token reçu: "${token}"`);
  console.log(`  UserId reçu: "${userId}" (type: ${typeof userId})`);
  console.log(`  Data.userTokens keys: ${Object.keys(data.userTokens || {}).slice(0, 5).join(', ')}...`);
  
  const storedUserId = data.userTokens[token];
  console.log(`  StoredUserId trouvé: ${storedUserId} (type: ${typeof storedUserId})`);
  console.log(`  Token existe dans userTokens: ${token in (data.userTokens || {})}`);
  
  if (!storedUserId) {
    console.log(`  ❌ TOKEN PAS TROUVÉ DANS userTokens`);
    console.log(`  Tous les tokens: ${Object.keys(data.userTokens || {}).join(', ')}`);
    return res.json({ valid: false });
  }
  
  const parsedUserId = parseInt(userId, 10);
  console.log(`  ParsedUserId: ${parsedUserId}`);
  console.log(`  Comparaison: ${storedUserId} === ${parsedUserId} = ${storedUserId === parsedUserId}`);
  console.log('============================\n');
  
  if (storedUserId === parsedUserId) {
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
  const { products, shop_settings, editingProductId } = req.body;
  const oldData = loadData();
  const newData = { ...oldData, products, shop_settings };
  
  saveData(newData);
  
  for (const newProd of products) {
    const oldProd = oldData.products.find(p => p.id === newProd.id);
    
    // 🔧 EXTRAIRE LE PRIX MINIMUM DES TARIFS
    let minPrice = 'N/A';
    if (newProd.tariffs) {
      const prices = newProd.tariffs.split('|').map(t => {
        const price = t.split('=')[1];
        return parseInt(price) || 0;
      });
      minPrice = Math.min(...prices);
    }
    
    // ✅ SI C'EST UNE MODIFICATION, NE PAS ENVOYER DE NOTIFICATION
    if (editingProductId && newProd.id === editingProductId) {
      console.log(`📝 Produit modifié (pas de notification): ${newProd.name}`);
      continue;
    }
    
    if (!oldProd) {
      await notificationService.notifyNewProduct(newProd.name, minPrice, newProd.category);
    } else if (newProd.stock === 0 && oldProd.stock > 0) {
      await notificationService.notifyOutOfStock(newProd.name);
    } else if (newProd.stock > 0 && oldProd.stock === 0) {
      await notificationService.notifyBackInStock(newProd.name, minPrice);
    } else if (newProd.stock <= 3 && newProd.stock > 0 && oldProd.stock > 3) {
      await notificationService.notifyLimitedStock(newProd.name, minPrice);
    }
  }
  
  await commitToGithub('Mise à jour produits', newData);
  res.json({ success: true });
});

app.post('/api/order', async (req, res) => {
  console.log('\n🚀 ===== NOUVELLE COMMANDE REÇUE =====');
  console.log('📦 Body complet reçu:', JSON.stringify(req.body, null, 2));
  
  const { userId, items, total, timeSlot, deliveryOption } = req.body;
  const data = loadData();
  
  // ✅ LOGS DEBUG DÉTAILLÉS
  console.log('\n📋 PARAMÈTRES EXTRAITS:');
  console.log('  ✓ userId:', userId);
  console.log('  ✓ items:', items ? `${items.length} items` : 'undefined');
  console.log('  ✓ total:', total);
  console.log('  ✓ timeSlot:', timeSlot);
  console.log('  ✓ deliveryOption:', deliveryOption);
  console.log('  ✓ deliveryOption type:', typeof deliveryOption);
  console.log('  ✓ deliveryOption === "sur_place":', deliveryOption === 'sur_place');
  console.log('  ✓ deliveryOption === "livraison":', deliveryOption === 'livraison');
  
  // Initialiser le compteur et firstNames s'ils n'existent pas
  if (!data.orderCounter) {
    data.orderCounter = 1000;
  }
  if (!data.firstNames) {
    data.firstNames = {};
  }
  
  // Incrémenter le compteur
  const orderNumber = ++data.orderCounter;
  
  console.log(`\n📦 Nouvelle commande #${orderNumber} - userId: ${userId}`);
  
  // Chercher le nom dans cet ordre : username > first_name
  let userName = 'Utilisateur inconnu';
  
  if (data.usernames && data.usernames[userId]) {
    userName = `@${data.usernames[userId]}`;
    console.log(`✅ Username trouvé: ${userName}`);
  } else if (data.firstNames && data.firstNames[userId]) {
    userName = data.firstNames[userId];
    console.log(`✅ FirstName trouvé: ${userName}`);
  } else {
    console.warn(`⚠️ Aucun nom trouvé pour userId=${userId}`);
  }
  
  // Construire le texte des items
  let itemsText = items.map(item => {
    const itemPrice = (item.price * item.quantity).toFixed(2);
    return `• <b>${item.name}</b> - ${item.grams.toFixed(2)}g x${item.quantity} = ${itemPrice}€`;
  }).join('\n');
  
  // Déterminer le libellé du lieu de livraison
  console.log('\n🔍 DEBUG LIVRAISON:');
  console.log('  deliveryOption brut:', deliveryOption);
  console.log('  Comparaison avec "sur_place":', deliveryOption === 'sur_place');
  console.log('  Comparaison avec "livraison":', deliveryOption === 'livraison');
  
  const deliveryLabel = deliveryOption === 'sur_place' ? '🏪 Sur place' : '🚚 Livraison';
  
  console.log('  ✅ deliveryLabel final:', deliveryLabel);
  
  // Construire le message AVEC le lieu ET le créneau de livraison
  const message = `<b>📦 Nouvelle commande #${orderNumber}</b>\n\n<b>👤 Client:</b> ${userName}\n\n<b>Articles:</b>\n${itemsText}\n\n<b>💰 Total:</b> ${total.toFixed(2)}€\n\n<b>⏰ Créneau:</b> ${timeSlot || 'Non spécifié'}\n<b>📍 Type:</b> ${deliveryLabel}`;
  
  console.log('\n📝 Message à envoyer:');
  console.log(message);
  
  try {
    console.log(`\n📤 Envoi à OWNER_TELEGRAM_ID: ${OWNER_TELEGRAM_ID}`);
    // Envoyer au propriétaire
    await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      chat_id: OWNER_TELEGRAM_ID,
      text: message,
      parse_mode: 'HTML'
    });
    console.log('✅ Commande notifiée au propriétaire');
    
    // Envoyer à toi aussi si MY_TELEGRAM_ID est défini
    if (MY_TELEGRAM_ID && MY_TELEGRAM_ID !== OWNER_TELEGRAM_ID) {
      console.log(`📤 Envoi à MY_TELEGRAM_ID: ${MY_TELEGRAM_ID}`);
      await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
        chat_id: MY_TELEGRAM_ID,
        text: message,
        parse_mode: 'HTML'
      });
      console.log('✅ Commande notifiée aussi à toi');
    } else {
      console.log(`⚠️ MY_TELEGRAM_ID non défini ou = OWNER_TELEGRAM_ID`);
    }
    
    // Sauvegarder le compteur
    saveData(data);
    
    // Commit sur GitHub
    await commitToGithub(`Commande #${orderNumber}`, data);
    
    console.log('✅ Commande notifiée avec succès');
    console.log('===== FIN COMMANDE =====\n');
    res.json({ success: true });
  } catch (err) {
    console.error('\n❌ ERREUR NOTIFICATION TELEGRAM:');
    console.error(`   Status: ${err.response?.status}`);
    console.error(`   Data: ${JSON.stringify(err.response?.data)}`);
    console.error(`   Message: ${err.message}`);
    console.error(`   Chat ID envoyé: ${OWNER_TELEGRAM_ID}`);
    console.error(`   Message envoyé: ${message.substring(0, 100)}...`);
    
    // Sauvegarder quand même la commande
    saveData(data);
    
    console.log('===== FIN COMMANDE (ERREUR) =====\n');
    res.status(500).json({ error: 'Erreur notification Telegram', details: err.response?.data?.description || err.message });
  }
});

app.post('/api/sync-users', async (req, res) => {
  try {
    const data = loadData();
    const telegramUsers = data.telegram_users || [];
    
    if (telegramUsers.length === 0) {
      return res.json({ 
        success: false, 
        message: 'Aucun utilisateur à synchroniser' 
      });
    }
    
    console.log(`\n🔄 Synchronisation de ${telegramUsers.length} utilisateurs...`);
    
    let syncedCount = 0;
    let errorCount = 0;
    const results = [];
    
    for (const userId of telegramUsers) {
      try {
        // Récupérer les infos du user via Telegram API
        const response = await axios.post(
          `https://api.telegram.org/bot${BOT_TOKEN}/getChat`,
          { chat_id: userId }
        );
        
        const userInfo = response.data.result;
        const firstName = userInfo.first_name || 'Unknown';
        const username = userInfo.username || null;
        
        // Mettre à jour les données
        data.firstNames = data.firstNames || {};
        data.usernames = data.usernames || {};
        
        let updated = false;
        
        // Si le user avait pas de firstName, l'ajouter
        if (!data.firstNames[userId] || data.firstNames[userId] === 'Unknown') {
          data.firstNames[userId] = firstName;
          console.log(`✅ ${userId}: firstName = "${firstName}"`);
          updated = true;
        }
        
        // Si le user avait pas d'username, l'ajouter
        if (username && !data.usernames[userId]) {
          data.usernames[userId] = username;
          console.log(`✅ ${userId}: username = "@${username}"`);
          updated = true;
        }
        
        if (updated) {
          syncedCount++;
          results.push({ userId, firstName, username, status: 'synced' });
        } else {
          results.push({ userId, firstName, username, status: 'already_set' });
        }
        
      } catch (err) {
        console.error(`❌ Erreur sync userId ${userId}:`, err.message);
        errorCount++;
        results.push({ userId, status: 'error', error: err.message });
      }
    }
    
    // Sauvegarder les données mises à jour
    saveData(data);
    await commitToGithub('Synchronisation utilisateurs', data);
    
    console.log(`\n✅ Sync terminée: ${syncedCount} users mis à jour, ${errorCount} erreurs\n`);
    
    res.json({ 
      success: true,
      synced: syncedCount,
      errors: errorCount,
      total: telegramUsers.length,
      message: `${syncedCount} utilisateurs synchronisés avec succès`,
      results: results
    });
    
  } catch (err) {
    console.error('❌ Erreur sync globale:', err);
    res.status(500).json({ 
      success: false, 
      error: err.message 
    });
  }
});

app.post('/api/upload', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Aucun fichier fourni' });
    }

    console.log(`📤 Upload fichier: ${req.file.originalname}`);

    // Upload sur Cloudinary
    const result = await new Promise((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        {
          folder: 'svr-shop',
          resource_type: 'auto'
        },
        (error, result) => {
          if (error) reject(error);
          else resolve(result);
        }
      );
      stream.end(req.file.buffer);
    });

    console.log(`✅ Image uploadée: ${result.secure_url}`);

    res.json({
      success: true,
      url: result.secure_url
    });

  } catch (error) {
    console.error('❌ Erreur upload:', error);
    res.status(500).json({ 
      error: 'Erreur upload Cloudinary',
      details: error.message 
    });
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
      const firstName = ctx.from.first_name || 'Unknown';
      const data = loadData();
      
      console.log(`📱 /start: ${userName} (${userId})`);
      
      const isMember = await isChannelMember(userId);
      if (!isMember) {
        console.log(`❌ ${userName} n'est pas membre du canal`);
        return ctx.reply('❌ Tu dois être membre de @SVR_TO\n🔗 https://t.me/SVR_TO');
      }
      
      console.log(`✅ ${userName} est membre du canal`);
      
      const existingToken = Object.keys(data.userTokens || {}).find(
        t => data.userTokens[t].toString() === userId.toString()
      );
      
      if (!existingToken) {
        // Nouvel utilisateur : message avec bouton interactif
        const token = generateToken();
        data.userTokens[token] = userId;
        data.usernames = data.usernames || {};
        data.usernames[userId] = userName;
        data.firstNames = data.firstNames || {};
        data.firstNames[userId] = firstName;
        data.telegram_users = data.telegram_users || [];
        
        if (!data.telegram_users.includes(userId)) {
          data.telegram_users.push(userId);
        }
        
        saveData(data);
        await commitToGithub(`Nouvel user: @${userName}`, data);
        
        console.log(`🆕 Nouvel user créé: ${userName} (firstName: ${firstName})`);
        
        const welcomeMsg = `✅ Bienvenue @${userName} !\n\nTu es autorisé à accéder au shop SVR ! 🎁`;
        
        return ctx.reply(welcomeMsg, {
          reply_markup: {
            inline_keyboard: [
              [
                {
                  text: '🛍️ Ouvrir la boutique',
                  callback_data: `open_shop_${userId}`
                }
              ]
            ]
          }
        });
      } else {
        // Utilisateur existant : mettre à jour firstName + message direct avec lien
        data.firstNames = data.firstNames || {};
        
        if (!data.firstNames[userId] || data.firstNames[userId] === 'Unknown') {
          data.firstNames[userId] = firstName;
          saveData(data);
          console.log(`♻️ User existant: ${userName} - firstName mis à jour: ${firstName}`);
        } else {
          console.log(`♻️ User existant: ${userName}`);
        }
        
        const link = `${SITE_URL}?token=${existingToken}&userId=${userId}`;
        const msg = `✅ Tu as déjà accès ! 🛍️\n\n🎁 Ton lien d'accès au shop :\n\n${link}\n\n🔒 Ne partage pas ce lien, il est unique !`;
        return ctx.reply(msg, { disable_web_page_preview: true });
      }
    } catch (err) {
      console.error('❌ Erreur /start:', err);
      ctx.reply('❌ Erreur. Réessaie.');
    }
  });
  
  // Gérer le clic sur le bouton "Ouvrir la boutique"
  bot.action(/open_shop_(\d+)/, async (ctx) => {
    try {
      const userId = parseInt(ctx.match[1]);
      const data = loadData();
      
      const token = Object.keys(data.userTokens || {}).find(
        t => data.userTokens[t].toString() === userId.toString()
      );
      
      if (!token) {
        return ctx.answerCbQuery('❌ Erreur: token non trouvé', { show_alert: true });
      }
      
      const link = `${SITE_URL}?token=${token}&userId=${userId}`;
      const shopMsg = `🎁 Ton lien d'accès au shop :\n\n${link}\n\n🔒 Ne partage pas ce lien, il est unique !`;
      
      ctx.reply(shopMsg, { disable_web_page_preview: true });
      ctx.answerCbQuery('✅ Lien généré !');
      
    } catch (error) {
      console.error('❌ Erreur callback:', error);
      ctx.answerCbQuery('❌ Erreur', { show_alert: true });
    }
  });
  
  bot.catch((err) => {
    console.error('🚨 Erreur bot:', err);
  });
  
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
        console.error('❌ Erreur bot launch:', err);
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

// Lancer checkShopHours toutes les minutes
setInterval(() => {
  notificationService.checkShopHours();
}, 60000);

// ==================== DÉMARRAGE ====================

app.listen(PORT, () => {
  console.log(`🚀 Serveur port ${PORT}`);
  console.log(`✅ BOT_TOKEN: ${BOT_TOKEN ? 'OK' : 'MANQUANT'}`);
  console.log(`✅ CHANNEL_ID: ${CHANNEL_ID ? 'OK' : 'MANQUANT'}`);
  console.log(`✅ OWNER_ID: ${OWNER_TELEGRAM_ID ? 'OK' : 'MANQUANT'}`);
  console.log(`✅ MY_ID: ${MY_TELEGRAM_ID ? 'OK' : 'MANQUANT'}`);
  console.log(`✅ CLOUDINARY: ${process.env.CLOUDINARY_CLOUD_NAME ? 'OK' : 'MANQUANT'}`);
});
