// End-to-end offline billing test (BRD §23): cashier signs in, the network is cut, a sale is billed
// offline, the network returns and the queued sale must sync with a real invoice number.
// Needs the seeded API + `npm run dev` running and Google Chrome installed (set CHROME=path to override).
//   node scripts/offline-e2e.mjs
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const BASE = 'http://localhost:5173';
const OUT = new URL('./offline-e2e-shots/', import.meta.url);
mkdirSync(OUT, { recursive: true });
const CHROME = process.env.CHROME ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--remote-debugging-port=9334', `--user-data-dir=${mkdtempSync(join(tmpdir(), 'npos-e2e-'))}`, 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ws;
for (let i = 0; i < 40 && !ws; i++) {
  await sleep(250);
  try { const p = (await (await fetch('http://127.0.0.1:9334/json')).json()).find((t) => t.type === 'page'); if (p) ws = new WebSocket(p.webSocketDebuggerUrl); } catch {}
}
await new Promise((r) => ws.addEventListener('open', r, { once: true }));
let id = 0; const pending = new Map();
ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } });
const cdp = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const js = async (expr) => (await cdp('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })).result?.result?.value;
const shot = async (name) => writeFileSync(new URL(`./${name}.png`, OUT), Buffer.from((await cdp('Page.captureScreenshot', { format: 'png' })).result.data, 'base64'));
const net = (offline) => cdp('Network.emulateNetworkConditions', { offline, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
const step = (ok, msg) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); if (!ok) process.exitCode = 1; };

await cdp('Network.enable');
await cdp('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
await cdp('Page.navigate', { url: `${BASE}/login` });
await sleep(1500);
await js(`fetch('/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ login: 'vijay@vastrafashions.in', password: 'Cashier@1234' }) }).then(r => r.status)`);
await cdp('Page.navigate', { url: `${BASE}/pos` });
await sleep(4000); // catalogue download into IndexedDB
const cached = await js(`new Promise(res => { const r = indexedDB.open('npos-pos'); r.onsuccess = () => { const t = r.result.transaction('kv').objectStore('kv').getAllKeys(); t.onsuccess = () => res(t.result) } })`);
step(Array.isArray(cached) && cached.some((k) => String(k).startsWith('catalog:')), `catalogue cached in IndexedDB (${cached})`);

await net(true);
await sleep(800);
step(await js('navigator.onLine') === false, 'browser is offline');
// scan two items through the scan box exactly like a USB scanner (type + Enter)
const scan = (code) => js(`(async () => { const i = document.querySelector('.scanbox input'); i.focus(); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(i, '${code}'); i.dispatchEvent(new Event('input', { bubbles: true })); await new Promise(r => setTimeout(r, 200)); i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); await new Promise(r => setTimeout(r, 600)); return document.querySelectorAll('.ci').length; })()`);
await scan('8901234000014');
const lines = await scan('JN-SLM-IND-32');
step(lines === 2, `offline scans added ${lines} cart lines from the cached catalogue`);
await shot('off-1-cart');
await js(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'F8', bubbles: true }))`);
await sleep(800);
step(await js(`!!document.querySelector('.pay-modal')`), 'payment opens while offline');
await js(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'F12', bubbles: true }))`);
await sleep(1500);
const receipt = await js(`document.querySelector('.receipt')?.innerText ?? ''`);
const ref = /OFF-[A-Z0-9]+-\d{4}/.exec(receipt)?.[0];
step(!!ref && receipt.includes('SALE RECEIPT (OFFLINE)'), `offline receipt printed with provisional number ${ref}`);
await shot('off-2-receipt');
await js(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'F1', bubbles: true }))`);
await sleep(500);
const pill = await js(`[...document.querySelectorAll('.pill')].map(p => p.innerText).find(t => /Offline/.test(t))`);
step(/1 queued/.test(pill ?? ''), `header shows "${pill}"`);
await shot('off-3-queued');

await net(false);
console.log('… back online, waiting for sync');
let synced = false;
for (let i = 0; i < 20 && !synced; i++) {
  await sleep(1500);
  synced = await js(`[...document.querySelectorAll('.pill')].some(p => /Online · Synced/.test(p.innerText))`);
}
step(synced, 'queue synced automatically after reconnect');
await shot('off-4-synced');
const sale = await js(`fetch('/api/auth/refresh', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }).then(r => r.json()).then(s => fetch('/api/sales?search=&pageSize=5', { headers: { authorization: 'Bearer ' + s.accessToken } })).then(r => r.json()).then(p => p.items.find(i => i.offlineRef === '${ref}'))`);
step(!!sale, `server has ${sale?.invoiceNo} for offline receipt ${ref}`);
ws.close(); chrome.kill(); process.exit();
