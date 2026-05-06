const express = require('express');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { Telegraf } = require('telegraf');
const notificationService = require('./notificationService');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, 'data.json');
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHANNEL_ID = process.env.CHANNEL_ID;
const OWNER_TELEGRAM_ID = process.env.OWNER_TELEGRAM_ID;
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_REPO = 'z2j7phmfkx-maker/svr-shop';

app.use(express.json());
app.use(express.static('public'));

// Charger data.json
function loadData() {
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch (e) {
    console.error('Erreur lecture data.json:', e);
    return { products: [], shop_settings: {}, telegram_users: [], userTokens: {} };
  }
}

// Sauvegarder data.json
function saveData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

// Commit sur GitHub
async function commitToGithub(message) {
  try {
    const data = fs.readFileSync(DATA_FILE, 'utf8');
    const content = Buffer.from(data).toString('base64');
    
    const response = await axios.get(
      `https://api.github.com/repos/${GITHUB_REPO}/contents/data.json`,
      { headers: { Authorization: `token ${GITHUB_TOKEN}` } }
    );

    await axios.put(
      `https://api.github.com/repos/${GITHUB_REPO}/contents/data.json`,
      {
        message: message,
        content: content,
        sha: response.data.sha,
        branch: 'main'
      },
      { headers: { Authorization: `token ${GITHUB_TOKEN}` } }
    );

    console.log(`✅ Commit GitHub: ${message}`);
  } catch (error) {
    console.error('❌ Erreur commit GitHub:', error.message);
  }
}

// Vérifier si l'utilisateur est membre du channel
async function isChannelMember(userId) {
  try {
    const member = await axios.get(
      `https://api.telegram.org/bot${BOT_TOKEN}/getChatMember`,
      { params: { chat_id: CHANNEL_ID, user_id: userId } }
    );
    return member.data.ok;
  } catch (error) {
    console.error('Erreur vérification channel:', error);
    return false;
  }
}

// Générer un token unique
function generateToken() {
  return 'svr_' + Math.random().toString(36).substring(2, 15);
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

// Vérifier un token
app.post('/api/verify-token', async (req, res) => {
  const { token } = req.body;
  const data = loadData();

  if (data.userTokens[token]) {
    const userId = data.userTokens[token];
    return res.json({ valid: true, userId });
  }

  res.json({ valid: false });
});

// Générer un token
app.post('/api/generate-token', async (req, res) => {
  const { userId } = req.body;
  const isMember = await isChannelMember(userId);

  if (!isMember) {
    return res.status(403).json({ error: 'Utilisateur non membre du channel' });
  }

  const token = generateToken();
  const data = loadData();
  data.userTokens[token] = userId;
  saveData(data);
  
  await commitToGithub(`Nouveau token généré pour utilisateur ${userId}`);

  res.json({ token });
});

// Sauvegarder les données (produits, paramètres)
app.post('/api/save-data', async (req, res) => {
  const newData = req.body;
  const oldData = loadData();

  saveData(newData);
  await commitToGithub('Mise à jour boutique (produits/paramètres)');

  // Vérifier les changements et notifier
  if (newData.products && oldData.products) {
    for (const newProduct of newData.products) {
      const oldProduct = oldData.products.find(p => p.id === newProduct.id);

      // Nouveau produit
      if (!oldProduct) {
        const price = newProduct.tariffs?.split('|')[0]?.split('=')[1] || 'N/A';
        await notificationService.notifyNewProduct(newProduct.name, price, newProduct.category);
      }

      // Produit en rupture
      if (oldProduct && oldProduct.stock !== 'Rupture de stock' && newProduct.stock === 'Rupture de stock') {
        await notificationService.notifyOutOfStock(newProduct.name);
      }

      // Stock limité
      if (oldProduct && oldProduct.stock !== 'Stock limité' && newProduct.stock === 'Stock limité') {
        const price = newProduct.tariffs?.split('|')[0]?.split('=')[1] || 'N/A';
        await notificationService.notifyLimitedStock(newProduct.name, price);
      }

      // Retour en stock
      if (oldProduct && oldProduct.stock === 'Rupture de stock' && newProduct.stock === 'En stock') {
        const price = newProduct.tariffs?.split('|')[0]?.split('=')[1] || 'N/A';
        await notificationService.notifyBackInStock(newProduct.name, price);
      }
    }
  }

  res.json({ success: true });
});

// Recevoir une commande
app.post('/api/order', async (req, res) => {
  try {
    const order = req.body;
    
    // Récupérer le username du client
    let username = 'Utilisateur inconnu';
    try {
      const userInfo = await axios.get(
        `https://api.telegram.org/bot${BOT_TOKEN}/getChat?chat_id=${order.userId}`
      );
      username = userInfo.data.result.username || userInfo.data.result.first_name || 'Utilisateur';
    } catch (e) {
      console.log('Impossible de récupérer le username');
    }

    // Formater les articles
    const items = order.items.map(item => 
      `<b>${item.name}</b>\n  ${item.size} x${item.quantity} = ${(item.price * item.quantity).toFixed(2)}€`
    ).join('\n');

    // Message pour le propriétaire
    const message = `
📦 <b>NOUVELLE COMMANDE !</b>

${items}

💰 <b>Total : ${order.total.toFixed(2)}€</b>

👤 <b>Client :</b> @${username}
⏰ <b>Heure :</b> ${new Date(order.timestamp).toLocaleString('fr-FR')}
⚠️ <i>Prépare la commande et contacte le client</i>
    `;

    // Envoyer notification Telegram au propriétaire
    await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      chat_id: OWNER_TELEGRAM_ID,
      text: message,
      parse_mode: 'HTML'
    });

    res.json({ success: true, message: 'Commande reçue et notification envoyée' });
  } catch (error) {
    console.error('Erreur commande:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// Bot Telegram
let bot;
if (BOT_TOKEN) {
  bot = new Telegraf(BOT_TOKEN);

  bot.on('message', async (ctx) => {
    const userId = ctx.chat.id;
    const username = ctx.chat.username || ctx.chat.first_name || 'Utilisateur';
    const data = loadData();

    // Vérifier si l'utilisateur est membre du canal
    const isMember = await isChannelMember(userId);
    
    if (!isMember) {
      ctx.reply('❌ Tu n\'es pas membre du canal. Rejoins-le d\'abord ! 👍');
      return;
    }

    let isNewUser = false;

    // Ajouter l'utilisateur à la liste de notifications s'il n'y est pas
    if (!data.telegram_users.includes(userId)) {
      data.telegram_users.push(userId);
      isNewUser = true;
    }

    // Vérifier si l'utilisateur a déjà un token
    let token = Object.keys(data.userTokens).find(t => data.userTokens[t] === userId);
    
    if (!token) {
      // Générer un token UNIQUE pour cet utilisateur (une seule fois)
      token = generateToken();
      data.userTokens[token] = userId;
      isNewUser = true;
    }

    saveData(data);
    await commitToGithub(`Utilisateur ${username} (${userId}) affilié au token ${token}`);

    // Lien sécurisé avec token
    const shopLink = `https://svr-shop.onrender.com?token=${token}`;

    if (isNewUser) {
      console.log(`✅ Nouvel utilisateur enregistré : ${username} (${userId}) - Token: ${token}`);

      // Message de bienvenue avec lien sécurisé
      ctx.reply(`✅ Bienvenue @${username} !\n\nTu recevras maintenant :\n📢 Les horaires d'ouverture/fermeture\n✨ Les nouveaux produits\n⚠️ Les ruptures de stock\n🔥 Les offres limitées\n\n🔗 Voici ton lien personnel pour accéder à la boutique :\n${shopLink}\n\n⚠️ Ne le partage pas, il est unique à toi !`);
    } else {
      // Utilisateur existant - lui renvoyer son lien
      ctx.reply(`Voici ton lien d'accès à la boutique :\n${shopLink}\n\n⚠️ Ne le partage pas, il est unique à toi ! 👍`);
    }
  });

  bot.launch().catch(err => console.error('❌ Erreur bot Telegram:', err));
  console.log('✅ Bot Telegram lancé');
} else {
  console.warn('⚠️ TELEGRAM_BOT_TOKEN non défini - bot désactivé');
}

// Vérifier les horaires d'ouverture toutes les minutes
setInterval(() => {
  notificationService.checkShopHours();
}, 60000);

// Synchroniser les utilisateurs existants au démarrage
const data = loadData();
if (data.userTokens && Object.values(data.userTokens).length > 0) {
  const tokenUserIds = Object.values(data.userTokens);
  const newUsers = tokenUserIds.filter(id => !data.telegram_users.includes(id));
  
  if (newUsers.length > 0) {
    data.telegram_users.push(...newUsers);
    saveData(data);
    console.log(`✅ ${newUsers.length} utilisateurs synchronisés au démarrage`);
  }
}

// Démarrer le serveur
app.listen(PORT, () => {
  console.log(`🚀 Serveur démarré sur le port ${PORT}`);
});

process.on('SIGINT', () => {
  if (bot) bot.stop();
  process.exit();
});
