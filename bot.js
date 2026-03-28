const TelegramBot = require('node-telegram-bot-api');

const BOT_TOKEN = '8774455983:AAHkE3OlVnrfaZ6-ni3W4d4vL1YLUdtpufs';
const CHANNEL_ID = -1002988868011;
const SITE_URL = 'https://svr-shop.onrender.com';

const bot = new TelegramBot(BOT_TOKEN, { polling: true });

console.log('🤖 Bot Telegram démarré!');

// Configurer le menu principal
bot.setMyCommands([
  { command: 'start', description: 'Commencer' }
]);

// Commande /start - affiche le bouton
bot.onText(/\/start/, async (msg) => {
  const userId = msg.from.id;
  const userName = msg.from.username || msg.from.first_name;

  console.log(`📨 /start reçu de @${userName} (${userId})`);

  try {
    // Vérifier si l'utilisateur est dans le channel
    const member = await bot.getChatMember(CHANNEL_ID, userId);
    const isValidStatus = ['member', 'administrator', 'creator', 'restricted'].includes(member.status);

    if (!isValidStatus) {
      bot.sendMessage(userId, 
        'Acces Refusé\n\n' +
        'Pour accéder au shop SVR, tu dois rejoindre le channel @SVR_TO et envoyer tes vérifications:\n\n' +
        '1️⃣ Une pièce d\'identité (Carte ID)\n' +
        '2️⃣ Une vidéo: toi + ta carte + en disant SVR + date du jour\n' +
        '3️⃣ Dire de qui tu viens\n\n' +
        'Rejoins le channel: https://t.me/SVR_TO\n\n' +
        'Une fois validé, retape /start pour accéder au shop!'
      );
      console.log(`❌ @${userName} (${userId}) pas dans le channel`);
      return;
    }

    // Utilisateur dans le channel - afficher le bouton
    bot.sendMessage(userId,
      `Bienvenue ${userName}!\n\n` +
      `Tu es autorisé à accéder au shop SVR!`,
      {
        reply_markup: {
          inline_keyboard: [
            [
              {
                text: 'Ouvrir la boutique',
                callback_data: 'open_shop'
              }
            ]
          ]
        }
      }
    );

    console.log(`✅ Bouton affiché pour @${userName} (${userId})`);

  } catch (error) {
    console.error(`❌ Erreur pour @${userName}:`, error.message);
    
    bot.sendMessage(userId, 
      'Une erreur est survenue. Réessaie avec /start'
    );
  }
});

// Gestion du bouton "Ouvrir la boutique"
bot.on('callback_query', async (query) => {
  const userId = query.from.id;
  const userName = query.from.username || query.from.first_name;
  const queryId = query.id;

  if (query.data === 'open_shop') {
    console.log(`Bouton cliqué par @${userName} (${userId})`);

    try {
      // Vérifier que l'utilisateur est toujours dans le channel
      const member = await bot.getChatMember(CHANNEL_ID, userId);
      const isValidStatus = ['member', 'administrator', 'creator', 'restricted'].includes(member.status);

      if (!isValidStatus) {
        bot.answerCallbackQuery(queryId, {
          text: 'Tu n\'es plus dans le channel',
          show_alert: true
        });
        return;
      }

      // Générer un token via le serveur
      const response = await fetch('https://svr-shop.onrender.com/api/generate-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: userId })
      });

      const data = await response.json();

      if (!data.success) {
        bot.answerCallbackQuery(queryId, {
          text: 'Erreur de connexion',
          show_alert: true
        });
        return;
      }

      const token = data.token;
      const link = `${SITE_URL}?token=${token}&userId=${userId}`;

      // Envoyer le lien au utilisateur
      bot.sendMessage(userId, 
        `Ton lien d'accès au shop:\n\n${link}\n\nCe lien est personnel et unique!`
      );

      // Notification au bouton
      bot.answerCallbackQuery(queryId, {
        text: 'Lien envoyé!',
        show_alert: false
      });

      console.log(`✅ Token généré pour @${userName} (${userId})`);

    } catch (error) {
      console.error(`❌ Erreur pour @${userName}:`, error.message);
      bot.answerCallbackQuery(queryId, {
        text: 'Erreur serveur',
        show_alert: true
      });
    }
  }
});

// Gestion des erreurs
bot.on('polling_error', (error) => {
  console.error('❌ Polling error:', error);
});

console.log('🚀 Bot en attente de commandes...');
