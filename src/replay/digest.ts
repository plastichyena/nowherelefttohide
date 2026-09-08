// Incremental SHA-256 keeps Artifact stream validation independent of history length.
const K = new Uint32Array([0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2]);
const rotate = (n: number, r: number) => (n >>> r) | (n << (32 - r));
export class Digest {
  private h = new Uint32Array([0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19]);
  private pending = new Uint8Array(64); private used = 0; private length = 0;
  update(bytes: Uint8Array): this { this.length += bytes.length; let at = 0; while (at < bytes.length) { const n = Math.min(64 - this.used, bytes.length - at); this.pending.set(bytes.subarray(at, at + n), this.used); this.used += n; at += n; if (this.used === 64) { this.block(this.pending); this.used = 0; } } return this; }
  private block(bytes: Uint8Array) {
    const w = new Uint32Array(64), view = new DataView(bytes.buffer, bytes.byteOffset, 64);
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(i * 4);
    for (let i = 16; i < 64; i++) { const x = w[i - 15]!, y = w[i - 2]!; w[i] = w[i - 16]! + (rotate(x,7) ^ rotate(x,18) ^ (x >>> 3)) + w[i - 7]! + (rotate(y,17) ^ rotate(y,19) ^ (y >>> 10)); }
    let [a,b,c,d,e,f,g,h] = [...this.h] as [number,number,number,number,number,number,number,number];
    for (let i = 0; i < 64; i++) { const t = (h + (rotate(e,6) ^ rotate(e,11) ^ rotate(e,25)) + ((e & f) ^ (~e & g)) + K[i]! + w[i]!) >>> 0; const u = ((rotate(a,2) ^ rotate(a,13) ^ rotate(a,22)) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0; h=g;g=f;f=e;e=(d+t)>>>0;d=c;c=b;b=a;a=(t+u)>>>0; }
    [a,b,c,d,e,f,g,h].forEach((v,i) => { this.h[i] = this.h[i]! + v; });
  }
  hex(): string { const bits = this.length * 8, tail = new Uint8Array(this.used < 56 ? 64 : 128); tail.set(this.pending.subarray(0,this.used)); tail[this.used] = 128; const v = new DataView(tail.buffer); v.setUint32(tail.length - 8, Math.floor(bits / 4294967296)); v.setUint32(tail.length - 4, bits >>> 0); for (let i=0;i<tail.length;i+=64) this.block(tail.subarray(i,i+64)); return [...this.h].map(n=>n.toString(16).padStart(8,'0')).join(''); }
}
export function canonical(value: unknown): string {
  const normalize = (v: unknown): unknown => Array.isArray(v) ? v.map(normalize) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort((a,b)=>a.localeCompare(b)).map(k=>[k,normalize((v as Record<string,unknown>)[k])])) : v;
  return JSON.stringify(normalize(value));
}
export const hashJson = (v: unknown) => new Digest().update(new TextEncoder().encode(canonical(v))).hex();
export const checkHash = (v: Record<string, unknown>, field: string) => { const copy = {...v}; delete copy[field]; if (hashJson(copy) !== v[field]) throw new Error(`Invalid ${field}`); };
