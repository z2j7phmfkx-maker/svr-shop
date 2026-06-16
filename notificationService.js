const axios = require('axios');
const fs = require('fs');
const path = require('path');

const DATA_FILE = path.join(__dirname, 'data.json');

// Charger les données
function loadData() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    }
  } catch (error) {
    console.error('❌ Erreur lecture data.json:', error);
  }
  return {
    telegram_users: [],
    products: [],
    shop_settings: {},
    concours: {},
    orderCounter: 1000
  };
}

// Sauvegarder les données
function saveData(data) {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf8');
    console.log('   ✅ data.json sauvegardé');
  } catch (error) {
    console.error('❌ Erreur sauvegarde:', error);
  }
}

// Envoyer un message au channel
async function notifyAllUsers(message) {
  const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
  const CHANNEL_ID = process.env.CHANNEL_ID;
  const TELEGRAM_API_URL = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}`;

  if (!CHANNEL_ID) {
    console.error('❌ CHANNEL_ID non défini');
    return;
  }

  if (!TELEGRAM_BOT_TOKEN) {
    console.error('❌ TELEGRAM_BOT_TOKEN non défini');
    return;
  }

  try {
    console.log(`\n📤 Envoi notification: ${message.substring(0, 50)}...`);
    
    const response = await axios.post(`${TELEGRAM_API_URL}/sendMessage`, {
      chat_id: CHANNEL_ID,
      text: message,
      parse_mode: 'HTML'
    });
    
    console.log(`✅ Notification envoyée - Message ID: ${response.data.result.message_id}`);
  } catch (error) {
    console.error('❌ Erreur envoi:', {
      status: error.response?.status,
      description: error.response?.data?.description,
      message: error.message
    });
  }
}

// Notifier les produits en rupture
async function notifyOutOfStock(productName) {
  const message = `⚠️ <b>ATTENTION !</b>\n\n<b>${productName}</b> est maintenant en <b>RUPTURE DE STOCK</b> 😞\n\nN'hésite pas à revenir bientôt pour les autres produits !`;
  await notifyAllUsers(message);
}

// Notifier les nouveaux produits
async function notifyNewProduct(productName, price, category) {
  const emoji = category === 'WEED' ? '🌿' : category === 'HASH' ? '🔶' : '⚡';
  const message = `✨ <b>NOUVEAU PRODUIT !</b>\n\n${emoji} <b>${productName}</b>\n💰 À partir de <b>${price}€</b>`;
  await notifyAllUsers(message);
}

// Notifier les produits en stock limité
async function notifyLimitedStock(productName, price) {
  const message = `⚠️ <b>STOCK LIMITÉ !</b>\n\n<b>${productName}</b>\n💰 À partir de <b>${price}€</b>\n\n⏰ Dépêche-toi, il ne reste plus beaucoup ! 🏃`;
  await notifyAllUsers(message);
}

// Notifier quand un produit revient en stock
async function notifyBackInStock(productName, price) {
  const message = `✅ <b>DE RETOUR EN STOCK !</b>\n\n<b>${productName}</b>\n💰 À partir de <b>${price}€</b>\n\nC'est le moment de l'acheter ! 🎉`;
  await notifyAllUsers(message);
}

// Ajouter un utilisateur à la liste
function addUserToNotifications(userId) {
  const data = loadData();
  if (!data.telegram_users) data.telegram_users = [];
  
  if (!data.telegram_users.includes(userId)) {
    data.telegram_users.push(userId);
    saveData(data);
    console.log(`✅ Utilisateur ${userId} ajouté`);
  }
}

module.exports = {
  notifyAllUsers,
  notifyOutOfStock,
  notifyNewProduct,
  notifyLimitedStock,
  notifyBackInStock,
  addUserToNotifications,
  loadData
};
