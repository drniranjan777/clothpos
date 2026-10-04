// Real EAN-13 encoding (scannable when printed) for product labels; falls back to a Code-style placeholder for non-EAN values.
const L = ['0001101', '0011001', '0010011', '0111101', '0100011', '0110001', '0101111', '0111011', '0110111', '0001011'];
const G = ['0100111', '0110011', '0011011', '0100001', '0011101', '0111001', '0000101', '0010001', '0001001', '0010111'];
const R = ['1110010', '1100110', '1101100', '1000010', '1011100', '1001110', '1010000', '1000100', '1001000', '1110100'];
const PARITY = ['LLLLLL', 'LLGLGG', 'LLGGLG', 'LLGGGL', 'LGLLGG', 'LGGLLG', 'LGGGLL', 'LGLGLG', 'LGLGGL', 'LGGLGL'];

function ean13Bits(code: string) {
  const d = code.split('').map(Number);
  const parity = PARITY[d[0]];
  let bits = '101';
  for (let i = 1; i <= 6; i++) bits += (parity[i - 1] === 'L' ? L : G)[d[i]];
  bits += '01010';
  for (let i = 7; i <= 12; i++) bits += R[d[i]];
  return bits + '101';
}

export function Barcode({ value, height = 46, module = 1.6 }: { value: string; height?: number; module?: number }) {
  const bits = /^\d{13}$/.test(value) ? ean13Bits(value) : value.split('').map((c) => (c.charCodeAt(0) % 2 ? '1101' : '1001')).join('') + '1';
  const w = bits.length * module;
  return (
    <div style={{ textAlign: 'center' }}>
      <svg width={w} height={height} viewBox={`0 0 ${bits.length} ${height}`} preserveAspectRatio="none" shapeRendering="crispEdges">
        {bits.split('').map((b, i) => (b === '1' ? <rect key={i} x={i} y={0} width={1} height={height} fill="#0f172a" /> : null))}
      </svg>
      <div className="num" style={{ fontSize: 11, letterSpacing: '.18em', marginTop: 2 }}>{value}</div>
    </div>
  );
}
