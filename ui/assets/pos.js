/* POS billing screen markup — shared by pos-billing.html and pos-payment.html */
(function(){
const cats=[['Most Popular',64],["Men's Wear",148,1],["Women's Wear",212],['Dresses & Ethnic Wear',96],['T-Shirts & Tops',121],['Shirts & Kurtas',88],['Jeans & Trousers',74],['Winter Wear',39],['Activewear',52],['Footwear',67],['Jewellery',45],['Fashion Add-ons',58],['Seasonal Collections',30]];
const prods=[
 ['jacket','#e5e7eb','Classic Bomber Jacket',2499,3299,'S M L XL',24],
 ['shorts','#dc2626','Cotton Beach Shorts',699,999,'S M L XL',41],
 ['shirt','#1e40af','Oxford Cotton Shirt',1299,1799,'M L XL x2XL',3],
 ['plaid','#9f1239','Checked Casual Shirt',999,1499,'S M L XL',18,1],
 ['shoe','#b45309','Leather Oxford Shoes',2499,3499,'7 8 9 10',12],
 ['jacket','#15803d','Track Jacket',1299,1999,'M L XL',9,1],
 ['jeans','#1e3a8a','Slim Fit Denim Jeans',1599,2199,'30 32 34 36',33],
 ['tshirt','#f8fafc','Cotton Crew T-Shirt',449,599,'S M L XL',86],
 ['kurta','#0f766e','Linen Festive Kurta',1799,2499,'M L XL',14],
 ['hoodie','#334155','Fleece Pullover Hoodie',1499,1999,'S M L xXL',4],
 ['tshirt','#f59e0b','Graphic Polo Tee',799,1099,'S M L XL',27],
 ['shorts','#0f172a','Chino Shorts',899,1299,'30 32 34',19],
];
const cart=[
 ['plaid','#9f1239','Checked Casual Shirt','L','#9f1239','Maroon Check','SH-MRN-L',1,999,1499],
 ['jeans','#1e3a8a','Slim Fit Denim Jeans','32','#1e3a8a','Indigo','JN-IND-32',1,1599,2199],
 ['tshirt','#f8fafc','Cotton Crew T-Shirt','M','#f8fafc','White','TS-WHT-M',2,449,599],
 ['shoe','#b45309','Leather Oxford Shoes','UK 9','#b45309','Tan','SH-TAN-09',1,2499,3499],
 ['jacket','#15803d','Track Jacket','L','#15803d','Green','TJ-GRN-L',1,1299,1999,1],
];
const inr=n=>'₹'+n.toLocaleString('en-IN');
let h=`<div class="pos">
<div class="pos-head">
 <div class="pos-r1">
  <div class="hbtn" style="background:none;border:0">${ic('menu')}</div>
  <div class="brand"><img src="assets/logo-light-compact.png" alt="NPOS" style="height:34px;display:block"></div>
  <span class="pill" style="margin-left:14px">${ic('store',14)}MG Road Store</span>
  <span class="pill"><i class="g"></i>Online · Synced</span>
  <span class="pill">${ic('timer',14)}Shift #142 · opened 09:02 AM</span>
  <div class="grow"></div>
  <div class="hin" style="width:210px">${ic('search',16)}Search Bill No.</div>
  <div class="neworder"><span>${ic('plus',16)}New Order <span class="kbd">F1</span></span><span>${ic('down',16)}</span></div>
  <div class="hbtn">${ic('inbox')}</div>
  <div class="hbtn" title="Resume held bills">${ic('pause')}<span class="dot"></span></div>
  <div class="hbtn">${ic('refresh')}</div>
  <div class="hbtn">${ic('bell')}<span class="dot"></span></div>
  <div class="hbtn">${ic('headset')}</div>
  <div class="row" style="gap:8px;margin-left:4px"><div class="av-s" style="background:#f59e0b;color:#fff;width:34px;height:34px">VK</div><div style="line-height:1.25"><b style="font-size:12px">Vijay Kumar</b><div style="font-size:10.5px;color:#9aa8d6">Cashier · Counter 2</div></div></div>
 </div>
 <div class="pos-r2">
  <div class="hin" style="width:330px">${ic('search',16)}Search items, Category, SKU, Brand… <span class="kbd" style="margin-left:auto">F2</span></div>
  <div class="scanbox"><i class="c c1"></i><i class="c c2"></i><i class="c c3"></i><i class="c c4"></i><div class="in">${ic('barcode')}<span>Search Barcode…</span><span class="cur"></span><span class="kbd" style="margin-left:auto">F3</span></div></div>
  <div class="hin" style="width:190px">${ic('phone',16)}<b>98765 43210</b></div>
  <div class="hin" style="width:210px">${ic('user',16)}<b>Vijay Sharma</b><span class="chip nodot" style="margin-left:auto;background:#24346f;color:#fcd34d;padding:2px 7px">${ic('star',11)} 1,240 pts</span></div>
  <div class="grow"></div>
  <div class="hbtn">${ic('edit')}</div>
  <div class="hbtn">${ic('user')}</div>
  <div class="hbtn">${ic('gift')}</div>
  <div class="hbtn">${ic('shield')}</div>
 </div>
</div>
<div class="pos-body">
 <div class="cats"><div class="t">Categories</div>${cats.map(c=>`<div class="${c[2]?'on':''}">${c[0]}<span>${c[1]}</span></div>`).join('')}</div>
 <div class="grid-wrap">
  <div class="row between">
   <div><b style="font-size:15px">Men's Wear</b> <span class="muted" style="margin-left:6px">148 items · 612 variants in stock</span></div>
   <div class="row" style="gap:6px"><span class="btn sm">${ic('filter')}Filter</span><span class="btn sm">Sort: Popular ${ic('down')}</span></div>
  </div>
  <div class="subcats"><span class="on">All</span><span>Shirts</span><span>T-Shirts</span><span>Jeans</span><span>Jackets</span><span>Ethnic</span><span>Shorts</span><span>Footwear</span></div>
  <div class="pgrid">${prods.map(p=>`<div class="pc ${p[7]?'sel':''}"><div class="img">${product(p[0],p[1])}</div><span class="stk ${p[6]<6?'low':''}">${p[6]<6?'Low · ':''}${p[6]} in stock</span><span class="add">${ic('plus')}</span><div class="nm">${p[2]}</div><div class="pr">${inr(p[3])}<s>${inr(p[4])}</s></div><div class="sz">${p[5].split(' ').map(s=>s.startsWith('x')?`<i class="x">${s.slice(1)}</i>`:`<i>${s}</i>`).join('')}</div></div>`).join('')}</div>
 </div>
 <div class="cart">
  <div class="cart-top">
   <span style="font-size:12px;font-weight:600;color:var(--text-2)">Price List</span><span class="faint">${ic('info',14)}</span>
   <div class="input" style="flex:1;height:34px">Retail – MRP Inclusive GST<span class="caret">${ic('down',14)}</span></div>
   <span class="btn sm">${ic('plus')}Add</span>
   <span class="chip blue nodot" style="height:28px">Bill #MG-2026-08431</span>
  </div>
  <div class="scan-toast">${ic('check',16)}<span>Scanned <b>8901234567894</b> → Track Jacket · L · Green added</span><span style="margin-left:auto;font-size:11px;opacity:.8">just now</span></div>
  <div class="cart-th"><span><span class="check on"></span></span><span>Items</span><span style="text-align:center">Qty</span><span>Unit</span><span style="text-align:right">Sub Total</span><span></span></div>
  ${cart.map(c=>`<div class="ci ${c[10]?'hl':''}"><span class="check on"></span>
   <div class="info"><div class="thumb">${product(c[0],c[1])}</div><div style="min-width:0"><b>${c[2]}</b><div class="meta"><span>Size: <b style="display:inline;color:var(--text-2)">${c[3]}</b></span><span><i class="sw" style="background:${c[4]}"></i>${c[5]}</span></div><div class="meta"><code>${c[6]}</code>${inr(c[8])} <s class="strike">${inr(c[9])}</s></div></div></div>
   <div class="qty"><span>${ic('minus')}</span><b>${c[7]}</b><span>${ic('plus')}</span></div>
   <div class="unit">Piece${ic('down')}</div>
   <div class="st num">${inr(c[7]*c[8])}<small>${inr(c[7]*c[9])}</small></div>
   <span class="del">${ic('trash',16)}</span></div>`).join('')}
  <div style="margin:8px 16px;border:1.5px dashed var(--line);border-radius:10px;padding:8px 12px;display:flex;align-items:center;gap:10px;color:var(--faint);font-size:12px">${ic('scan',20)}<span>Scan next barcode or tap a product to add — size, colour &amp; price are picked from the barcode</span></div>
  <div class="cart-sum num">
   <div><div class="l"><span>Sub Total</span><b>₹7,294.00</b></div><div class="l"><span>Bill Discount (₹200 flat)</span><b style="color:var(--green)">− ₹200.00</b></div><div class="l"><span>CGST (incl.)</span><b>₹325.12</b></div><div class="l"><span>SGST (incl.)</span><b>₹325.13</b></div></div>
   <div><div class="l"><span>Round Off</span><b>₹0.00</b></div><div class="l"><span>Customer saves vs MRP</span><b style="color:var(--green)">₹3,300.00</b></div>
    <div class="tq"><span>Total Qty<b>6</b></span><span>No. of Items<b>5</b></span></div></div>
   <div style="grid-column:1;align-self:end;font-size:11px;color:var(--muted);display:flex;align-items:center;gap:6px">${ic('tag',14)}Cashier discount limit: 10% · used 2.7%</div>
   <div class="payable"><span>Payable Amount</span><b>₹7,094.00</b></div>
  </div>
  <div class="cart-act"><div>${ic('pause')}Hold <span class="kbd">F5</span></div><div>${ic('percent')}Add Discount <span class="kbd">F7</span></div><div class="go">Confirm Payment <span class="kbd">F8</span>${ic('arrow')}</div></div>
 </div>
</div>
<div class="pos-foot">
 <span><span class="kbd">F1</span>New Bill</span><span><span class="kbd">F2</span>Search</span><span><span class="kbd">F3</span>Scan</span><span><span class="kbd">F4</span>Customer</span><span><span class="kbd">F5</span>Hold</span><span><span class="kbd">F6</span>Resume</span><span><span class="kbd">F7</span>Discount</span><span><span class="kbd">F8</span>Payment</span><span><span class="kbd">F9</span>Print</span><span><span class="kbd">F10</span>Cancel</span><span><span class="kbd">F12</span>Complete Sale</span>
 <div class="r"><span>${ic('printer',14)}TVS RP-3200 · 80mm ready</span><span>${ic('barcode',14)}Scanner connected</span><span>04 Oct 2026 · 06:42 PM</span></div>
</div>
</div>`;
document.getElementById('pos').innerHTML=h;
})();
