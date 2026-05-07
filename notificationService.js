const axios = require('axios');
const fs = require('fs');
const path = require('path');

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHANNEL_ID = process.env.CHANNEL_ID;
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
    console.log('✅ data.json sauvegardé');
  } catch (error) {
    console.error('❌ Erreur sauvegarde:', error);
  }
}

// Envoyer un message au channel
async function notifyAllUsers(message) {
  if (!CHANNEL_ID) {
    console.error('❌ CHANNEL_ID non défini');
    return;
  }

  try {
    await axios.post(`${TELEGRAM_API_URL}/sendMessage`, {
      chat_id: CHANNEL_ID,
      text: message,
      parse_mode: 'HTML'
    });
    console.log(`✅ Notification envoyée au channel`);
  } catch (error) {
    console.error('❌ Erreur envoi channel:', error.message);
  }
}

// Vérifier les horaires d'ouverture/fermeture avec fuseau horaire Paris
async function checkShopHours() {
  const data = loadData();
  const settings = data.shop_settings || {};
  
  if (!settings.opening_time || !settings.closing_time) {
    return;
  }

  // Obtenir l'heure de Paris (Europe/Paris)
  const now = new Date();
  const parisTime = new Date(now.toLocaleString('fr-FR', { timeZone: 'Europe/Paris' }));
  
  const hours = String(parisTime.getHours()).padStart(2, '0');
  const minutes = String(parisTime.getMinutes()).padStart(2, '0');
  const currentTime = `${hours}:${minutes}`;

  console.log(`⏰ Heure Paris: ${currentTime} | Ouverture: ${settings.opening_time} | Fermeture: ${settings.closing_time}`);

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
    console.log(`✅ Utilisateur ${userId} ajouté`);
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
