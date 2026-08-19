const axios = require('axios');

function escapeTelegramHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

async function sendTelegramMessage(chatId, message) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token || !chatId) throw new Error('Configuration Telegram incomplète');

  const response = await axios.post(
    `https://api.telegram.org/bot${token}/sendMessage`,
    { chat_id: chatId, text: message, parse_mode: 'HTML' },
    { timeout: 10_000 }
  );

  return response.data.result;
}

async function deleteTelegramMessage(chatId, messageId) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token || !chatId || !messageId) return false;

  await axios.post(
    `https://api.telegram.org/bot${token}/deleteMessage`,
    { chat_id: chatId, message_id: messageId },
    { timeout: 10_000 }
  );

  return true;
}

async function notifyAllUsers(message) {
  await sendTelegramMessage(process.env.CHANNEL_ID, message);
}

async function notifyOutOfStock(productName) {
  await notifyAllUsers(`⚠️ <b>RUPTURE DE STOCK</b>\n\n<b>${escapeTelegramHtml(productName)}</b>`);
}

async function notifyNewProduct(productName, price, category) {
  const emoji = category === 'WEED' ? '🌿' : category === 'HASH' ? '🔶' : '⚡';
  await notifyAllUsers(`✨ <b>NOUVEAU PRODUIT</b>\n\n${emoji} <b>${escapeTelegramHtml(productName)}</b>\n💰 À partir de <b>${Number(price).toFixed(2)}€</b>`);
}

async function notifyLimitedStock(productName, price) {
  await notifyAllUsers(`⚠️ <b>STOCK LIMITÉ</b>\n\n<b>${escapeTelegramHtml(productName)}</b>\n💰 À partir de <b>${Number(price).toFixed(2)}€</b>`);
}

async function notifyBackInStock(productName, price) {
  await notifyAllUsers(`✅ <b>DE RETOUR EN STOCK</b>\n\n<b>${escapeTelegramHtml(productName)}</b>\n💰 À partir de <b>${Number(price).toFixed(2)}€</b>`);
}

module.exports = {
  escapeTelegramHtml,
  sendTelegramMessage,
  deleteTelegramMessage,
  notifyAllUsers,
  notifyOutOfStock,
  notifyNewProduct,
  notifyLimitedStock,
  notifyBackInStock
};
