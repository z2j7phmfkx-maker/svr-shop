const TelegramBot = require('node-telegram-bot-api');

const BOT_TOKEN = '8774455983:AAHkE3OlVnrfaZ6-ni3W4d4vL1YLUdtpufs';
const CHANNEL_ID = -100298886801;
const SITE_URL = 'https://svr-shop.onrender.com';

const bot = new TelegramBot(BOT_TOKEN, { polling: true });

console.log('🤖 Bot Telegram démarré!');

// /start command
bot.onText(/\/start/, async (msg) => {
  const userId = msg.from.id;
  const userName = msg.from.username || msg.from.first_name;

  console.log(`📨 /start reçu de @${userName} (${userId})`);

  try {
    // Vérifier si l'utilisateur est dans le channel
    const member = await bot.getChatMember(CHANNEL_ID, userId);
    const isValidStatus = ['member', 'administrator', 'creator'].includes(member.status);

    if (!isValidStatus) {
      bot.sendMessage(userId, 
        '❌ Tu dois d\'abord rejoindre le channel @SVR_TO pour accéder au shop!\n\n' +
        '👉 Rejoins le channel: https://t.me/SVR_TO'
      );
      console.log(`❌ @${userName} pas dans le channel`);
      return;
    }

    // Générer un token via le serveur
    try {
      const response = await fetch('https://svr-shop.onrender.com/api/generate-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: userId })
      });

      const data = await response.json();

      if (!data.success) {
        bot.sendMessage(userId, '❌ Erreur lors de la génération du token. Réessaie plus tard.');
        console.error(`❌ Erreur token pour @${userName}:`, data.message);
        return;
      }

      const token = data.token;
      const link = `${SITE_URL}?token=${token}&userId=${userId}`;

      // Envoyer le lien au utilisateur
      bot.sendMessage(userId, 
        `✅ Bienvenue @${userName}!\n\n` +
        `🎁 Clique sur le lien ci-dessous pour accéder au shop SVR:\n\n` +
        `${link}\n\n` +
        `Ce lien est personnel et unique! 🔐`,
        { parse_mode: 'HTML' }
      );

      console.log(`✅ Token généré pour @${userName} (${userId})`);

    } catch (fetchError) {
      console.error(`❌ Erreur fetch pour @${userName}:`, fetchError.message);
      bot.sendMessage(userId, 
        '⚠️ Erreur de connexion au serveur. Réessaie plus tard avec /start'
      );
    }

  } catch (error) {
    console.error(`❌ Erreur pour @${userName}:`, error.message);
    
    bot.sendMessage(userId, 
      '⚠️ Une erreur est survenue. Assure-toi que:\n' +
      '1. Tu es dans le channel @SVR_TO\n' +
      '2. Le bot est admin du channel\n\n' +
      'Réessaie avec /start'
    );
  }
});

// Gestion des erreurs
bot.on('polling_error', (error) => {
  console.error('❌ Polling error:', error);
});

console.log('🚀 Bot en attente de commandes...');
