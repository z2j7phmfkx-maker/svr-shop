'use strict';

const tg = window.Telegram?.WebApp;
if (tg) { tg.ready(); tg.expand(); }

const $ = id => document.getElementById(id);
let shopData = { products: [], concours: {}, shop_settings: {} };
let currentFilter = 'Tous';
let cart = [];
let currentProduct = null;
let selectedChoice = null;
let selectedDeliveryOption = null;
let selectedTimeSlot = null;

function safeMediaUrl(value) {
  try {
    const url = new URL(value, location.origin);
    return url.protocol === 'https:' && (url.origin === location.origin || url.hostname === 'res.cloudinary.com') ? url.href : '';
  } catch { return ''; }
}

function parseNumericValue(value) {
  return Number.parseFloat(String(value ?? '').trim().replace(',', '.'));
}

function parseTariffs(product) {
  const promotions = new Map();
  String(product.promoTariffs || '').split('|').filter(Boolean).forEach(entry => {
    const [rawSize, rawPrice] = entry.split('=');
    const size = parseNumericValue(rawSize);
    const price = parseNumericValue(rawPrice);
    if (size > 0 && price > 0) promotions.set(size, price);
  });
  return String(product.tariffs || '').split('|').map(entry => {
    const [rawSize, rawPrice] = entry.split('=');
    const size = parseNumericValue(rawSize);
    const normalPrice = parseNumericValue(rawPrice);
    return { size, normalPrice, price: promotions.get(size) || normalPrice, isPromo: promotions.has(size) };
  }).filter(t => t.size > 0 && t.price > 0).sort((a, b) => a.size - b.size);
}

function formatQuantity(product, quantity) {
  const formatted = Number(quantity).toString();
  if (product.category === 'WEED' || product.category === 'HASH') return `${formatted} gr`;
  return product.tariffsLabel ? `${formatted}${product.tariffsLabel}` : formatted;
}

function element(tag, options = {}, children = []) {
  const node = document.createElement(tag);
  if (options.className) node.className = options.className;
  if (options.text != null) node.textContent = String(options.text);
  if (options.src) node.src = safeMediaUrl(options.src);
  if (options.alt != null) node.alt = String(options.alt);
  if (options.disabled) node.disabled = true;
  for (const child of children) if (child) node.appendChild(child);
  return node;
}
function showTelegramOnlyPage() {
  document.body.replaceChildren();

  const container = document.createElement('main');
  container.className = 'telegram-only';

  const title = document.createElement('h1');
  title.textContent = 'Accès réservé';

  const message = document.createElement('p');
  message.textContent =
    'Cette boutique est uniquement accessible depuis le bot Telegram.';

  container.append(title, message);
  document.body.appendChild(container);
}

async function loadShop() {
  if (!tg?.initData) {
    showTelegramOnlyPage();
    return;
  }

  try {
    const response = await fetch('/api/catalog', {
      headers: {
        Accept: 'application/json',
        'X-Telegram-Init-Data': tg.initData
      },
      cache: 'no-store'
    });

    if (!response.ok) {
      throw new Error('Accès Telegram requis');
    }

    shopData = await response.json();

    $('concoursText').textContent =
      shopData.concours?.description || '';

    createFilters();
    loadProducts();
    restoreCart();
  } catch (error) {
    console.error(error);
    showTelegramOnlyPage();
  }
}

function createFilters() {
  const section = $('filterSection');
  section.replaceChildren();
  ['Tous', 'WEED', 'HASH', 'EXTRA'].forEach(category => {
    const button = element('button', { className: `filter-btn${category === currentFilter ? ' active' : ''}`, text: category });
    button.addEventListener('click', () => { currentFilter = category; createFilters(); loadProducts(); });
    section.appendChild(button);
  });
}

function badge(text, type) { return element('span', { className: `badge badge-${type}`, text }); }

function loadProducts() {
  const grid = $('productsGrid');
  grid.replaceChildren();
  const products = shopData.products.filter(p => currentFilter === 'Tous' || p.category === currentFilter);
  for (const product of products) {
    const card = element('article', { className: 'product-card' });
    const image = element('img', { className: 'product-image', src: product.image, alt: product.name });
    image.loading = 'lazy';
    const info = element('div', { className: 'product-info' });
    info.appendChild(element('div', { className: 'product-name', text: product.name }));
    const badges = element('div', { className: 'product-badges' });
    if (product.isNew && product.newUntil && new Date().toISOString().slice(0, 10) <= product.newUntil) badges.appendChild(badge('✨ NOUVEAU', 'new'));
    if (product.promoTariffs) badges.appendChild(badge('🏷️ PROMO', 'promo'));
    if (product.stock === 'Stock limité') badges.appendChild(badge('⚠️ STOCK LIMITÉ', 'stock'));
    if (product.stock === 'Rupture de stock' || product.stock === 0) badges.appendChild(badge('❌ RUPTURE', 'rupture'));
    info.appendChild(badges);
    const firstTariff = parseTariffs(product)[0];
    const price = element('div', { className: 'product-price', text: 'À partir de ' });
    price.appendChild(element('span', { text: firstTariff ? `${firstTariff.price.toFixed(2)}€` : 'N/A' }));
    info.appendChild(price);
    const unavailable = product.stock === 'Rupture de stock' || product.stock === 0;
    const add = element('button', { className: 'btn-add-cart', text: unavailable ? 'Rupture' : 'Ajouter au panier 🛒', disabled: unavailable });
    add.addEventListener('click', event => { event.stopPropagation(); openAddCartModal(product); });
    info.appendChild(add);
    card.append(image, info);
    card.addEventListener('click', () => openProductModal(product));
    grid.appendChild(card);
  }
  if (!products.length) grid.appendChild(element('div', { text: 'Aucun produit trouvé' }));
}

function openAddCartModal(product) {
  currentProduct = product;
  selectedChoice = null;
  $('addCartProductName').textContent = product.name;
  $('addCartProductImage').src = safeMediaUrl(product.image);
  const buttons = $('quantityButtons');
  buttons.replaceChildren();
  for (const tariff of parseTariffs(product)) {
    const label = formatQuantity(product, tariff.size);
    const button = element('button', { className: 'quantity-btn', text: `${label} - ${tariff.price.toFixed(2)}€${tariff.isPromo ? ' (promo)' : ''}` });
    button.addEventListener('click', () => {
      buttons.querySelectorAll('button').forEach(b => b.classList.remove('selected'));
      button.classList.add('selected');
      selectedChoice = { mode: 'tariff', size: tariff.size, price: tariff.price, grams: tariff.size };
    });
    buttons.appendChild(button);
  }
  $('modalAddCart').classList.add('active');
}

function closeAddCartModal() { $('modalAddCart').classList.remove('active'); currentProduct = null; selectedChoice = null; }

function confirmAddToCart() {
  if (!currentProduct || !selectedChoice) return alert('Sélectionne une quantité ou un montant.');
  const key = `${currentProduct.id}:${selectedChoice.mode}:${selectedChoice.size || selectedChoice.amount}`;
  const existing = cart.find(item => item.key === key);
  if (existing) existing.quantity += 1;
  else cart.push({ key, productId: currentProduct.id, name: currentProduct.name, category: currentProduct.category, ...selectedChoice, quantity: 1 });
  updateCart();
  closeAddCartModal();
}

function restoreCart() {
  try {
    const parsed = JSON.parse(sessionStorage.getItem('cart') || '[]');
    if (Array.isArray(parsed)) cart = parsed.filter(item => item && item.productId != null && Number.isInteger(item.quantity) && item.quantity > 0 && item.quantity <= 20);
  } catch { cart = []; }
  updateCart();
}

function updateCart() {
  const container = $('cartItems');
  container.replaceChildren();
  let total = 0;
  let count = 0;
  cart.forEach((item, index) => {
    total += item.price * item.quantity;
    count += item.quantity;
    const box = element('div', { className: 'cart-item' });
    box.appendChild(element('div', { className: 'cart-item-name', text: item.name }));
    const product = shopData.products.find(candidate => String(candidate.id) === String(item.productId)) || item;
    box.appendChild(element('div', { className: 'cart-item-details', text: `${formatQuantity(product, item.grams)} - ${item.price.toFixed(2)}€` }));
    const row = element('div', { className: 'cart-item-quantity' });
    const minus = element('button', { text: '−' });
    const plus = element('button', { text: '+' });
    minus.addEventListener('click', () => { item.quantity > 1 ? item.quantity-- : cart.splice(index, 1); updateCart(); });
    plus.addEventListener('click', () => { if (item.quantity < 20) item.quantity++; updateCart(); });
    row.append(minus, element('span', { text: `${item.quantity}x` }), plus, element('span', { text: `${(item.price * item.quantity).toFixed(2)}€` }));
    box.appendChild(row);
    const remove = element('button', { className: 'cart-item-remove', text: 'Supprimer ✕' });
    remove.addEventListener('click', () => { cart.splice(index, 1); updateCart(); });
    box.appendChild(remove);
    container.appendChild(box);
  });
  $('cartCount').textContent = count;
  $('cartTotal').textContent = `${total.toFixed(2)}€`;
  sessionStorage.setItem('cart', JSON.stringify(cart));
}

function openDeliveryModal() {
  if (!cart.length) return alert('Ton panier est vide.');
  if (!tg?.initData) return alert('Ouvre la boutique depuis Telegram pour commander.');
  selectedDeliveryOption = null;
  const total = cart.reduce((sum, item) => sum + item.price * item.quantity, 0);
  const container = $('deliveryOptionsContainer');
  container.replaceChildren();
  $('deliveryWarning').replaceChildren();
  for (const option of [{ label: '🏪 Sur place', value: 'sur_place' }, { label: '🚚 Livraison (min. 50€)', value: 'livraison' }]) {
    const disabled = option.value === 'livraison' && total < 50;
    const button = element('button', { className: 'quantity-btn', text: option.label, disabled });
    button.addEventListener('click', () => {
      container.querySelectorAll('button').forEach(b => b.classList.remove('selected'));
      button.classList.add('selected');
      selectedDeliveryOption = option.value;
    });
    container.appendChild(button);
  }
  if (total < 50) $('deliveryWarning').appendChild(element('div', { className: 'warning-message', text: `Livraison disponible à partir de 50€ (actuellement ${total.toFixed(2)}€).` }));
  $('deliveryModal').classList.add('active');
}

function closeDeliveryModal() { $('deliveryModal').classList.remove('active'); selectedDeliveryOption = null; }
function openTimeSlots() {
  if (!selectedDeliveryOption) return alert('Sélectionne une option.');
  $('deliveryModal').classList.remove('active');
  const slots = ['14:00 - 15:00','15:00 - 16:00','16:00 - 17:00','17:00 - 18:00','18:00 - 19:00','19:00 - 20:00','20:00 - 21:00','21:00 - 22:00','22:00 - 23:00','23:00 - 00:00'];
  const container = $('timeSlotsContainer');
  container.replaceChildren();
  slots.forEach(slot => {
    const button = element('button', { className: 'quantity-btn', text: slot });
    button.addEventListener('click', () => { container.querySelectorAll('button').forEach(b => b.classList.remove('selected')); button.classList.add('selected'); selectedTimeSlot = slot; });
    container.appendChild(button);
  });
  $('timeSlotModal').classList.add('active');
}
function closeTimeSlots() { $('timeSlotModal').classList.remove('active'); selectedTimeSlot = null; }

async function submitOrder() {
  if (!selectedTimeSlot) return alert('Sélectionne un créneau.');
  $('loadingOverlay').classList.add('active');
  try {
    const items = cart.map(({ productId, size, quantity }) => ({ productId, mode: 'tariff', size, quantity }));
    const response = await fetch('/api/order', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Telegram-Init-Data': tg.initData, 'Idempotency-Key': crypto.randomUUID().replaceAll('-', '') },
      body: JSON.stringify({ items, deliveryOption: selectedDeliveryOption, timeSlot: selectedTimeSlot })
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Commande refusée');
    alert(`Commande #${result.orderNumber} reçue.`);
    cart = [];
    updateCart();
    closeTimeSlots();
    $('cartPanel').classList.remove('active');
  } catch (error) { alert(error.message); }
  finally { $('loadingOverlay').classList.remove('active'); }
}

function openProductModal(product) {
  $('modalTitle').textContent = product.name;
  $('modalDescription').textContent = product.description || 'Pas de description';
  $('modalMainImage').src = safeMediaUrl(product.image);
  const gallery = $('modalGallery');
  gallery.replaceChildren();
  [product.image, ...(product.gallery || [])].forEach(source => {
    const thumb = element('img', { className: 'gallery-thumb', src: source, alt: product.name });
    thumb.addEventListener('click', () => { $('modalMainImage').src = safeMediaUrl(source); });
    gallery.appendChild(thumb);
  });
  const tariffs = $('modalTariffs');
  tariffs.replaceChildren(element('strong', { text: 'Tarifs :' }));
  parseTariffs(product).forEach(t => tariffs.appendChild(element('div', { className: 'tariff-row', text: `${formatQuantity(product, t.size)} — ${t.price.toFixed(2)}€${t.isPromo ? ' (promo)' : ''}` })));
  const videos = $('modalVideos');
  videos.replaceChildren();
  (product.videos || []).forEach(source => {
    const video = element('video', { className: 'video-player' });
    video.controls = true;
    video.preload = 'metadata';
    video.src = safeMediaUrl(source);
    videos.appendChild(video);
  });
  $('productModal').classList.add('active');
}

$('concoursBanner').addEventListener('click', () => { $('concoursBanner').classList.toggle('expanded'); $('concoursText').classList.toggle('expanded'); $('concoursPreview').classList.toggle('hidden'); });
$('closeAddCartButton').addEventListener('click', closeAddCartModal);
$('cancelAddCartButton').addEventListener('click', closeAddCartModal);
$('confirmAddCartButton').addEventListener('click', confirmAddToCart);
$('openCartButton').addEventListener('click', () => $('cartPanel').classList.add('active'));
document.querySelector('.close-cart-btn').addEventListener('click', () => $('cartPanel').classList.remove('active'));
$('continueButton').addEventListener('click', () => $('cartPanel').classList.remove('active'));
$('checkoutButton').addEventListener('click', openDeliveryModal);
$('closeDeliveryButton').addEventListener('click', closeDeliveryModal);
$('cancelDeliveryButton').addEventListener('click', closeDeliveryModal);
$('confirmDeliveryButton').addEventListener('click', openTimeSlots);
$('closeTimeSlotButton').addEventListener('click', closeTimeSlots);
$('cancelTimeSlotButton').addEventListener('click', closeTimeSlots);
$('confirmTimeSlotButton').addEventListener('click', submitOrder);
$('closeProductButton').addEventListener('click', () => $('productModal').classList.remove('active'));
['modalAddCart','deliveryModal','timeSlotModal','productModal'].forEach(id => $(id).addEventListener('click', event => { if (event.target.id === id) event.target.classList.remove('active'); }));

loadShop();
