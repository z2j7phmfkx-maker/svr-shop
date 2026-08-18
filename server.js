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

// Configuration multer
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
const CHANNEL_USERNAME = process.env.CHANNEL_USERNAME || 'SVR_TOV';

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
    console.log(`   🔍 getChatMember(${CHANNEL_ID}, ${userId})`);
    const response = await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/getChatMember`, {
      chat_id: CHANNEL_ID,
      user_id: userId
    });
    const status = response.data.result.status;
    console.log(`   ✅ Statut: ${status}`);
    const isMember = ['member', 'administrator', 'creator'].includes(status);
    console.log(`   ${isMember ? '✅' : '❌'} User ${userId} est ${isMember ? 'MEMBRE' : 'PAS MEMBRE'}`);
    return isMember;
  } catch (err) {
    console.error('   ❌ Erreur:', err.response?.data?.description || err.message);
    return false;
  }
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

app.get('/api/products', (req, res) => {
  const data = loadData();
  res.json(data.products || []);
});

app.post('/api/save-data', async (req, res) => {
  const { products, shop_settings, editingProductId } = req.body;
  const oldData = loadData();
  const newData = { ...oldData, products, shop_settings };
  
  saveData(newData);
  
  for (const newProd of products) {
    const oldProd = oldData.products.find(p => p.id === newProd.id);
    
    let minPrice = 'N/A';
    if (newProd.tariffs) {
      const prices = newProd.tariffs.split('|').map(t => {
        const price = t.split('=')[1];
        return parseInt(price) || 0;
      });
      minPrice = Math.min(...prices);
    }
    
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
  
  console.log('\n📋 PARAMÈTRES EXTRAITS:');
  console.log('  ✓ userId:', userId);
  console.log('  ✓ items:', items ? `${items.length} items` : 'undefined');
  console.log('  ✓ total:', total);
  console.log('  ✓ timeSlot:', timeSlot);
  console.log('  ✓ deliveryOption:', deliveryOption);
  
  if (!data.orderCounter) {
    data.orderCounter = 1000;
  }
  if (!data.firstNames) {
    data.firstNames = {};
  }
  
  const orderNumber = ++data.orderCounter;
  
  console.log(`\n📦 Nouvelle commande #${orderNumber} - userId: ${userId}`);
  
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
  
  let itemsText = items.map(item => {
    const itemPrice = (item.price * item.quantity).toFixed(2);
    return `• <b>${item.name}</b> - ${item.grams.toFixed(2)}g x${item.quantity} = ${itemPrice}€`;
  }).join('\n');
  
  const deliveryLabel = deliveryOption === 'sur_place' ? '🏪 Sur place' : '🚚 Livraison';
  
  const message = `<b>📦 Nouvelle commande #${orderNumber}</b>\n\n<b>👤 Client:</b> ${userName}\n\n<b>Articles:</b>\n${itemsText}\n\n<b>💰 Total:</b> ${total.toFixed(2)}€\n\n<b>⏰ Créneau:</b> ${timeSlot || 'Non spécifié'}\n<b>📍 Type:</b> ${deliveryLabel}`;
  
  console.log('\n📝 Message à envoyer:');
  console.log(message);
  
  try {
    console.log(`\n📤 Envoi à OWNER_TELEGRAM_ID: ${OWNER_TELEGRAM_ID}`);
    await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      chat_id: OWNER_TELEGRAM_ID,
      text: message,
      parse_mode: 'HTML'
    });
    console.log('✅ Commande notifiée au propriétaire');
    
    if (MY_TELEGRAM_ID && MY_TELEGRAM_ID !== OWNER_TELEGRAM_ID) {
      console.log(`📤 Envoi à MY_TELEGRAM_ID: ${MY_TELEGRAM_ID}`);
      await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
        chat_id: MY_TELEGRAM_ID,
        text: message,
        parse_mode: 'HTML'
      });
      console.log('✅ Commande notifiée aussi à toi');
    }
    
    saveData(data);
    await commitToGithub(`Commande #${orderNumber}`, data);
    
    console.log('✅ Commande notifiée avec succès');
    console.log('===== FIN COMMANDE =====\n');
    res.json({ success: true });
  } catch (err) {
    console.error('\n❌ ERREUR NOTIFICATION TELEGRAM:');
    console.error(`   Status: ${err.response?.status}`);
    console.error(`   Data: ${JSON.stringify(err.response?.data)}`);
    console.error(`   Message: ${err.message}`);
    
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
        const response = await axios.post(
          `https://api.telegram.org/bot${BOT_TOKEN}/getChat`,
          { chat_id: userId }
        );
        
        const userInfo = response.data.result;
        const firstName = userInfo.first_name || 'Unknown';
        const username = userInfo.username || null;
        
        data.firstNames = data.firstNames || {};
        data.usernames = data.usernames || {};
        
        let updated = false;
        
        if (!data.firstNames[userId] || data.firstNames[userId] === 'Unknown') {
          data.firstNames[userId] = firstName;
          console.log(`✅ ${userId}: firstName = "${firstName}"`);
          updated = true;
        }
        
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
      
      console.log(`\n📱 /START REÇU`);
      console.log(`  userId: ${userId}`);
      console.log(`  userName: ${userName}`);
      console.log(`  firstName: ${firstName}`);
      
      // Vérifier si le user est dans le canal
      console.log(`\n🔍 Vérification adhésion canal...`);
      const isMember = await isChannelMember(userId);
      
      if (!isMember) {
        console.log(`\n❌ ${userName} n'est PAS membre du canal`);
        return ctx.reply(
          '❌ Tu dois rejoindre le canal pour accéder à la boutique.\n\n🔗 Clique ci-dessous :',
          {
            reply_markup: {
              inline_keyboard: [[
                {
                  text: '📱 Rejoindre le canal',
                  url: `https://t.me/${CHANNEL_USERNAME}`
                }
              ]]
            }
          }
        );
      }
      
      console.log(`\n✅ ${userName} EST membre du canal`);
      
      // Ajouter l'utilisateur à la liste
      if (!data.telegram_users.includes(userId)) {
        data.telegram_users.push(userId);
      }
      data.usernames = data.usernames || {};
      data.usernames[userId] = userName;
      data.firstNames = data.firstNames || {};
      data.firstNames[userId] = firstName;
      saveData(data);
      
      // Créer le lien simple vers le shop
      const link = `${SITE_URL}?userId=${userId}`;
      console.log(`📍 Lien WebApp: ${link}\n`);
      
      const welcomeMsg = `✅ Bienvenue @${userName} ! 🎉\n\nTu es autorisé à accéder à la boutique SVR 🛍️`;
      
      console.log(`📤 Envoi du message avec bouton WebApp...`);
      return ctx.reply(welcomeMsg, {
        reply_markup: {
          inline_keyboard: [[
            {
              text: '🛍️ Ouvrir la boutique',
              web_app: {
                url: link
              }
            }
          ]]
        }
      });
    } catch (err) {
      console.error('\n❌ ERREUR /START:');
      console.error('   Message:', err.message);
      console.error('   Stack:', err.stack);
      ctx.reply('❌ Erreur. Réessaie.');
    }
  });
  
  // ✅ COMMANDE /shop
  bot.command('shop', async (ctx) => {
    try {
      const userId = ctx.from.id;
      
      console.log(`\n📱 /SHOP REÇU`);
      console.log(`  userId: ${userId}`);
      
      // Vérifier si le user est dans le canal
      console.log(`🔍 Vérification adhésion canal...`);
      const isMember = await isChannelMember(userId);
      if (!isMember) {
        console.log(`❌ ${userId} n'est PAS membre du canal\n`);
        return ctx.reply(
          '❌ Tu dois rejoindre le canal pour accéder à la boutique.\n\n🔗 Clique ci-dessous :',
          {
            reply_markup: {
              inline_keyboard: [[
                {
                  text: '📱 Rejoindre le canal',
                  url: `https://t.me/${CHANNEL_USERNAME}`
                }
              ]]
            }
          }
        );
      }
      
      console.log(`✅ ${userId} EST membre du canal`);
      
      const link = `${SITE_URL}?userId=${userId}`;
      console.log(`📍 Lien WebApp: ${link}\n`);
      console.log(`📤 Envoi du message avec bouton WebApp...`);
      
      return ctx.reply('Ouvre la boutique 🛍️', {
        reply_markup: {
          inline_keyboard: [[
            {
              text: '🛍️ Boutique',
              web_app: {
                url: link
              }
            }
          ]]
        }
      });
    } catch (err) {
      console.error('\n❌ ERREUR /SHOP:');
      console.error('   Message:', err.message);
      ctx.reply('❌ Erreur. Réessaie.');
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

// ==================== LANCEMENT SERVEUR ====================

app.listen(PORT, () => {
  console.log(`\n🚀 Serveur port ${PORT}`);
  console.log(`✅ BOT_TOKEN: ${BOT_TOKEN ? 'OK' : '❌ MANQUANT'}`);
  console.log(`✅ CHANNEL_ID: ${CHANNEL_ID ? 'OK' : '❌ MANQUANT'}`);
  console.log(`✅ CHANNEL_USERNAME: ${CHANNEL_USERNAME ? CHANNEL_USERNAME : '❌ MANQUANT (défaut: SVR_TOV)'}`);
  console.log(`✅ OWNER_ID: ${OWNER_TELEGRAM_ID ? 'OK' : '❌ MANQUANT'}`);
  console.log(`✅ MY_ID: ${MY_TELEGRAM_ID ? 'OK' : '❌ MANQUANT'}`);
  console.log(`✅ CLOUDINARY: ${process.env.CLOUDINARY_CLOUD_NAME ? 'OK' : '❌ MANQUANT'}`);
  console.log(`✅ SITE_URL: ${SITE_URL}\n`);
});
