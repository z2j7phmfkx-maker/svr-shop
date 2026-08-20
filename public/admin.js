'use strict';

const $ = id => document.getElementById(id);
let state = {
  products: [],
  shop_settings: { opening_time: '14:00', closing_time: '00:00', closed_days: [], timezone: 'Europe/Paris' },
  concours: { active: false, description: '' }
};
let editingIndex = null;
let draggedIndex = null;

function node(tag, options = {}, children = []) {
  const element = document.createElement(tag);
  if (options.className) element.className = options.className;
  if (options.text != null) element.textContent = String(options.text);
  if (options.title) element.title = options.title;
  if (options.type) element.type = options.type;
  for (const child of children) if (child) element.appendChild(child);
  return element;
}

function showStatus(message, type = '') {
  $('status').textContent = message;
  $('status').className = `status ${type}`.trim();
}

function showToast(message) {
  const toast = $('toast');
  toast.textContent = message;
  toast.hidden = false;
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => { toast.hidden = true; }, 3200);
}

function setBusy(busy) {
  document.querySelectorAll('button').forEach(button => { button.disabled = busy; });
}

function parseNumber(value) {
  return Number.parseFloat(String(value ?? '').trim().replace(',', '.'));
}

function parseTariffs(product) {
  const promos = new Map();
  const costs = new Map();
  String(product.costTariffs || '').split('|').filter(Boolean).forEach(entry => {
    const [size, cost] = entry.split('=').map(parseNumber);
    if (size > 0 && cost > 0) costs.set(size, cost);
  });
  String(product.promoTariffs || '').split('|').filter(Boolean).forEach(entry => {
    const [size, price] = entry.split('=');
    const numericSize = parseNumber(size);
    const numericPrice = parseNumber(price);
    if (numericSize > 0 && numericPrice > 0) promos.set(numericSize, numericPrice);
  });

  return String(product.tariffs || '').split('|').filter(Boolean).map(entry => {
    const [size, price] = entry.split('=');
    const numericSize = parseNumber(size);
    return { size: numericSize, costPrice: costs.get(numericSize) || '', price: parseNumber(price), promoPrice: promos.get(numericSize) || '' };
  }).filter(row => row.size > 0 && row.price > 0);
}

function splitUrls(value) {
  return String(value || '').split('\n').map(item => item.trim()).filter(Boolean);
}

function safeImageUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' ? url.href : '';
  } catch { return ''; }
}

async function loadData() {
  setBusy(true);
  showStatus('Chargement…');
  try {
    const response = await fetch('/api/admin/data', { headers: { Accept: 'application/json' }, cache: 'no-store' });
    if (!response.ok) throw new Error('Chargement refusé');
    const data = await response.json();
    state = {
      products: Array.isArray(data.products) ? data.products : [],
      shop_settings: data.shop_settings || state.shop_settings,
      concours: { active: data.concours?.active === true, description: data.concours?.description || '' }
    };
    syncContestForm();
    renderProducts();
    await loadSummary();
    showStatus('Données à jour.', 'success');
  } catch (error) {
    showStatus(error.message, 'error');
  } finally {
    setBusy(false);
  }
}

function formatMoney(value) {
  return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(Number(value || 0));
}

async function loadSummary() {
  const response = await fetch('/api/admin/stats?period=week', { cache: 'no-store' });
  if (!response.ok) throw new Error('Statistiques indisponibles');
  const { summary } = await response.json();
  $('revenueToday').textContent = formatMoney(summary.today);
  $('revenueWeek').textContent = formatMoney(summary.week);
  $('revenueMonth').textContent = formatMoney(summary.month);
  $('revenueYear').textContent = formatMoney(summary.year);
}

async function saveData() {
  state.concours = {
    active: $('contestActive').checked,
    description: $('contestDescription').value.trim()
  };
  if (state.concours.active && !state.concours.description) {
    showStatus('Ajoute un texte au concours ou désactive-le.', 'error');
    return;
  }

  setBusy(true);
  showStatus('Enregistrement…');
  try {
    const response = await fetch('/api/admin/data', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ products: state.products, shop_settings: state.shop_settings, concours: state.concours })
    });
    const result = await response.json();
    if (!response.ok) {
      const field = result.fields?.[0];
      throw new Error(field ? `${field.path}: ${field.message}` : (result.error || 'Enregistrement refusé'));
    }
    showStatus('Toutes les modifications sont enregistrées.', 'success');
    showToast('✓ Boutique mise à jour');
  } catch (error) {
    showStatus(error.message, 'error');
  } finally {
    setBusy(false);
  }
}

function syncContestForm() {
  $('contestActive').checked = state.concours.active;
  $('contestDescription').value = state.concours.description;
  updateContestVisibility();
}

function updateContestVisibility() {
  const active = $('contestActive').checked;
  $('contestFields').hidden = !active;
  $('contestState').textContent = active ? 'Actif' : 'Inactif';
}

function pill(text, className = '') {
  return node('span', { className: `pill ${className}`.trim(), text });
}

function minimumPrice(product) {
  const rows = parseTariffs(product);
  if (!rows.length) return 'Tarif invalide';
  const prices = rows.map(row => Number(row.promoPrice) || row.price);
  return `Dès ${Math.min(...prices).toFixed(2)}€`;
}

function renderProducts() {
  const list = $('productList');
  list.replaceChildren();
  $('productCount').textContent = state.products.length;
  $('emptyProducts').hidden = state.products.length > 0;

  state.products.forEach((product, index) => {
    const card = node('article', { className: 'product-card' });
    card.draggable = true;
    card.dataset.index = index;

    const handle = node('span', { className: 'drag-handle', text: '⠿', title: 'Faire glisser' });
    const image = node('img', { className: 'product-thumb' });
    image.src = safeImageUrl(product.image);
    image.alt = '';
    image.addEventListener('error', () => { image.hidden = true; });

    const summary = node('div', { className: 'product-summary' });
    const nameBlock = node('div');
    nameBlock.appendChild(node('strong', { text: product.name }));
    const meta = node('div', { className: 'product-meta' });
    meta.append(pill(product.category));
    if (product.promoTariffs) meta.appendChild(pill('Promo', 'promo'));
    if (product.stock === 'Stock limité') meta.appendChild(pill(product.stockUnit === 'grams' ? 'Presque à sec' : 'Stock limité', product.stockUnit === 'grams' ? 'out' : 'limited'));
    if (product.stock === 'Rupture de stock') meta.appendChild(pill('Rupture', 'out'));
    nameBlock.appendChild(meta);
    summary.append(image, nameBlock);

    const statePill = pill(typeof product.stock === 'string' ? product.stock : `${product.stock} restant(s)`, product.stock === 'Rupture de stock' ? 'out' : (product.stock === 'Stock limité' ? 'limited' : ''));
    const priceCell = node('strong', { className: 'price-cell', text: minimumPrice(product) });

    const actions = node('div', { className: 'product-actions' });
    const up = actionButton('↑', 'Monter', () => moveProduct(index, index - 1));
    const down = actionButton('↓', 'Descendre', () => moveProduct(index, index + 1));
    up.disabled = index === 0;
    down.disabled = index === state.products.length - 1;
    const edit = actionButton('Modifier', 'Modifier', () => openProductDialog(index), 'button-secondary');
    const duplicate = actionButton('Dupliquer', 'Dupliquer', () => duplicateProduct(index), 'button-secondary');
    const remove = actionButton('Supprimer', 'Supprimer', () => removeProduct(index), 'button-danger');
    actions.append(up, down, edit, duplicate, remove);

    card.append(handle, summary, statePill, priceCell, actions);
    bindDragEvents(card);
    list.appendChild(card);
  });
}

function actionButton(text, title, handler, style = 'button-secondary') {
  const button = node('button', { className: `button button-small ${style}`, text, title, type: 'button' });
  button.addEventListener('click', handler);
  return button;
}

function moveProduct(from, to) {
  if (to < 0 || to >= state.products.length || from === to) return;
  const [product] = state.products.splice(from, 1);
  state.products.splice(to, 0, product);
  renderProducts();
  showStatus('Ordre modifié — pense à enregistrer.');
}

function bindDragEvents(card) {
  card.addEventListener('dragstart', () => {
    draggedIndex = Number(card.dataset.index);
    card.classList.add('dragging');
  });
  card.addEventListener('dragend', () => {
    draggedIndex = null;
    document.querySelectorAll('.product-card').forEach(item => item.classList.remove('dragging', 'drag-over'));
  });
  card.addEventListener('dragover', event => {
    event.preventDefault();
    card.classList.add('drag-over');
  });
  card.addEventListener('dragleave', () => card.classList.remove('drag-over'));
  card.addEventListener('drop', event => {
    event.preventDefault();
    const target = Number(card.dataset.index);
    if (draggedIndex != null && draggedIndex !== target) moveProduct(draggedIndex, target);
  });
}

function duplicateProduct(index) {
  const source = state.products[index];
  const copy = structuredClone(source);
  copy.id = Date.now();
  copy.name = `${source.name} — copie`;
  copy.createdAt = new Date().toISOString();
  state.products.splice(index + 1, 0, copy);
  renderProducts();
  openProductDialog(index + 1);
}

function removeProduct(index) {
  const product = state.products[index];
  if (!window.confirm(`Supprimer « ${product.name} » ?`)) return;
  state.products.splice(index, 1);
  renderProducts();
  showStatus('Produit supprimé — pense à enregistrer.');
}

function openProductDialog(index = null) {
  editingIndex = index;
  $('productForm').reset();
  $('tariffRows').replaceChildren();
  $('imagePreview').hidden = true;
  const product = index == null ? null : state.products[index];
  $('dialogTitle').textContent = product ? 'Modifier le produit' : 'Ajouter un produit';

  $('productName').value = product?.name || '';
  $('productCategory').value = product?.category || 'WEED';
  $('productStock').value = typeof product?.stock === 'string' ? product.stock : 'En stock';
  $('productStockUnit').value = product?.stockUnit || ((product?.category === 'WEED' || product?.category === 'HASH') ? 'grams' : 'units');
  $('productStockQuantity').value = Number.isFinite(product?.stockQuantity) ? product.stockQuantity : '';
  $('productDescription').value = product?.description || '';
  updateDescriptionCount();
  $('productImage').value = product?.image || '';
  $('productGallery').value = (product?.gallery || []).join('\n');
  $('productVideos').value = (product?.videos || []).join('\n');
  $('productIsNew').checked = product?.isNew === true;
  $('productNewUntil').value = product?.newUntil || '';
  $('productTariffsLabel').value = product?.tariffsLabel || '';
  updateNewUntilVisibility();
  updateImagePreview();

  const tariffs = product ? parseTariffs(product) : [];
  (tariffs.length ? tariffs : [{ size: '', price: '', promoPrice: '' }]).forEach(addTariffRow);
  $('productDialog').showModal();
  setTimeout(() => $('productName').focus(), 50);
}

function updateDescriptionCount() {
  $('descriptionCount').textContent = `${$('productDescription').value.length} / 5000`;
}

function insertDescriptionText(text) {
  const editor = $('productDescription');
  const start = editor.selectionStart;
  editor.setRangeText(text, start, editor.selectionEnd, 'end');
  editor.focus();
  updateDescriptionCount();
}

function closeProductDialog() {
  $('productDialog').close();
  editingIndex = null;
}

function addTariffRow(values = {}) {
  const row = node('div', { className: 'tariff-row' });
  const size = node('input');
  size.type = 'number'; size.min = '0.01'; size.step = '0.01'; size.required = true; size.placeholder = '2.5'; size.className = 'tariff-size'; size.value = values.size ?? '';
  const cost = node('input');
  cost.type = 'number'; cost.min = '0.01'; cost.step = '0.01'; cost.placeholder = 'À renseigner'; cost.className = 'tariff-cost'; cost.value = values.costPrice ?? '';
  const price = node('input');
  price.type = 'number'; price.min = '0.01'; price.step = '0.01'; price.required = true; price.placeholder = '20'; price.className = 'tariff-price'; price.value = values.price ?? '';
  const promo = node('input');
  promo.type = 'number'; promo.min = '0.01'; promo.step = '0.01'; promo.placeholder = 'Facultatif'; promo.className = 'tariff-promo promo-price'; promo.value = values.promoPrice ?? '';
  const remove = node('button', { className: 'icon-button', text: '×', title: 'Retirer ce tarif', type: 'button' });
  const margin = node('div', { className: 'tariff-margin' });
  function updateMargin() {
    const purchase = parseNumber(cost.value);
    const normalSale = parseNumber(price.value);
    const promoSale = parseNumber(promo.value);
    const sale = promoSale > 0 ? promoSale : normalSale;
    if (!(purchase > 0) || !(sale > 0)) { margin.textContent = 'Prix d’achat manquant'; return; }
    const amount = sale - purchase;
    const percentage = (amount / purchase) * 100;
    margin.replaceChildren(node('span', { text: `${amount.toFixed(2)} €` }), node('small', { text: `${percentage.toFixed(1)} %${promoSale > 0 ? ' (promo)' : ''}` }));
    margin.style.background = amount < 0 ? '#fff0f1' : '#eef9f3';
    margin.style.color = amount < 0 ? '#b42332' : '#168657';
  }
  [cost, price, promo].forEach(input => input.addEventListener('input', updateMargin));
  remove.addEventListener('click', () => {
    if ($('tariffRows').children.length === 1) return showToast('Au moins un tarif est obligatoire');
    row.remove();
  });
  row.append(size, cost, price, promo, margin, remove);
  $('tariffRows').appendChild(row);
  updateMargin();
}

function collectTariffs() {
  const rows = [...$('tariffRows').querySelectorAll('.tariff-row')].map(row => ({
    size: parseNumber(row.querySelector('.tariff-size').value),
    costPrice: parseNumber(row.querySelector('.tariff-cost').value),
    price: parseNumber(row.querySelector('.tariff-price').value),
    promoPrice: parseNumber(row.querySelector('.tariff-promo').value)
  }));
  if (!rows.length || rows.some(row => !(row.size > 0) || !(row.price > 0))) throw new Error('Chaque tarif doit avoir une quantité et un prix valides.');
  if (new Set(rows.map(row => row.size)).size !== rows.length) throw new Error('Une même quantité ne peut apparaître qu’une seule fois.');
  rows.sort((a, b) => a.size - b.size);
  return {
    tariffs: rows.map(row => `${row.size}=${row.price}`).join('|'),
    costTariffs: rows.filter(row => row.costPrice > 0).map(row => `${row.size}=${row.costPrice}`).join('|'),
    promoTariffs: rows.filter(row => row.promoPrice > 0).map(row => `${row.size}=${row.promoPrice}`).join('|')
  };
}

function saveProductFromForm(event) {
  event.preventDefault();
  try {
    const { tariffs, costTariffs, promoTariffs } = collectTariffs();
    const existing = editingIndex == null ? null : state.products[editingIndex];
    const product = {
      id: existing?.id ?? Date.now(),
      name: $('productName').value.trim(),
      category: $('productCategory').value,
      description: $('productDescription').value.trim(),
      tariffs,
      costTariffs,
      promoTariffs,
      stock: $('productStock').value,
      stockUnit: $('productStockUnit').value,
      stockQuantity: parseNumber($('productStockQuantity').value),
      image: $('productImage').value.trim(),
      gallery: splitUrls($('productGallery').value),
      videos: splitUrls($('productVideos').value),
      createdAt: existing?.createdAt || new Date().toISOString(),
      tariffsLabel: $('productTariffsLabel').value.trim(),
      allowCustomPrice: false,
      isNew: $('productIsNew').checked,
      newUntil: $('productIsNew').checked ? $('productNewUntil').value : ''
    };
    if (!product.name || !product.image) throw new Error('Le nom et la photo principale sont obligatoires.');
    const isNewProduct = editingIndex == null;
    if (isNewProduct) state.products.push(product);
    else state.products[editingIndex] = product;
    renderProducts();
    closeProductDialog();
    showStatus('Produit prêt — clique sur « Enregistrer » pour publier.');
    showToast(isNewProduct ? 'Produit ajouté' : 'Produit modifié');
  } catch (error) {
    showToast(error.message);
  }
}

function updateNewUntilVisibility() {
  $('newUntilField').hidden = !$('productIsNew').checked;
}

function updateImagePreview() {
  const preview = $('imagePreview');
  const source = safeImageUrl($('productImage').value);
  preview.hidden = !source;
  if (source) preview.src = source;
}

async function uploadFile(inputId) {
  const input = $(inputId);
  const file = input.files[0];
  if (!file) throw new Error('Choisis d’abord un fichier.');
  const body = new FormData();
  body.append('file', file);
  const response = await fetch('/api/admin/upload', { method: 'POST', body });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Upload refusé');
  input.value = '';
  return result.url;
}

async function runUpload(inputId, destinationId, append = false) {
  setBusy(true);
  try {
    const url = await uploadFile(inputId);
    const destination = $(destinationId);
    destination.value = append && destination.value.trim() ? `${destination.value.trim()}\n${url}` : url;
    if (destinationId === 'productImage') updateImagePreview();
    showToast('Média envoyé');
  } catch (error) {
    showToast(error.message);
  } finally {
    setBusy(false);
  }
}

$('contestActive').addEventListener('change', updateContestVisibility);
$('reloadButton').addEventListener('click', loadData);
$('saveButton').addEventListener('click', saveData);
$('addProductButton').addEventListener('click', () => openProductDialog());
$('closeDialogButton').addEventListener('click', closeProductDialog);
$('cancelProductButton').addEventListener('click', closeProductDialog);
$('productForm').addEventListener('submit', saveProductFromForm);
$('addTariffButton').addEventListener('click', () => addTariffRow());
$('productIsNew').addEventListener('change', updateNewUntilVisibility);
$('productImage').addEventListener('input', updateImagePreview);
$('productDescription').addEventListener('input', updateDescriptionCount);
document.querySelectorAll('[data-editor]').forEach(button => button.addEventListener('click', () => {
  insertDescriptionText(button.dataset.editor === 'bullet' ? '\n• ' : '\n');
}));
$('menuButton').addEventListener('click', () => $('sidebar').classList.toggle('open'));
$('uploadMainImageButton').addEventListener('click', () => runUpload('mainImageFile', 'productImage'));
$('uploadGalleryButton').addEventListener('click', () => runUpload('galleryFile', 'productGallery', true));
$('uploadVideoButton').addEventListener('click', () => runUpload('videoFile', 'productVideos', true));
$('productDialog').addEventListener('click', event => {
  if (event.target === $('productDialog')) closeProductDialog();
});

loadData();
