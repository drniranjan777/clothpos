// Clothing illustrations ported from ui/assets/app.js - used when a product has no photo.
import { memo } from 'react';

let _pid = 0;
function shade(hex: string, amt: number) { const n=parseInt(hex.slice(1),16); let r = (n >> 16) + amt, g = ((n >> 8) & 255) + amt, b = (n & 255) + amt; r=Math.max(0,Math.min(255,r));g=Math.max(0,Math.min(255,g));b=Math.max(0,Math.min(255,b)); return '#'+((r<<16)|(g<<8)|b).toString(16).padStart(6,'0'); }
export function productSvg(type: string, c: string): string {
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


export const ART_TYPES = ['shirt', 'plaid', 'tshirt', 'jacket', 'hoodie', 'kurta', 'jeans', 'shorts', 'dress', 'saree', 'shoe', 'heels', 'jewel', 'bag'];

/** Product picture: photo when available, otherwise the drawn illustration in the product colour. */
export const ProductArt = memo(function ProductArt({ type, color, imageUrl, alt = '' }: { type?: string; color?: string; imageUrl?: string | null; alt?: string }) {
  if (imageUrl) return <img src={imageUrl} alt={alt} loading="lazy" />;
  return <span style={{ display: 'contents' }} dangerouslySetInnerHTML={{ __html: productSvg(type || 'tshirt', color || '#64748b') }} />;
});
