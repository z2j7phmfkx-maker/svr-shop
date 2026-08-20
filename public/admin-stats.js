'use strict';
const $ = id => document.getElementById(id);
let currentPeriod = 'week';
let catalog = [];
const money = value => new Intl.NumberFormat('fr-FR',{style:'currency',currency:'EUR'}).format(Number(value||0));
const text = value => document.createTextNode(String(value ?? ''));

async function loadStatistics() {
  $('status').textContent = 'Chargement des statistiques…';
  try {
    const response = await fetch(`/api/admin/stats?period=${currentPeriod}`, { cache: 'no-store' });
    if (!response.ok) throw new Error('Chargement refusé');
    const data = await response.json();
    $('status').textContent = '';
    $('financeRevenue').textContent = money(data.selectedSummary.revenue);
    $('financeMaterials').textContent = money(data.selectedSummary.materials);
    $('financeSalaries').textContent = money(data.selectedSummary.salaries);
    $('financeProfit').textContent = money(data.selectedSummary.netProfit);
    $('financeProfit').style.color = data.selectedSummary.netProfit < 0 ? '#dc3545' : '#149463';
    $('financePeriodLabel').textContent = currentPeriod === 'week' ? '7 derniers jours' : currentPeriod === 'month' ? '30 derniers jours' : '12 derniers mois';
    $('chartCaption').textContent = currentPeriod === 'week' ? 'Sur les 7 derniers jours' : currentPeriod === 'month' ? 'Sur les 30 derniers jours' : 'Sur les 12 derniers mois';
    renderChart(data.chart);
    renderOrders(data.orders);
    renderFinance(data.financeEntries);
  } catch (error) { $('status').textContent = error.message; $('status').className = 'status error'; }
}

function renderOrders(orders) {
  const body = $('ordersBody'); body.replaceChildren(); $('orderCount').textContent = orders.length;
  if (!orders.length) { const tr=document.createElement('tr'); const td=document.createElement('td'); td.colSpan=7; td.className='empty-table'; td.textContent='Aucune commande enregistrée pour cette période. Les prochaines apparaîtront ici.'; tr.append(td); body.append(tr); return; }
  orders.forEach(order => {
    const tr=document.createElement('tr');
    const username=order.telegramUser?.username ? `@${order.telegramUser.username}` : (order.telegramUser?.firstName || `ID ${order.telegramUser?.id || '—'}`);
    const cells=[new Date(order.createdAt).toLocaleString('fr-FR',{timeZone:'Europe/Paris'}),`#${order.id}`,username,order.items.map(item=>item.name).join(', '),order.items.map(item=>`${item.grams}${item.category==='WEED'||item.category==='HASH'?' gr':''} × ${item.quantity}`).join(', '),money(order.total),`${order.deliveryOption==='sur_place'?'Sur place':'Livraison'} · ${order.timeSlot}`];
    cells.forEach(value=>{const td=document.createElement('td');td.append(text(value));tr.append(td)}); body.append(tr);
  });
}

function renderFinance(entries) {
  const body=$('financeBody');body.replaceChildren();$('financeCount').textContent=entries.length;
  if(!entries.length){const tr=document.createElement('tr');const td=document.createElement('td');td.colSpan=7;td.className='empty-table';td.textContent='Aucune recharge ou salaire sur cette période.';tr.append(td);body.append(tr);return}
  entries.forEach(entry=>{const tr=document.createElement('tr');const recharge=entry.type==='recharge';const values=[new Date(entry.createdAt).toLocaleString('fr-FR',{timeZone:'Europe/Paris'}),recharge?'Recharge':'Salaire',recharge?entry.productName:entry.label,recharge?money(entry.costPrice):money(entry.amount),recharge?money(entry.salePrice):'—',recharge?money(entry.netMargin):'—',recharge?`${Number(entry.growthPercentage).toFixed(2)} %`:'—'];values.forEach((value,index)=>{const td=document.createElement('td');td.textContent=value;if(index===1)td.className=recharge?'finance-type recharge':'finance-type salary';tr.append(td)});body.append(tr)});
}

function renderChart(chart) {
  const { labels, revenue, materials, salaries, profit } = chart;
  const canvas=$('revenueChart'); const ratio=window.devicePixelRatio||1; const rect=canvas.getBoundingClientRect();
  canvas.width=Math.max(300,rect.width)*ratio; canvas.height=Math.max(220,rect.height)*ratio;
  const ctx=canvas.getContext('2d'); ctx.scale(ratio,ratio); const w=canvas.width/ratio,h=canvas.height/ratio,p={l:50,r:18,t:18,b:42};
  const all=[...revenue,...materials,...salaries,...profit];ctx.clearRect(0,0,w,h); const max=Math.max(...all.map(Math.abs),1); ctx.font='11px system-ui'; ctx.fillStyle='#8b95a7'; ctx.strokeStyle='#e8ecf2'; ctx.lineWidth=1;
  for(let i=0;i<=4;i++){const y=p.t+(h-p.t-p.b)*i/4;ctx.beginPath();ctx.moveTo(p.l,y);ctx.lineTo(w-p.r,y);ctx.stroke();ctx.fillText(money(max*(1-i/4)),2,y+4)}
  const series=[{v:revenue,c:'#536dfe'},{v:materials,c:'#20a66a'},{v:salaries,c:'#8458d5'},{v:profit,c:'#f08a32'}];const step=(w-p.l-p.r)/Math.max(labels.length,1);const bar=Math.max(2,Math.min(9,step*.18));
  labels.forEach((label,i)=>{series.forEach((serie,s)=>{const raw=serie.v[i]||0;const value=Math.abs(raw);const height=(h-p.t-p.b)*(value/max);const x=p.l+step*i+(step-bar*4)/2+s*bar;ctx.fillStyle=raw<0?'#dc3545':serie.c;ctx.fillRect(x,h-p.b-height,Math.max(1,bar-1),height)});if(labels.length<=12||i%5===0){ctx.fillStyle='#7d8798';ctx.textAlign='center';ctx.fillText(label,p.l+step*i+step/2,h-16)}});
}

function updateRechargeCalculation(){const cost=Number($('rechargeCost').value||0);const sale=Number($('rechargeSale').value||0);const margin=sale-cost;$('rechargeMargin').textContent=money(margin);$('rechargeGrowth').textContent=cost>0?`${((margin/cost)*100).toFixed(2)} %`:'0 %'}
async function saveFinance(payload,dialog){const response=await fetch('/api/admin/finance',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});const result=await response.json();if(!response.ok)throw new Error(result.error||'Enregistrement refusé');dialog.close();await loadStatistics()}
async function submitRecharge(event){event.preventDefault();try{await saveFinance({type:'recharge',productName:$('rechargeProduct').value.trim(),costPrice:Number($('rechargeCost').value),salePrice:Number($('rechargeSale').value)},$('rechargeDialog'))}catch(error){$('status').textContent=error.message;$('status').className='status error'}}
async function submitSalary(event){event.preventDefault();try{await saveFinance({type:'salary',label:$('salaryLabel').value.trim(),amount:Number($('salaryAmount').value)},$('salaryDialog'))}catch(error){$('status').textContent=error.message;$('status').className='status error'}}

function tariffsFor(product) {
  const promos = new Map(String(product.promoTariffs || '').split('|').filter(Boolean).map(entry => entry.split('=').map(Number)));
  return String(product.tariffs || '').split('|').filter(Boolean).map(entry => { const [size, price] = entry.split('=').map(Number); return { size, price: promos.get(size) || price }; }).filter(item => item.size > 0 && item.price > 0);
}

function refreshManualTotal() {
  const total = [...document.querySelectorAll('.manual-item')].reduce((sum, row) => sum + Number(row.querySelector('.manual-tariff').selectedOptions[0]?.dataset.price || 0) * Number(row.querySelector('.manual-quantity').value || 0), 0);
  $('manualTotal').value = total ? total.toFixed(2) : '';
}

function fillTariffs(row) {
  const product = catalog.find(item => String(item.id) === row.querySelector('.manual-product').value);
  const select = row.querySelector('.manual-tariff'); select.replaceChildren();
  tariffsFor(product || {}).forEach(tariff => { const option=document.createElement('option'); option.value=tariff.size; option.dataset.price=tariff.price; const unit=product?.category==='WEED'||product?.category==='HASH'?' gr':(product?.tariffsLabel?` ${product.tariffsLabel}`:''); option.textContent=`${tariff.size}${unit} — ${money(tariff.price)}`; select.append(option); });
  refreshManualTotal();
}

function addManualItem() {
  const row=document.createElement('div'); row.className='manual-item'; const product=document.createElement('select'); product.className='manual-product';
  catalog.filter(item=>item.stock!=='Rupture de stock'&&item.stock!==0).forEach(item=>{const option=document.createElement('option');option.value=item.id;option.textContent=item.name;product.append(option)});
  const tariff=document.createElement('select');tariff.className='manual-tariff'; const quantity=document.createElement('input');quantity.className='manual-quantity';quantity.type='number';quantity.min='1';quantity.max='20';quantity.value='1';
  const remove=document.createElement('button');remove.type='button';remove.className='icon-button';remove.textContent='×';remove.addEventListener('click',()=>{if(document.querySelectorAll('.manual-item').length>1){row.remove();refreshManualTotal()}});
  row.append(product,tariff,quantity,remove);$('manualItems').append(row);product.addEventListener('change',()=>fillTariffs(row));tariff.addEventListener('change',refreshManualTotal);quantity.addEventListener('input',refreshManualTotal);fillTariffs(row);
}

async function openOrderDialog() {
  try { const response=await fetch('/api/admin/data',{cache:'no-store'});if(!response.ok)throw new Error('Catalogue indisponible');catalog=(await response.json()).products||[];if(!catalog.length)throw new Error('Aucun produit disponible');$('orderForm').reset();$('manualItems').replaceChildren();addManualItem();$('orderDialog').showModal(); }
  catch(error){$('status').textContent=error.message;$('status').className='status error'}
}

async function saveManualOrder(event) {
  event.preventDefault(); const items=[...document.querySelectorAll('.manual-item')].map(row=>({productId:row.querySelector('.manual-product').value,mode:'tariff',size:Number(row.querySelector('.manual-tariff').value),quantity:Number(row.querySelector('.manual-quantity').value)}));
  const payload={customerName:$('manualCustomer').value.trim(),telegramUsername:$('manualUsername').value.trim(),items,deliveryOption:$('manualDelivery').value,timeSlot:$('manualTime').value,finalTotal:Number($('manualTotal').value)};
  try { const response=await fetch('/api/admin/orders',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});const result=await response.json();if(!response.ok)throw new Error(result.error||'Enregistrement refusé');$('orderDialog').close();await loadStatistics(); }
  catch(error){$('status').textContent=error.message;$('status').className='status error'}
}

document.querySelectorAll('[data-period]').forEach(button=>button.addEventListener('click',()=>{currentPeriod=button.dataset.period;document.querySelectorAll('[data-period]').forEach(item=>item.classList.toggle('active',item===button));loadStatistics()}));
$('menuButton').addEventListener('click',()=>$('sidebar').classList.toggle('open')); window.addEventListener('resize',()=>loadStatistics()); loadStatistics();
$('addOrderButton').addEventListener('click',openOrderDialog);
$('addOrderItemButton').addEventListener('click',addManualItem);
$('orderForm').addEventListener('submit',saveManualOrder);
$('closeOrderButton').addEventListener('click',()=>$('orderDialog').close());
$('cancelOrderButton').addEventListener('click',()=>$('orderDialog').close());
$('addRechargeButton').addEventListener('click',()=>{$('rechargeForm').reset();updateRechargeCalculation();$('rechargeDialog').showModal()});
$('addSalaryButton').addEventListener('click',()=>{$('salaryForm').reset();$('salaryDialog').showModal()});
$('rechargeCost').addEventListener('input',updateRechargeCalculation);$('rechargeSale').addEventListener('input',updateRechargeCalculation);
$('rechargeForm').addEventListener('submit',submitRecharge);$('salaryForm').addEventListener('submit',submitSalary);
document.querySelectorAll('[data-close]').forEach(button=>button.addEventListener('click',()=>$(button.dataset.close).close()));
