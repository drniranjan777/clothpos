/* Shared UI helpers: icons, product illustrations, sidebar, charts */
const ICONS = {
  menu:'<path d="M4 6h16M4 12h16M4 18h16"/>',
  search:'<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  barcode:'<path d="M4 5v14M7 5v14M10 5v14M14 5v14M16 5v14M20 5v14"/>',
  scan:'<path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3"/><path d="M8 8v8M11 8v8M14 8v8M16.5 8v8"/>',
  phone:'<path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2"/>',
  user:'<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  users:'<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7M18 14a6 6 0 0 1 3.5 6"/>',
  edit:'<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m13.5 6.5 4 4"/>',
  gift:'<rect x="3" y="8" width="18" height="4" rx="1"/><path d="M5 12v8h14v-8M12 8v12M12 8S10.5 3 8 4s0 4 4 4c4 0 6.5-3 4-4s-4 4-4 4"/>',
  shield:'<path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6z"/><path d="m9 12 2 2 4-4"/>',
  bell:'<path d="M6 16V11a6 6 0 0 1 12 0v5l2 2H4z"/><path d="M10 21h4"/>',
  refresh:'<path d="M20 11a8 8 0 0 0-14.5-4.5L4 8M4 4v4h4M4 13a8 8 0 0 0 14.5 4.5L20 16M20 20v-4h-4"/>',
  inbox:'<path d="M3 13h5l1.5 3h5L16 13h5"/><path d="M5 5h14l2 8v6H3v-6z"/>',
  timer:'<circle cx="12" cy="13" r="8"/><path d="M12 9v4l2.5 2M10 2h4"/>',
  headset:'<path d="M4 15v-3a8 8 0 0 1 16 0v3"/><rect x="3" y="14" width="4" height="6" rx="1.5"/><rect x="17" y="14" width="4" height="6" rx="1.5"/>',
  plus:'<path d="M12 5v14M5 12h14"/>', minus:'<path d="M5 12h14"/>',
  trash:'<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  home:'<path d="m3 11 9-7 9 7"/><path d="M5 10v10h14V10"/>',
  dashboard:'<rect x="3" y="3" width="8" height="9" rx="1.5"/><rect x="13" y="3" width="8" height="5" rx="1.5"/><rect x="13" y="10" width="8" height="11" rx="1.5"/><rect x="3" y="14" width="8" height="7" rx="1.5"/>',
  cart:'<circle cx="9" cy="20" r="1.5"/><circle cx="18" cy="20" r="1.5"/><path d="M2 3h3l2.5 12h12L22 7H6.2"/>',
  pos:'<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4M7 8h4"/>',
  box:'<path d="M3 7.5 12 3l9 4.5v9L12 21l-9-4.5z"/><path d="m3 7.5 9 4.5 9-4.5M12 12v9"/>',
  layers:'<path d="m12 3 9 5-9 5-9-5z"/><path d="m3 13 9 5 9-5"/>',
  shirt:'<path d="M8 3 3 6l2 5 3-1v11h8V10l3 1 2-5-5-3a4 4 0 0 1-8 0"/>',
  truck:'<path d="M2 6h12v10H2zM14 10h4l3 3v3h-7"/><circle cx="6" cy="18" r="2"/><circle cx="17" cy="18" r="2"/>',
  undo:'<path d="M9 14 4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 0 10h-3"/>',
  chart:'<path d="M3 3v18h18"/><path d="M7 15v2M11 10v7M15 12v5M19 6v11"/>',
  trend:'<path d="m3 17 6-6 4 4 8-8"/><path d="M15 7h6v6"/>',
  settings:'<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 0 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 0 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 0 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 0 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1"/>',
  file:'<path d="M14 3H6v18h12V7z"/><path d="M14 3v4h4M9 12h6M9 16h6"/>',
  receipt:'<path d="M5 3h14v18l-2.5-1.5L14 21l-2-1.5L10 21l-2.5-1.5L5 21z"/><path d="M9 8h6M9 12h6M9 16h3"/>',
  logout:'<path d="M15 4h4v16h-4M10 8l-4 4 4 4M6 12h10"/>',
  building:'<path d="M4 21V5l8-2v18M12 8h8v13M8 8h.01M8 12h.01M8 16h.01M16 12h.01M16 16h.01M2 21h20"/>',
  card:'<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20M6 15h4"/>',
  cash:'<rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/><path d="M6 12h.01M18 12h.01"/>',
  upi:'<path d="m7 4 5 8-5 8M13 4l5 8-5 8"/>',
  wallet:'<path d="M19 7V5a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15v12H5a2 2 0 0 1-2-2V6"/><path d="M16 14h.01"/>',
  bank:'<path d="m3 9 9-5 9 5M5 9v9M10 9v9M14 9v9M19 9v9M3 20h18"/>',
  check:'<path d="m5 12 5 5 9-10"/>',
  alert:'<path d="M12 3 2 20h20z"/><path d="M12 10v4M12 17h.01"/>',
  arrow:'<path d="M5 12h14M13 6l6 6-6 6"/>',
  'arrow-up':'<path d="M7 17 17 7M8 7h9v9"/>',
  down:'<path d="m6 9 6 6 6-6"/>',
  printer:'<path d="M7 9V3h10v6M7 17H4v-7h16v7h-3"/><rect x="7" y="14" width="10" height="7"/>',
  filter:'<path d="M3 5h18l-7 8v6l-4 2v-8z"/>',
  download:'<path d="M12 4v11M7 10l5 5 5-5M4 20h16"/>',
  calendar:'<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  tag:'<path d="M3 12V3h9l9 9-9 9z"/><circle cx="7.5" cy="7.5" r="1.5"/>',
  percent:'<path d="M19 5 5 19"/><circle cx="7" cy="7" r="2.5"/><circle cx="17" cy="17" r="2.5"/>',
  pause:'<rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/>',
  star:'<path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1 6.2L12 17.3 6.5 20.2l1-6.2L3 9.6l6.2-.9z"/>',
  wifi:'<path d="M2 9a15 15 0 0 1 20 0M5 12.5a10 10 0 0 1 14 0M8.5 16a5 5 0 0 1 7 0M12 19.5h.01"/>',
  whatsapp:'<path d="M4 20l1.3-4A8 8 0 1 1 8 18.7z"/><path d="M9 9c0 3 3 6 6 6l1-1.5-2-1-1 1c-1-.5-2-1.5-2.5-2.5l1-1-1-2z"/>',
  mail:'<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>',
  lock:'<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  eye:'<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  more:'<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
  crown:'<path d="m3 8 4 4 5-7 5 7 4-4-2 11H5z"/>',
  history:'<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5M12 7v5l3 2"/>',
  swap:'<path d="M7 4 3 8l4 4M3 8h14M17 20l4-4-4-4M21 16H7"/>',
  info:'<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
  x:'<path d="M6 6l12 12M18 6 6 18"/>',
  zap:'<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>',
  store:'<path d="M3 9 5 4h14l2 5M3 9v1a3 3 0 0 0 6 0 3 3 0 0 0 6 0 3 3 0 0 0 6 0V9M3 9h18M5 13v8h14v-8M10 21v-5h4v5"/>',
};
function ic(name, size){ const s=size?` style="width:${size}px;height:${size}px"`:''; return `<svg class="ic" viewBox="0 0 24 24"${s}>${ICONS[name]||''}</svg>`; }

/* ---- Clothing illustrations (inline SVG, no external images) ---- */
let _pid=0;
function shade(hex, amt){ const n=parseInt(hex.slice(1),16); let r=(n>>16)+amt,g=((n>>8)&255)+amt,b=(n&255)+amt; r=Math.max(0,Math.min(255,r));g=Math.max(0,Math.min(255,g));b=Math.max(0,Math.min(255,b)); return '#'+((r<<16)|(g<<8)|b).toString(16).padStart(6,'0'); }
function product(type, c){
  const id='p'+(++_pid), dk=shade(c,-45), lt=shade(c,40);
  const st=`stroke="${dk}" stroke-width="1.6" stroke-linejoin="round"`;
  let fill=`url(#g${id})`, defs=`<linearGradient id="g${id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${lt}"/><stop offset="1" stop-color="${c}"/></linearGradient>`;
  let body='';
  switch(type){
    case 'plaid':
      defs+=`<pattern id="pl${id}" width="12" height="12" patternUnits="userSpaceOnUse"><rect width="12" height="12" fill="#f4ecee"/><rect width="12" height="4" fill="${c}" opacity=".75"/><rect width="4" height="12" fill="${c}" opacity=".6"/><rect x="8" width="1.4" height="12" fill="#1e293b" opacity=".5"/><rect y="8" width="12" height="1.4" fill="#1e293b" opacity=".45"/></pattern>`;
      fill=`url(#pl${id})`;
      body=`<path d="M32 12 44 8q6 6 12 0l12 4 12 18 9 52-12 2-8-38v46H30V46l-8 38-12-2 9-52z" fill="${fill}" ${st}/><path d="M44 8l6 12 6-12M50 20v66" stroke="${dk}" stroke-width="1.4" fill="none"/><circle cx="50" cy="32" r="1.3" fill="#fff"/><circle cx="50" cy="46" r="1.3" fill="#fff"/><circle cx="50" cy="60" r="1.3" fill="#fff"/>`;break;
    case 'shirt':
      body=`<path d="M32 12 44 8q6 6 12 0l12 4 12 18 9 52-12 2-8-38v46H30V46l-8 38-12-2 9-52z" fill="${fill}" ${st}/><path d="M44 8l6 12 6-12M50 20v66" stroke="${dk}" stroke-width="1.4" fill="none"/><path d="M38 34h8v6h-8z" fill="none" stroke="${dk}" stroke-width="1.2"/>`;break;
    case 'jacket':
      body=`<path d="M32 12 44 8q6 6 12 0l12 4 12 18 9 52-12 2-8-38v46H30V46l-8 38-12-2 9-52z" fill="${fill}" ${st}/><path d="M50 14v78" stroke="#475569" stroke-width="1.6" stroke-dasharray="2 1.6"/><path d="M44 8 40 26l10-6 10 6-4-18" fill="${lt}" ${st}/><path d="M34 58h10M56 58h10" stroke="${dk}" stroke-width="1.4"/>`;break;
    case 'tshirt':
      body=`<path d="M30 14 42 9q8 8 16 0l12 5 18 18-10 11-8-6v53H30V37l-8 6-10-11z" fill="${fill}" ${st}/><path d="M42 9q8 10 16 0" fill="none" stroke="${dk}" stroke-width="1.6"/>`;break;
    case 'shorts':
      body=`<path d="M22 22h56l7 58-30 3-5-36-5 36-30-3z" fill="${fill}" ${st}/><rect x="22" y="16" width="56" height="8" rx="2" fill="${dk}" opacity=".85"/><path d="M47 24v8M53 24v8" stroke="#fff" stroke-width="1.4"/>`;break;
    case 'jeans':
      body=`<path d="M28 12h44l6 80H58L50 38l-8 54H22z" fill="${fill}" ${st}/><path d="M28 18h44" stroke="${dk}" stroke-width="2"/><path d="M50 18v20M34 24q4 6 10 4M66 24q-4 6-10 4" stroke="#fbbf24" stroke-width="1.1" fill="none"/>`;break;
    case 'dress':
      body=`<path d="M40 8h4l2 12h8l2-12h4l-2 20 8 12 18 50H14l18-50 8-12z" fill="${fill}" ${st}/><path d="M34 40h32" stroke="${dk}" stroke-width="2"/><path d="M30 66q20 6 40 0M24 80q26 8 52 0" stroke="${lt}" stroke-width="1.4" fill="none" opacity=".9"/>`;break;
    case 'kurta':
      body=`<path d="M34 10 44 7q6 8 12 0l10 3 16 20-8 18-6-8 2 52H30l2-52-6 8-8-18z" fill="${fill}" ${st}/><path d="M50 15v26" stroke="${dk}" stroke-width="1.4"/><path d="M30 80h40" stroke="#fbbf24" stroke-width="3"/><path d="M30 86h40" stroke="#fbbf24" stroke-width="1.2"/>`;break;
    case 'heels':
      body=`<path d="M12 66q6-14 22-10 18 6 30-8l10-12q8-2 12 6-2 10-12 16l-2 28h-5l-2-22q-18 10-46 12-10 0-7-10z" fill="${fill}" ${st}/><path d="M18 64q10-4 22 2" stroke="${lt}" stroke-width="1.5" fill="none"/>`;break;
    case 'shoe':
      body=`<path d="M8 64q0-14 14-14l18-2q8-10 18-4 16 10 32 14 6 3 4 12H10q-3 0-2-6z" fill="${fill}" ${st}/><rect x="7" y="70" width="88" height="7" rx="3" fill="${dk}"/><path d="M44 50l6 8M50 48l6 8M56 48l5 7" stroke="#fff3" stroke-width="1.4"/><path d="M40 48q6 4 18 0" fill="none" stroke="${dk}" stroke-width="1.2"/>`;break;
    case 'saree':
      body=`<path d="M30 10h22l8 30 10 52H22l6-48z" fill="${fill}" ${st}/><path d="M52 10 78 40l-8 6-14-18" fill="${lt}" ${st}/><path d="M22 84h48" stroke="#fbbf24" stroke-width="5"/><path d="M60 40l10 52" stroke="#fbbf24" stroke-width="3"/>`;break;
    case 'hoodie':
      body=`<path d="M36 12q14-10 28 0l6 4 12 18 8 50-12 2-6-36v42H28V50l-6 36-12-2 8-50 12-18z" fill="${fill}" ${st}/><path d="M38 14q12 18 24 0" fill="${dk}" opacity=".5"/><path d="M38 66h24v12H38z" fill="none" stroke="${dk}" stroke-width="1.4"/><path d="M46 26v10M54 26v10" stroke="#fff" stroke-width="1.2"/>`;break;
    case 'jewel':
      body=`<path d="M22 22q28 60 56 0" fill="none" stroke="#d4a017" stroke-width="3"/><circle cx="50" cy="58" r="9" fill="${fill}" ${st}/><circle cx="34" cy="44" r="4" fill="#d4a017"/><circle cx="66" cy="44" r="4" fill="#d4a017"/><circle cx="50" cy="58" r="3.5" fill="#fff" opacity=".6"/>`;break;
    case 'bag':
      body=`<path d="M36 34q0-20 14-20t14 20" fill="none" stroke="${dk}" stroke-width="3"/><path d="M20 34h60l6 54H14z" fill="${fill}" ${st}/><rect x="44" y="46" width="12" height="7" rx="2" fill="#d4a017"/>`;break;
  }
  return `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg"><defs>${defs}</defs><ellipse cx="50" cy="94" rx="30" ry="3" fill="#0f172a" opacity=".07"/>${body}</svg>`;
}

/* ---- Sidebar ---- */
const NAV = {
  tenant:[
    ['','Overview'],
    ['dashboard','Dashboard','dashboard','dashboard.html'],
    ['pos','POS Billing','pos','pos-billing.html'],
    ['','Catalogue'],
    ['products','Products','shirt','products.html'],
    ['inventory','Inventory','box','inventory.html','6'],
    ['purchases','Purchases','truck','#'],
    ['','Sales'],
    ['invoices','Invoices','receipt','invoice.html'],
    ['returns','Returns & Exchange','undo','returns.html'],
    ['customers','Customers','users','customers.html'],
    ['shift','Shift & Day Close','timer','shift-closing.html'],
    ['','Insights'],
    ['reports','Reports','chart','reports.html'],
    ['settings','Settings','settings','#'],
  ],
  admin:[
    ['','Platform'],
    ['sa-dashboard','Dashboard','dashboard','sa-dashboard.html'],
    ['sa-tenants','Tenants','building','sa-tenants.html'],
    ['sa-plans','Subscription Plans','layers','sa-plans.html'],
    ['subs','Subscriptions','calendar','#'],
    ['pay','Payments','card','#','3'],
    ['','Insights'],
    ['rep','Reports','chart','#'],
    ['audit','Audit Logs','history','#'],
    ['set','Platform Settings','settings','#'],
  ]
};
function renderSide(el){
  const kind=el.dataset.side, active=el.dataset.active;
  let h=`<div class="brand"><div><img class="brand-logo" src="assets/logo-light-compact.png" alt="NPOS"><small>${kind==='admin'?'Super Admin Console':'Clothing Retail POS'}</small></div></div>`;
  if(kind==='tenant') h+=`<div class="tenant"><div class="av">VF</div><div class="grow"><b>Vastra Fashions</b><span>MG Road Store ▾</span></div></div>`;
  else h+=`<div class="tenant"><div class="av" style="background:#6d28d9">${ic('crown',16)}</div><div class="grow"><b>Platform Owner</b><span>Production · v1.0</span></div></div>`;
  for(const n of NAV[kind]){
    if(!n[0]){h+=`<div class="sec">${n[1]}</div>`;continue;}
    h+=`<a class="${n[0]===active?'on':''}" href="${n[3]}">${ic(n[2])}${n[1]}${n[4]?`<span class="tag">${n[4]}</span>`:''}</a>`;
  }
  h+=`<div class="foot">${kind==='tenant'
    ? `<div style="background:var(--navy-2);border-radius:10px;padding:12px;font-size:11.5px"><div class="row between"><b style="color:#fff">Professional</b><span class="chip green nodot" style="background:#14532d;color:#86efac">Active</span></div><div style="color:#8d9bc7;margin:6px 0 8px">Renews 12 Nov 2026 · 39 days</div><div class="bar-track" style="background:#24346f"><i style="width:68%;background:#60a5fa"></i></div><div style="color:#8d9bc7;margin-top:6px">3 of 5 stores · 11 of 25 users</div></div>`
    : `<a href="login.html">${ic('logout')}Sign out</a>`}</div>`;
  el.innerHTML=h;
}

/* ---- Charts (inline SVG) ---- */
function bars(el){
  const d=JSON.parse(el.dataset.bars), labels=(el.dataset.labels||'').split(','), W=+el.dataset.w||600, H=+el.dataset.h||200;
  const d2=el.dataset.bars2?JSON.parse(el.dataset.bars2):null;
  const max=Math.max(...d,...(d2||[]))*1.15, pad=28, bw=(W-pad)/d.length;
  let s=`<svg width="${W}" height="${H+30}" viewBox="0 -8 ${W} ${H+30}">`;
  for(let i=0;i<=4;i++){const y=H-(H*i/4);s+=`<line x1="${pad}" x2="${W}" y1="${y}" y2="${y}" stroke="#eef1f6"/><text x="${pad-6}" y="${y+3}" text-anchor="end" font-size="9.5" fill="#94a3b8">${fmtK(max*i/4)}</text>`;}
  d.forEach((v,i)=>{
    const x=pad+i*bw, w=d2?bw*.32:bw*.56, off=d2?bw*.16:bw*.22;
    const h=H*v/max, last=i===d.length-1&&!d2;
    s+=`<rect x="${x+off}" y="${H-h}" width="${w}" height="${h}" rx="3" fill="${last?'#1d4ed8':(d2?'#1d4ed8':'#bfd0f8')}"/>`;
    if(d2){const h2=H*d2[i]/max;s+=`<rect x="${x+off+w+2}" y="${H-h2}" width="${w}" height="${h2}" rx="3" fill="#93c5fd"/>`;}
    if(labels[i])s+=`<text x="${x+bw/2}" y="${H+15}" text-anchor="middle" font-size="9.5" fill="#94a3b8">${labels[i]}</text>`;
  });
  el.innerHTML=s+'</svg>';
}
function line(el){
  const d=JSON.parse(el.dataset.line), d2=el.dataset.line2?JSON.parse(el.dataset.line2):null, labels=(el.dataset.labels||'').split(','), W=+el.dataset.w, H=+el.dataset.h, pad=34;
  const max=Math.max(...d,...(d2||[]))*1.15, step=(W-pad-6)/(d.length-1);
  const pts=a=>a.map((v,i)=>[pad+i*step,H-H*v/max]);
  const path=p=>p.map((q,i)=>(i?'L':'M')+q[0].toFixed(1)+' '+q[1].toFixed(1)).join(' ');
  let s=`<svg width="${W}" height="${H+30}" viewBox="0 -8 ${W} ${H+30}"><defs><linearGradient id="la" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1d4ed8" stop-opacity=".18"/><stop offset="1" stop-color="#1d4ed8" stop-opacity="0"/></linearGradient></defs>`;
  for(let i=0;i<=4;i++){const y=H-(H*i/4);s+=`<line x1="${pad}" x2="${W}" y1="${y}" y2="${y}" stroke="#eef1f6"/><text x="${pad-6}" y="${y+3}" text-anchor="end" font-size="9.5" fill="#94a3b8">${fmtK(max*i/4)}</text>`;}
  const p=pts(d);
  if(d2) s+=`<path d="${path(pts(d2))}" fill="none" stroke="#a5b4fc" stroke-width="2" stroke-dasharray="4 4"/>`;
  s+=`<path d="${path(p)} L${p[p.length-1][0]} ${H} L${pad} ${H}Z" fill="url(#la)"/><path d="${path(p)}" fill="none" stroke="#1d4ed8" stroke-width="2.4"/>`;
  const L=p[p.length-1]; s+=`<circle cx="${L[0]}" cy="${L[1]}" r="4.5" fill="#fff" stroke="#1d4ed8" stroke-width="2.4"/>`;
  labels.forEach((t,i)=>{ if(t) s+=`<text x="${pad+i*step}" y="${H+15}" text-anchor="middle" font-size="9.5" fill="#94a3b8">${t}</text>`;});
  el.innerHTML=s+'</svg>';
}
function donut(el){
  const d=JSON.parse(el.dataset.donut), cols=el.dataset.colors.split(','), R=+el.dataset.r||60, T=+el.dataset.t||16;
  const tot=d.reduce((a,b)=>a+b,0), C=2*Math.PI*R; let off=0, s=`<svg width="${2*R+T}" height="${2*R+T}" viewBox="0 0 ${2*R+T} ${2*R+T}"><g transform="rotate(-90 ${R+T/2} ${R+T/2})">`;
  d.forEach((v,i)=>{const len=C*v/tot; s+=`<circle cx="${R+T/2}" cy="${R+T/2}" r="${R}" fill="none" stroke="${cols[i]}" stroke-width="${T}" stroke-dasharray="${Math.max(len-2,0)} ${C}" stroke-dashoffset="${-off}"/>`; off+=len;});
  el.innerHTML=s+`</g></svg>`;
}
function fmtK(v){ if(v>=100000) return (v/100000).toFixed(1).replace('.0','')+'L'; if(v>=1000) return (v/1000).toFixed(v>=10000?0:1).replace('.0','')+'k'; return Math.round(v); }

document.addEventListener('DOMContentLoaded',()=>{
  document.querySelectorAll('[data-side]').forEach(renderSide);
  document.querySelectorAll('i[data-i]').forEach(e=>e.outerHTML=ic(e.dataset.i,e.dataset.s));
  document.querySelectorAll('[data-p]').forEach(e=>e.innerHTML=product(e.dataset.p,e.dataset.c||'#64748b'));
  document.querySelectorAll('[data-bars]').forEach(bars);
  document.querySelectorAll('[data-line]').forEach(line);
  document.querySelectorAll('[data-donut]').forEach(donut);
});
