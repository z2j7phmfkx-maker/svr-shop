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
    shop_settings: {
      opening_time: '14:00',
      closing_time: '00:00',
      timezone: 'Europe/Paris'
    },
    lastHoursMessageId: null,
    lastHoursCheck: { opening: '', closing: '' }
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

// Initialiser les checks au démarrage
function initializeChecks() {
  console.log('\n🔄 === INITIALISATION DES CHECKS ===');
  const data = loadData();
  
  // Réinitialiser les flags
  if (!data.lastHoursCheck) {
    data.lastHoursCheck = { opening: '', closing: '' };
  } else {
    data.lastHoursCheck.opening = '';
    data.lastHoursCheck.closing = '';
  }
  
  data.lastHoursMessageId = null;
  
  saveData(data);
  console.log('✅ Checks réinitialisés - prêt pour les horaires\n');
}

// Envoyer un message au channel
async function notifyAllUsers(message) {
  const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
  const CHANNEL_ID = process.env.CHANNEL_ID;
  const TELEGRAM_API_URL = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}`;

  console.log('\n📤 === NOTIFYALLUSERS APPELÉE ===');
  console.log(`   BOT_TOKEN défini: ${TELEGRAM_BOT_TOKEN ? 'OUI' : '❌ NON'}`);
  console.log(`   CHANNEL_ID défini: ${CHANNEL_ID ? 'OUI' : '❌ NON'}`);
  console.log(`   CHANNEL_ID value: ${CHANNEL_ID}`);
  
  if (!CHANNEL_ID) {
    console.error('❌ CHANNEL_ID non défini - IMPOSSIBLE D\'ENVOYER');
    return;
  }

  if (!TELEGRAM_BOT_TOKEN) {
    console.error('❌ TELEGRAM_BOT_TOKEN non défini - IMPOSSIBLE D\'ENVOYER');
    return;
  }

  try {
    console.log(`   📝 Message à envoyer: ${message.substring(0, 50)}...`);
    console.log(`   📡 URL API: ${TELEGRAM_API_URL.substring(0, 40)}...`);
    
    const response = await axios.post(`${TELEGRAM_API_URL}/sendMessage`, {
      chat_id: CHANNEL_ID,
      text: message,
      parse_mode: 'HTML'
    });
    
    console.log(`   ✅ Notification envoyée au channel - Message ID: ${response.data.result.message_id}`);
  } catch (error) {
    console.error('❌ Erreur envoi channel:', {
      status: error.response?.status,
      description: error.response?.data?.description,
      message: error.message
    });
  }
}

// Vérifier les horaires d'ouverture/fermeture avec fuseau horaire Paris
async function checkShopHours() {
  const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
  const CHANNEL_ID = process.env.CHANNEL_ID;
  const TELEGRAM_API_URL = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}`;
  
  console.log('\n⏰ === CHECK SHOP HOURS LANCÉ ===');
  console.log(`   BOT_TOKEN: ${TELEGRAM_BOT_TOKEN ? '✅ OK' : '❌ UNDEFINED'}`);
  console.log(`   CHANNEL_ID: ${CHANNEL_ID ? '✅ OK (' + CHANNEL_ID + ')' : '❌ UNDEFINED'}`);
  
  const data = loadData();
  const settings = data.shop_settings || {};
  
  console.log(`   opening_time: ${settings.opening_time || '❌ UNDEFINED'}`);
  console.log(`   closing_time: ${settings.closing_time || '❌ UNDEFINED'}`);
  
  if (!settings.opening_time || !settings.closing_time) {
    console.log('⚠️ Horaires non configurés - STOP');
    return;
  }

  // ✅ Obtenir l'heure de Paris
  const formatter = new Intl.DateTimeFormat('fr-FR', {
    timeZone: 'Europe/Paris',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  });

  const parts = formatter.formatToParts(new Date());
  const hours = parts.find(p => p.type === 'hour')?.value || '00';
  const minutes = parts.find(p => p.type === 'minute')?.value || '00';
  const currentTime = `${hours}:${minutes}`;

  console.log(`\n   ⏰ Heure Paris: ${currentTime}`);
  console.log(`   🔔 Ouverture attendue: ${settings.opening_time}`);
  console.log(`   🌙 Fermeture attendue: ${settings.closing_time}`);

  // ✅ Initialiser lastHoursCheck s'il n'existe pas
  if (!data.lastHoursCheck) {
    console.log('   ⚠️ lastHoursCheck était null - INIT');
    data.lastHoursCheck = { opening: '', closing: '' };
  }

  const lastCheck = data.lastHoursCheck;
  console.log(`   📋 lastCheck.opening: "${lastCheck.opening}"`);
  console.log(`   📋 lastCheck.closing: "${lastCheck.closing}"`);

  // ========== MESSAGE D'OUVERTURE ==========
  console.log(`\n   📊 Check OUVERTURE:`);
  console.log(`      currentTime === opening_time: ${currentTime} === ${settings.opening_time} = ${currentTime === settings.opening_time}`);
  console.log(`      !lastCheck.opening: ${!lastCheck.opening}`);
  console.log(`      lastCheck.opening !== currentTime: ${lastCheck.opening} !== ${currentTime} = ${lastCheck.opening !== currentTime}`);
  
  if (currentTime === settings.opening_time && (!lastCheck.opening || lastCheck.opening !== currentTime)) {
    console.log(`\n🔔 ✅ CONDITION OUVERTURE VRAIE - ENVOI DU MESSAGE`);
    
    // Supprimer le message de fermeture précédent s'il existe
    if (data.lastHoursMessageId) {
      try {
        console.log(`   Tentative suppression ancien message (ID: ${data.lastHoursMessageId})`);
        await axios.post(`${TELEGRAM_API_URL}/deleteMessage`, {
          chat_id: CHANNEL_ID,
          message_id: data.lastHoursMessageId
        });
        console.log('   ✅ Message précédent supprimé');
      } catch (err) {
        if (err.response?.data?.description?.includes('message to delete not found')) {
          console.log('   ⚠️ Message déjà supprimé ou introuvable');
        } else {
          console.error('   ❌ Erreur suppression:', err.response?.data?.description || err.message);
        }
      }
    }

    // Envoyer le message d'ouverture
    const message = `🎉 <b>LA BOUTIQUE EST OUVERTE!</b> 🛍️\n\nTu peux passer ta commande de <b>2 manières</b> :\n\n1️⃣ En validant ton panier sur le site @svrshopbot\n2️⃣ Directement avec nous sur @SVR_TO\n\n⏰ Horaires: ${settings.opening_time} - ${settings.closing_time}`;
    
    try {
      console.log(`   📤 Envoi message d'ouverture...`);
      console.log(`   API_URL: ${TELEGRAM_API_URL}`);
      console.log(`   CHANNEL_ID: ${CHANNEL_ID}`);
      
      const response = await axios.post(`${TELEGRAM_API_URL}/sendMessage`, {
        chat_id: CHANNEL_ID,
        text: message,
        parse_mode: 'HTML'
      });
      
      console.log(`   ✅ Message d'ouverture envoyé avec succès!`);
      console.log(`   Message ID: ${response.data.result.message_id}`);
      
      data.lastHoursMessageId = response.data.result.message_id;
      data.lastHoursCheck.opening = currentTime;
      saveData(data);
      console.log(`   ✅ Données sauvegardées\n`);
    } catch (err) {
      console.error('   ❌ ERREUR ENVOI OUVERTURE:', {
        status: err.response?.status,
        description: err.response?.data?.description,
        parameters: err.response?.data?.parameters,
        message: err.message
      });
    }
  } else {
    console.log(`   ❌ Condition ouverture fausse - pas d'envoi`);
  }

  // ========== MESSAGE DE FERMETURE ==========
  console.log(`\n   📊 Check FERMETURE:`);
  console.log(`      currentTime === closing_time: ${currentTime} === ${settings.closing_time} = ${currentTime === settings.closing_time}`);
  console.log(`      !lastCheck.closing: ${!lastCheck.closing}`);
  console.log(`      lastCheck.closing !== currentTime: ${lastCheck.closing} !== ${currentTime} = ${lastCheck.closing !== currentTime}`);
  
  if (currentTime === settings.closing_time && (!lastCheck.closing || lastCheck.closing !== currentTime)) {
    console.log(`\n🔔 ✅ CONDITION FERMETURE VRAIE - ENVOI DU MESSAGE`);
    
    // Supprimer le message d'ouverture s'il existe
    if (data.lastHoursMessageId) {
      try {
        console.log(`   Tentative suppression message d'ouverture (ID: ${data.lastHoursMessageId})`);
        await axios.post(`${TELEGRAM_API_URL}/deleteMessage`, {
          chat_id: CHANNEL_ID,
          message_id: data.lastHoursMessageId
        });
        console.log('   ✅ Message d\'ouverture supprimé');
      } catch (err) {
        if (err.response?.data?.description?.includes('message to delete not found')) {
          console.log('   ⚠️ Message déjà supprimé ou introuvable');
        } else {
          console.error('   ❌ Erreur suppression:', err.response?.data?.description || err.message);
        }
      }
    }

    // Envoyer le message de fermeture
    const message = `🌙 <b>La boutique ferme maintenant !</b>\n\nRevenez demain pour continuer vos achats 😴`;
    
    try {
      console.log(`   📤 Envoi message de fermeture...`);
      console.log(`   API_URL: ${TELEGRAM_API_URL}`);
      console.log(`   CHANNEL_ID: ${CHANNEL_ID}`);
      
      const response = await axios.post(`${TELEGRAM_API_URL}/sendMessage`, {
        chat_id: CHANNEL_ID,
        text: message,
        parse_mode: 'HTML'
      });
      
      console.log(`   ✅ Message de fermeture envoyé avec succès!`);
      console.log(`   Message ID: ${response.data.result.message_id}`);
      
      data.lastHoursMessageId = response.data.result.message_id;
      data.lastHoursCheck.closing = currentTime;
      saveData(data);
      console.log(`   ✅ Données sauvegardées\n`);
    } catch (err) {
      console.error('   ❌ ERREUR ENVOI FERMETURE:', {
        status: err.response?.status,
        description: err.response?.data?.description,
        parameters: err.response?.data?.parameters,
        message: err.message
      });
    }
  } else {
    console.log(`   ❌ Condition fermeture fausse - pas d'envoi`);
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

// Initialiser au chargement du module
initializeChecks();

module.exports = {
  notifyAllUsers,
  checkShopHours,
  notifyOutOfStock,
  notifyNewProduct,
  notifyLimitedStock,
  notifyBackInStock,
  addUserToNotifications
};
