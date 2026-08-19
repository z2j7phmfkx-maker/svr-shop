'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const express = require('express');
const helmet = require('helmet');
const { rateLimit } = require('express-rate-limit');
const multer = require('multer');
const { v2: cloudinary } = require('cloudinary');
const axios = require('axios');
const { Telegraf } = require('telegraf');
const { z } = require('zod');
const cron = require('node-cron');
const notifications = require('./notificationService');

const app = express();
const DATA_FILE = path.join(__dirname, 'data.json');
const PUBLIC_DIR = path.join(__dirname, 'public');
const PORT = Number(process.env.PORT || 10000);
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const AUTH_MAX_AGE = Number(process.env.TELEGRAM_AUTH_MAX_AGE_SECONDS || 900);
const allowedMediaHosts = new Set((process.env.ALLOWED_MEDIA_HOSTS || 'res.cloudinary.com').split(',').map(v => v.trim()).filter(Boolean));
const completedRequests = new Map();
const processingRequests = new Set();
let writeQueue = Promise.resolve();

function logSafeError(context, error) {
  console.error(context, {
    name: error?.name,
    code: error?.code,
    status: error?.response?.status,
    description: error?.response?.data?.description,
    message: error?.response?.data?.description || error?.message || 'Erreur inconnue'
  });
}

if (process.env.TRUST_PROXY) app.set('trust proxy', Number(process.env.TRUST_PROXY));

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

app.disable('x-powered-by');
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", 'https://telegram.org'],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:', 'https://res.cloudinary.com'],
      mediaSrc: ["'self'", 'https://res.cloudinary.com'],
      connectSrc: ["'self'"],
      objectSrc: ["'none'"],
      baseUri: ["'none'"],
      formAction: ["'self'"],
      frameAncestors: ['https://web.telegram.org', 'https://*.telegram.org']
    }
  },
  referrerPolicy: { policy: 'no-referrer' },
  hsts: { maxAge: 31_536_000, includeSubDomains: true }
}));
app.use(express.json({ limit: '100kb', strict: true }));
app.use(express.static(PUBLIC_DIR, { index: false, etag: true, maxAge: '1h', dotfiles: 'deny' }));

const apiLimiter = rateLimit({ windowMs: 60_000, limit: 120, standardHeaders: 'draft-8', legacyHeaders: false });
const orderLimiter = rateLimit({ windowMs: 10 * 60_000, limit: 8, standardHeaders: 'draft-8', legacyHeaders: false });
const adminLimiter = rateLimit({ windowMs: 15 * 60_000, limit: 30, standardHeaders: 'draft-8', legacyHeaders: false });
app.use('/api', apiLimiter);

function loadData() {
  const parsed = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  return {
    products: Array.isArray(parsed.products) ? parsed.products : [],
    shop_settings: parsed.shop_settings || {},
    concours: parsed.concours || {},
    orderCounter: Number.isSafeInteger(parsed.orderCounter) ? parsed.orderCounter : 1000
  };
}

function saveDataAtomic(data) {
  writeQueue = writeQueue.then(async () => {
    const temp = `${DATA_FILE}.${process.pid}.${crypto.randomUUID()}.tmp`;
    await fs.promises.writeFile(temp, `${JSON.stringify(data, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
    await fs.promises.rename(temp, DATA_FILE);
  });
  return writeQueue;
}

function safeEqualText(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function requireAdmin(req, res, next) {
  const expectedUser = process.env.ADMIN_USERNAME;
  const expectedPassword = process.env.ADMIN_PASSWORD;
  const authorization = req.get('authorization') || '';
  if (!expectedUser || !expectedPassword || !authorization.startsWith('Basic ')) {
    res.set('WWW-Authenticate', 'Basic realm="Administration", charset="UTF-8"');
    return res.status(401).send('Authentification requise');
  }

  let credentials;
  try { credentials = Buffer.from(authorization.slice(6), 'base64').toString('utf8'); }
  catch { return res.status(401).send('Authentification invalide'); }
  const separator = credentials.indexOf(':');
  const user = separator >= 0 ? credentials.slice(0, separator) : '';
  const password = separator >= 0 ? credentials.slice(separator + 1) : '';
  if (!safeEqualText(user, expectedUser) || !safeEqualText(password, expectedPassword)) {
    return res.status(401).send('Authentification invalide');
  }
  res.set('Cache-Control', 'no-store');
  next();
}

function verifyTelegramInitData(initData) {
  if (!BOT_TOKEN || typeof initData !== 'string' || initData.length > 8192) throw new Error('Authentification Telegram absente');
  const params = new URLSearchParams(initData);
  const receivedHash = params.get('hash');
  const authDate = Number(params.get('auth_date'));
  if (!receivedHash || !Number.isSafeInteger(authDate)) throw new Error('Authentification Telegram invalide');
  params.delete('hash');
  const dataCheckString = [...params.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join('\n');
  const secret = crypto.createHmac('sha256', 'WebAppData').update(BOT_TOKEN).digest();
  const expectedHash = crypto.createHmac('sha256', secret).update(dataCheckString).digest('hex');
  if (!safeEqualText(receivedHash, expectedHash)) throw new Error('Signature Telegram invalide');
  const age = Math.floor(Date.now() / 1000) - authDate;
  if (age < -30 || age > AUTH_MAX_AGE) throw new Error('Authentification Telegram expirée');
  let user;
  try { user = JSON.parse(params.get('user') || 'null'); } catch { user = null; }
  if (!user || !Number.isSafeInteger(user.id)) throw new Error('Utilisateur Telegram invalide');
  return user;
}

function requireTelegram(req, res, next) {
  try {
    req.telegramUser = verifyTelegramInitData(req.get('x-telegram-init-data') || '');
    next();
  } catch (error) {
    res.status(401).json({ success: false, error: error.message });
  }
}

async function isChannelMember(userId) {
  if (!process.env.CHANNEL_ID) return true;
  const response = await axios.post(
    `https://api.telegram.org/bot${BOT_TOKEN}/getChatMember`,
    { chat_id: process.env.CHANNEL_ID, user_id: userId },
    { timeout: 10_000 }
  );
  return ['member', 'administrator', 'creator'].includes(response.data?.result?.status);
}

function scheduleDailyMessages() {
  const chatId = process.env.SCHEDULED_CHAT_ID;
  if (!chatId) {
    console.warn('Messages programmés désactivés : SCHEDULED_CHAT_ID absent');
    return;
  }

  const schedule = (expression, message, name) => {
    cron.schedule(expression, async () => {
      try {
        await notifications.sendTelegramMessage(chatId, message);
        console.log(`Message programmé envoyé : ${name}`);
      } catch (error) {
        logSafeError(`Échec du message programmé : ${name}`, error);
      }
    }, {
      timezone: 'Europe/Paris',
      noOverlap: true,
      name
    });
  };

  schedule('0 14 * * *', 'La boutique est ouverte', 'ouverture-14h');
  schedule('0 0 * * *', 'La boutique est fermée', 'fermeture-minuit');
  console.log('Messages quotidiens programmés à 14:00 et 00:00 (Europe/Paris)');
}

function isAllowedMediaUrl(value) {
  if (value === '' || value == null) return true;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && allowedMediaHosts.has(url.hostname);
  } catch { return false; }
}

const productSchema = z.object({
  id: z.union([z.string().min(1).max(80), z.number().int().nonnegative()]),
  name: z.string().trim().min(1).max(120),
  category: z.enum(['WEED', 'HASH', 'EXTRA']),
  description: z.string().max(5000).default(''),
  tariffs: z.string().trim().min(3).max(1000),
  promoTariffs: z.string().max(1000).optional().default(''),
  stock: z.union([z.enum(['En stock', 'Stock limité', 'Rupture de stock']), z.number().int().nonnegative()]),
  image: z.string().refine(isAllowedMediaUrl, 'URL image interdite'),
  gallery: z.array(z.string().refine(isAllowedMediaUrl, 'URL galerie interdite')).max(20).default([]),
  videos: z.array(z.string().refine(isAllowedMediaUrl, 'URL vidéo interdite')).max(10).default([]),
  createdAt: z.string().max(60).optional(),
  tariffsLabel: z.string().max(20).optional(),
  allowCustomPrice: z.boolean().optional(),
  isNew: z.boolean().optional(),
  newUntil: z.string().max(20).optional()
}).strict();

const saveSchema = z.object({
  products: z.array(productSchema).max(500),
  shop_settings: z.object({
    opening_time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
    closing_time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
    closed_days: z.array(z.string().max(20)).max(7),
    timezone: z.string().max(80)
  }).strict(),
  concours: z.object({ description: z.string().max(10_000) }).strict().optional()
}).strict();

const orderSchema = z.object({
  items: z.array(z.object({
    productId: z.union([z.string().min(1).max(80), z.number().int().nonnegative()]),
    mode: z.literal('tariff'),
    size: z.number().positive().max(10_000),
    quantity: z.number().int().min(1).max(20)
  }).strict()).min(1).max(30),
  deliveryOption: z.enum(['sur_place', 'livraison']),
  timeSlot: z.enum(['14:00 - 15:00','15:00 - 16:00','16:00 - 17:00','17:00 - 18:00','18:00 - 19:00','19:00 - 20:00','20:00 - 21:00','21:00 - 22:00','22:00 - 23:00','23:00 - 00:00'])
}).strict();

function parseTariffs(product) {
  const parseNumericValue = value => Number.parseFloat(String(value ?? '').trim().replace(',', '.'));
  const promo = new Map();
  for (const entry of String(product.promoTariffs || '').split('|').filter(Boolean)) {
    const [rawSize, rawPrice] = entry.split('=');
    const size = parseNumericValue(rawSize);
    const price = parseNumericValue(rawPrice);
    if (size > 0 && price > 0) promo.set(size, price);
  }
  return String(product.tariffs).split('|').map(entry => {
    const [rawSize, rawPrice] = entry.split('=');
    const size = parseNumericValue(rawSize);
    const normalPrice = parseNumericValue(rawPrice);
    if (!(size > 0 && normalPrice > 0)) throw new Error(`Tarif invalide pour ${product.name}`);
    return { size, price: promo.get(size) || normalPrice };
  }).sort((a, b) => a.size - b.size);
}

function buildTrustedOrder(input, products) {
  const items = input.items.map(requested => {
    const product = products.find(p => String(p.id) === String(requested.productId));
    if (!product || product.stock === 'Rupture de stock' || product.stock === 0) throw new Error('Produit indisponible');
    const tariffs = parseTariffs(product);
    const tariff = tariffs.find(t => Math.abs(t.size - requested.size) < 0.0001);
    if (!tariff) throw new Error('Tarif inexistant');
    const price = tariff.price;
    const grams = tariff.size;
    return { id: product.id, name: product.name, category: product.category, price, grams, quantity: requested.quantity };
  });
  const total = items.reduce((sum, item) => sum + item.price * item.quantity, 0);
  if (input.deliveryOption === 'livraison' && total < 50) throw new Error('Minimum de livraison non atteint');
  return { items, total: Math.round(total * 100) / 100, deliveryOption: input.deliveryOption, timeSlot: input.timeSlot };
}

app.get('/', (_req, res) => res.sendFile(path.join(PUBLIC_DIR, 'index.html')));
app.get('/admin', adminLimiter, requireAdmin, (_req, res) => res.sendFile(path.join(PUBLIC_DIR, 'admin.html')));

app.get('/api/catalog', requireTelegram, (_req, res) => {
  const data = loadData();

  res.set('Cache-Control', 'private, no-store');

  res.json({
    products: data.products,
    shop_settings: data.shop_settings,
    concours: data.concours
  });
});
app.get('/api/admin/data', adminLimiter, requireAdmin, (_req, res) => res.json(loadData()));

app.put('/api/admin/data', adminLimiter, requireAdmin, async (req, res, next) => {
  try {
    const input = saveSchema.parse(req.body);
    const oldData = loadData();
    const nextData = { ...oldData, ...input };
    await saveDataAtomic(nextData);
    res.json({ success: true });
  } catch (error) { next(error); }
});

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024, files: 1, fields: 5 },
  fileFilter: (_req, file, cb) => cb(null, ['image/jpeg','image/png','image/webp','video/mp4','video/quicktime'].includes(file.mimetype))
});

app.post('/api/admin/upload', adminLimiter, requireAdmin, upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Fichier absent ou type interdit' });
    const result = await new Promise((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream({ folder: 'svr-shop', resource_type: 'auto' }, (error, value) => error ? reject(error) : resolve(value));
      stream.end(req.file.buffer);
    });
    res.json({ success: true, url: result.secure_url });
  } catch (error) { next(error); }
});

app.post('/api/order', orderLimiter, requireTelegram, async (req, res, next) => {
  let requestKey;
  try {
    const idempotencyKey = req.get('idempotency-key');
    if (!idempotencyKey || !/^[A-Za-z0-9_-]{16,100}$/.test(idempotencyKey)) return res.status(400).json({ error: 'Clé d’idempotence invalide' });
    requestKey = `${req.telegramUser.id}:${idempotencyKey}`;
    if (completedRequests.has(requestKey)) return res.json(completedRequests.get(requestKey));
    if (processingRequests.has(requestKey)) return res.status(409).json({ error: 'Commande déjà en cours' });
    processingRequests.add(requestKey);

    if (!await isChannelMember(req.telegramUser.id)) {
      processingRequests.delete(requestKey);
      return res.status(403).json({ error: 'Adhésion au canal requise' });
    }

    const input = orderSchema.parse(req.body);
    const data = loadData();
    const order = buildTrustedOrder(input, data.products);
    data.orderCounter += 1;
    const orderNumber = data.orderCounter;
    const e = notifications.escapeTelegramHtml;
    const itemsText = order.items.map(item => {
      const formattedQuantity = Number(item.grams).toString();
      const unit = item.category === 'WEED' || item.category === 'HASH' ? ' gr' : '';
      return `• <b>${e(item.name)}</b> — ${formattedQuantity}${unit} × ${item.quantity} = ${(item.price * item.quantity).toFixed(2)}€`;
    }).join('\n');
    const displayName = req.telegramUser.username ? `@${e(req.telegramUser.username)}` : e(req.telegramUser.first_name || `Utilisateur ${req.telegramUser.id}`);
    const delivery = order.deliveryOption === 'sur_place' ? 'Sur place' : 'Livraison';
    const message = `<b>📦 Commande #${orderNumber}</b>\n\n<b>Client :</b> ${displayName}\n<b>Articles :</b>\n${itemsText}\n\n<b>Total :</b> ${order.total.toFixed(2)}€\n<b>Créneau :</b> ${e(order.timeSlot)}\n<b>Type :</b> ${delivery}`;
    await notifications.sendTelegramMessage(process.env.OWNER_TELEGRAM_ID, message);
    if (process.env.MY_TELEGRAM_ID && process.env.MY_TELEGRAM_ID !== process.env.OWNER_TELEGRAM_ID) await notifications.sendTelegramMessage(process.env.MY_TELEGRAM_ID, message);
    await saveDataAtomic(data);
    const response = { success: true, orderNumber };
    completedRequests.set(requestKey, response);
    setTimeout(() => completedRequests.delete(requestKey), 30 * 60_000).unref();
    processingRequests.delete(requestKey);
    res.status(201).json(response);
  } catch (error) {
    if (requestKey) processingRequests.delete(requestKey);
    next(error);
  }
});

app.use((_req, res) => res.status(404).json({ error: 'Ressource introuvable' }));
app.use((error, _req, res, _next) => {
  logSafeError('Erreur HTTP', error);
  if (error instanceof z.ZodError) return res.status(400).json({ error: 'Données invalides', fields: error.issues.map(issue => ({ path: issue.path.join('.'), message: issue.message })) });
  if (error instanceof multer.MulterError) return res.status(400).json({ error: 'Upload invalide' });
  const safeErrors = new Set(['Produit indisponible','Tarif inexistant','Tarif invalide','Montant personnalisé interdit','Montant personnalisé hors limites','Minimum de livraison non atteint']);
  res.status(safeErrors.has(error.message) ? 400 : 500).json({ error: safeErrors.has(error.message) ? error.message : 'Erreur interne' });
});

let bot;
if (BOT_TOKEN) {
  bot = new Telegraf(BOT_TOKEN);
  const shopButton = { reply_markup: { inline_keyboard: [[{ text: '🛍️ Ouvrir la boutique', web_app: { url: process.env.SITE_URL } }]] } };
  bot.start(ctx => ctx.reply('Bienvenue. Ouvre la boutique avec le bouton sécurisé ci-dessous.', shopButton));
  bot.command('shop', ctx => ctx.reply('Ouvre la boutique.', shopButton));
  bot.catch(error => logSafeError('Erreur bot Telegram', error));
  bot.launch({ dropPendingUpdates: true }).catch(error => logSafeError('Démarrage bot impossible', error));
}

scheduleDailyMessages();

const server = app.listen(PORT, () => console.log(`Serveur démarré sur le port ${PORT}`));
function shutdown(signal) {
  console.log(`${signal}: arrêt en cours`);
  if (bot) bot.stop(signal);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.once('SIGTERM', () => shutdown('SIGTERM'));
process.once('SIGINT', () => shutdown('SIGINT'));
