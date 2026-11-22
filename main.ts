// Tiny stack VM: faithful interpreter of make.fun's tiny stack ISA v1.
// Reads /input/<id>/program.bin + input.bin; writes /output/<id>/stdout.bin
// and /output/<id>/exit.txt. Per-step trap order: step cap 10, pc bounds 9,
// unknown opcode 5, truncated immediate 9, stack underflow 2, overflow 3;
// div-by-zero 4, bad address 6, call-stack 7/8, output full 11 fire in place.
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// Opcode table: one entry per opcode byte, packed imm|pops<<4|pushes<<8; -1 = trap 5.
const O = new Int32Array(256).fill(-1);
for (const [b, i, p, u] of [
  [0, 0, 0, 0], [1, 1, 0, 1], [2, 4, 0, 1], [3, 0, 1, 0],
  [4, 0, 1, 2], [5, 0, 2, 2], [6, 0, 2, 3], [7, 0, 3, 3],
  [16, 0, 2, 1], [17, 0, 2, 1], [18, 0, 2, 1], [19, 0, 2, 1],
  [20, 0, 2, 1], [21, 0, 2, 1], [22, 0, 2, 1], [23, 0, 1, 1],
  [24, 0, 2, 1], [25, 0, 2, 1], [26, 0, 2, 1], [27, 0, 1, 1],
  [28, 0, 2, 1], [29, 0, 2, 1], [30, 0, 2, 1], [32, 0, 2, 1],
  [33, 0, 2, 1], [34, 0, 2, 1], [48, 2, 0, 0], [49, 2, 1, 0],
  [50, 2, 1, 0], [51, 2, 0, 0], [52, 0, 0, 0], [64, 0, 1, 1],
  [65, 0, 2, 0], [80, 0, 1, 0], [81, 0, 1, 0], [82, 0, 0, 1],
  [83, 0, 1, 0],
]) O[b] = i | (p << 4) | (u << 8);

// Runs one program; returns [stdout bytes, exit code]. A trap ends it at once, keeping earlier output.
function run(p: Uint8Array, inp: Uint8Array): [Uint8Array, number] {
  const n = p.length;
  const D = new Int32Array(256);
  let sp = 0;
  const C = new Int32Array(64);
  let cp = 0;
  const M = new Int32Array(256);
  const out = new Uint8Array(65536);
  let ol = 0;
  let ip = 0;
  let pc = 0;
  let steps = 0;
  const done = (code: number): [Uint8Array, number] => [out.subarray(0, ol), code];
  for (;;) {
    if (steps === 1000000) return done(10);
    if (pc < 0 || pc >= n) return done(9);
    const o = O[p[pc]];
    if (o < 0) return done(5);
    const imm = o & 7;
    if (pc + imm >= n) return done(9);
    steps++;
    const po = (o >> 4) & 7;
    const pu = (o >> 8) & 7;
    if (sp < po) return done(2);
    if (sp - po + pu > 256) return done(3);
    const next = pc + 1 + imm;
    pc = next;
    const op = p[pc - 1 - imm];
    switch (op) {
      case 0: return done(0);
      case 1: D[sp++] = (p[next - 1] << 24) >> 24; break;
      case 2: D[sp++] = p[next - 4] | (p[next - 3] << 8) | (p[next - 2] << 16) | (p[next - 1] << 24); break;
      case 3: sp--; break;
      case 4: D[sp] = D[sp - 1]; sp++; break;
      case 5: { const t = D[sp - 1]; D[sp - 1] = D[sp - 2]; D[sp - 2] = t; break; }
      case 6: D[sp] = D[sp - 2]; sp++; break;
      case 7: { const a = D[sp - 3]; D[sp - 3] = D[sp - 2]; D[sp - 2] = D[sp - 1]; D[sp - 1] = a; break; }
      case 23: D[sp - 1] = -D[sp - 1] | 0; break;
      case 27: D[sp - 1] = ~D[sp - 1]; break;
      case 48: case 49: case 50: {
        const rel = ((p[next - 2] | (p[next - 1] << 8)) << 16) >> 16;
        let take = true;
        if (op !== 48) { const v = D[--sp]; take = op === 49 ? v === 0 : v !== 0; }
        if (take) pc = next + rel;
        break;
      }
      case 51:
        if (cp === 64) return done(7);
        C[cp++] = next;
        pc = p[next - 2] | (p[next - 1] << 8);
        break;
      case 52:
        if (cp === 0) return done(8);
        pc = C[--cp];
        break;
      case 64: {
        const a = D[sp - 1];
        if (a < 0 || a >= 256) return done(6);
        D[sp - 1] = M[a];
        break;
      }
      case 65: {
        const a = D[sp - 1];
        const v = D[sp - 2];
        if (a < 0 || a >= 256) return done(6);
        sp -= 2;
        M[a] = v;
        break;
      }
      case 80: {
        const s = String(D[sp - 1]);
        if (ol + s.length > 65536) return done(11);
        sp--;
        for (let i = 0; i < s.length; i++) out[ol++] = s.charCodeAt(i);
        break;
      }
      case 81:
        if (ol + 1 > 65536) return done(11);
        out[ol++] = D[--sp] & 255;
        break;
      case 82: D[sp++] = ip < inp.length ? inp[ip++] : -1; break;
      case 83: return done(D[--sp] & 255);
      default: {
        const b = D[sp - 1];
        const a = D[sp - 2];
        let r: number;
        if (op === 16) r = (a + b) | 0;
        else if (op === 17) r = (a - b) | 0;
        else if (op === 18) r = Math.imul(a, b);
        else if (op === 19) {
          if (b === 0) return done(4);
          r = a === -2147483648 && b === -1 ? a : (a / b) | 0;
        } else if (op === 20) {
          if (b === 0) return done(4);
          r = b === -1 ? 0 : (a % b) | 0;
        } else if (op === 21) {
          if (b === 0) return done(4);
          r = Math.floor((a >>> 0) / (b >>> 0)) | 0;
        } else if (op === 22) {
          if (b === 0) return done(4);
          r = ((a >>> 0) % (b >>> 0)) | 0;
        } else if (op === 24) r = a & b;
        else if (op === 25) r = a | b;
        else if (op === 26) r = a ^ b;
        else if (op === 28) r = a << (b & 31);
        else if (op === 29) r = a >> (b & 31);
        else if (op === 30) r = (a >>> (b & 31)) | 0;
        else if (op === 32) r = a === b ? 1 : 0;
        else if (op === 33) r = a < b ? 1 : 0;
        else r = (a >>> 0) < (b >>> 0) ? 1 : 0;
        sp -= 2;
        D[sp++] = r;
        break;
      }
    }
  }
}

const INP = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const OUTD = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
for (const e of readdirSync(INP, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
  if (!e.isDirectory()) continue;
  const id = e.name;
  let out: Uint8Array = new Uint8Array(0);
  let code = 0;
  try {
    const r = run(new Uint8Array(readFileSync(join(INP, id, 'program.bin'))), new Uint8Array(readFileSync(join(INP, id, 'input.bin'))));
    out = r[0];
    code = r[1];
  } catch {
    // A program that cannot be read still gets an answer in the stated format.
  }
  mkdirSync(join(OUTD, id), { recursive: true });
  writeFileSync(join(OUTD, id, 'stdout.bin'), out);
  writeFileSync(join(OUTD, id, 'exit.txt'), `${code}\n`);
}
