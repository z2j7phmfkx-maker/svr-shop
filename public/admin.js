'use strict';
const editor = document.getElementById('editor');
const status = document.getElementById('status');

function showStatus(message, type = '') {
  status.textContent = message;
  status.className = type;
}

async function loadData() {
  showStatus('Chargement…');
  const response = await fetch('/api/admin/data', { headers: { Accept: 'application/json' }, cache: 'no-store' });
  if (!response.ok) throw new Error('Chargement refusé');
  editor.value = JSON.stringify(await response.json(), null, 2);
  showStatus('Données chargées.', 'success');
}

async function saveData() {
  let data;
  try { data = JSON.parse(editor.value); }
  catch { return showStatus('Le JSON est invalide.', 'error'); }
  const response = await fetch('/api/admin/data', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ products: data.products, shop_settings: data.shop_settings, concours: data.concours }) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Enregistrement refusé');
  showStatus('Enregistrement terminé.', 'success');
  await loadData();
}

async function uploadFile() {
  const input = document.getElementById('fileInput');
  if (!input.files[0]) return showStatus('Choisis un fichier.', 'error');
  const body = new FormData();
  body.append('file', input.files[0]);
  const response = await fetch('/api/admin/upload', { method: 'POST', body });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Upload refusé');
  document.getElementById('uploadResult').textContent = result.url;
  showStatus('Média envoyé.', 'success');
}

async function run(action) {
  document.querySelectorAll('button').forEach(button => { button.disabled = true; });
  try { await action(); } catch (error) { showStatus(error.message, 'error'); }
  finally { document.querySelectorAll('button').forEach(button => { button.disabled = false; }); }
}

document.getElementById('reloadButton').addEventListener('click', () => run(loadData));
document.getElementById('saveButton').addEventListener('click', () => run(saveData));
document.getElementById('uploadButton').addEventListener('click', () => run(uploadFile));
run(loadData);
