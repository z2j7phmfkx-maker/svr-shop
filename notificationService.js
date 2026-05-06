const axios = require('axios');
const fs = require('fs');
const path = require('path');

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_API_URL = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}`;
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
  return { telegram_users: [], products: [], shop_settings: {} };
}

// Sauvegarder les données
function saveData(data) {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf8');
    console.log('✅ data.json sauvegardé via notificationService');
  } catch (error) {
    console.error('❌ Erreur sauvegarde data.json:', error);
  }
}

// Envoyer un message à tous les utilisateurs et nettoyer la liste
async function notifyAllUsers(message) {
  const data = loadData();
  let users = data.telegram_users || [];
  let validUsers = [];

  for (const userId of users) {
    try {
      await axios.post(`${TELEGRAM_API_URL}/sendMessage`, {
        chat_id: userId,
        text: message,
        parse_mode: 'HTML'
      });
      console.log(`✅ Message envoyé à ${userId}`);
      validUsers.push(userId);
    } catch (error) {
      if (error.response?.data?.description?.includes('user is') || 
          error.response?.data?.description?.includes('was kicked')) {
        console.log(`❌ Utilisateur ${userId} a quitté - suppression`);
      } else {
        console.error(`⚠️ Erreur envoi à ${userId}:`, error.message);
        validUsers.push(userId);
      }
    }
  }

  // Sauvegarder la liste nettoyée
  if (validUsers.length !== users.length) {
    data.telegram_users = validUsers;
    saveData(data);
    console.log(`📊 Liste nettoyée: ${validUsers.length} utilisateurs valides (${users.length - validUsers.length} supprimés)`);
  }
}

// Vérifier les horaires d'ouverture/fermeture
async function checkShopHours() {
  const data = loadData();
  const settings = data.shop_settings || {};
  
  if (!settings.opening_time || !settings.closing_time) {
    return; // Pas d'horaires configurés
  }

  const now = new Date();
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  const currentTime = `${hours}:${minutes}`;

  // Message d'ouverture
  if (currentTime === settings.opening_time) {
    const message = `🚀 <b>La boutique est maintenant OUVERTE !</b>\n\nHoraires : ${settings.opening_time} - ${settings.closing_time}\n\nDécouvre nos produits exclusifs ! 🌿💚`;
    await notifyAllUsers(message);
  }

  // Message de fermeture
  if (currentTime === settings.closing_time) {
    const message = `🌙 <b>La boutique ferme maintenant !</b>\n\nRevenez demain pour continuer vos achats 😴`;
    await notifyAllUsers(message);
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
  const message = `✨ <b>NOUVEAU PRODUIT !</b>\n\n${emoji} <b>${productName}</b>\n💰 À partir de <b>${price}€</b>\n\nClique vite avant que ça parte ! 🔥`;
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
    console.log(`✅ Utilisateur ${userId} ajouté aux notifications`);
  }
}

module.exports = {
  notifyAllUsers,
  checkShopHours,
  notifyOutOfStock,
  notifyNewProduct,
  notifyLimitedStock,
  notifyBackInStock,
  addUserToNotifications
};
