'use strict';
const $ = id => document.getElementById(id);
let currentPeriod = 'week';
const money = value => new Intl.NumberFormat('fr-FR',{style:'currency',currency:'EUR'}).format(Number(value||0));
const text = value => document.createTextNode(String(value ?? ''));

async function loadStatistics() {
  $('status').textContent = 'Chargement des statistiques…';
  try {
    const response = await fetch(`/api/admin/stats?period=${currentPeriod}`, { cache: 'no-store' });
    if (!response.ok) throw new Error('Chargement refusé');
    const data = await response.json();
    $('status').textContent = '';
    $('revenueToday').textContent = money(data.summary.today);
    $('revenueWeek').textContent = money(data.summary.week);
    $('revenueMonth').textContent = money(data.summary.month);
    $('revenueYear').textContent = money(data.summary.year);
    $('chartCaption').textContent = currentPeriod === 'week' ? 'Sur les 7 derniers jours' : currentPeriod === 'month' ? 'Sur les 30 derniers jours' : 'Sur les 12 derniers mois';
    renderChart(data.chart.labels, data.chart.values);
    renderOrders(data.orders);
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

function renderChart(labels, values) {
  const canvas=$('revenueChart'); const ratio=window.devicePixelRatio||1; const rect=canvas.getBoundingClientRect();
  canvas.width=Math.max(300,rect.width)*ratio; canvas.height=Math.max(220,rect.height)*ratio;
  const ctx=canvas.getContext('2d'); ctx.scale(ratio,ratio); const w=canvas.width/ratio,h=canvas.height/ratio,p={l:50,r:18,t:18,b:42};
  ctx.clearRect(0,0,w,h); const max=Math.max(...values,1); ctx.font='11px system-ui'; ctx.fillStyle='#8b95a7'; ctx.strokeStyle='#e8ecf2'; ctx.lineWidth=1;
  for(let i=0;i<=4;i++){const y=p.t+(h-p.t-p.b)*i/4;ctx.beginPath();ctx.moveTo(p.l,y);ctx.lineTo(w-p.r,y);ctx.stroke();ctx.fillText(money(max*(1-i/4)),2,y+4)}
  if(!values.length)return; const step=(w-p.l-p.r)/Math.max(values.length,1); const bar=Math.max(3,Math.min(26,step*.56));
  values.forEach((value,i)=>{const x=p.l+step*i+(step-bar)/2;const height=(h-p.t-p.b)*(value/max);const y=h-p.b-height;const gradient=ctx.createLinearGradient(0,y,0,h-p.b);gradient.addColorStop(0,'#536dfe');gradient.addColorStop(1,'#9aa8ff');ctx.fillStyle=gradient;ctx.beginPath();ctx.roundRect(x,y,bar,height,5);ctx.fill();if(labels.length<=12||i%5===0){ctx.save();ctx.fillStyle='#7d8798';ctx.textAlign='center';ctx.fillText(labels[i],x+bar/2,h-16);ctx.restore()}});
}

document.querySelectorAll('[data-period]').forEach(button=>button.addEventListener('click',()=>{currentPeriod=button.dataset.period;document.querySelectorAll('[data-period]').forEach(item=>item.classList.toggle('active',item===button));loadStatistics()}));
$('menuButton').addEventListener('click',()=>$('sidebar').classList.toggle('open')); window.addEventListener('resize',()=>loadStatistics()); loadStatistics();
