import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const IN_DIR = process.env.MAKEFUN_INPUT_DIR || "/input";
const OUT_DIR = process.env.MAKEFUN_OUTPUT_DIR || "/output";

const META: Record<number, [number, number, number]> = {
  0x00: [0, 0, 0], 0x01: [0, 1, 1], 0x02: [0, 1, 4], 0x03: [1, 0, 0],
  0x04: [1, 2, 0], 0x05: [2, 2, 0], 0x06: [2, 3, 0], 0x07: [3, 3, 0],
  0x10: [2, 1, 0], 0x11: [2, 1, 0], 0x12: [2, 1, 0], 0x13: [2, 1, 0],
  0x14: [2, 1, 0], 0x15: [2, 1, 0], 0x16: [2, 1, 0], 0x17: [1, 1, 0],
  0x18: [2, 1, 0], 0x19: [2, 1, 0], 0x1a: [2, 1, 0], 0x1b: [1, 1, 0],
  0x1c: [2, 1, 0], 0x1d: [2, 1, 0], 0x1e: [2, 1, 0], 0x20: [2, 1, 0],
  0x21: [2, 1, 0], 0x22: [2, 1, 0], 0x30: [0, 0, 2], 0x31: [1, 0, 2],
  0x32: [1, 0, 2], 0x33: [0, 0, 2], 0x34: [0, 0, 0], 0x40: [1, 1, 0],
  0x41: [2, 0, 0], 0x50: [1, 0, 0], 0x51: [1, 0, 0], 0x52: [0, 1, 0],
  0x53: [1, 0, 0],
};

function s16(prog: Buffer, pc: number): number {
  const v = prog[pc + 1] | (prog[pc + 2] << 8);
  return v < 32768 ? v : v - 65536;
}

function run(prog: Buffer, input: Buffer): [number[], number] {
  const mem = new Int32Array(256); // 256 words, all zero at the start
  const ds = new Int32Array(257); // data stack, at most 256 values
  const cs = new Int32Array(64); // call stack, at most 64 addresses
  const out: number[] = [];
  let sp = 0, csp = 0, pc = 0, inPos = 0, steps = 0;
  for (;;) {
    // Checks in the spec's order: step limit, pc, opcode, immediate, stack.
    if (steps >= 1000000) return [out, 10];
    if (pc < 0 || pc >= prog.length) return [out, 9];
    const op = prog[pc];
    const m = META[op];
    if (!m) return [out, 5];
    if (pc + 1 + m[2] > prog.length) return [out, 9];
    if (sp < m[0]) return [out, 2];
    if (sp - m[0] + m[1] > 256) return [out, 3];
    steps++;
    let a = 0, b = 0;
    switch (op) {
      case 0x00: return [out, 0];
      case 0x01: { const v = prog[pc + 1]; ds[sp++] = v < 128 ? v : v - 256; pc += 2; break; }
      case 0x02: ds[sp++] = prog[pc + 1] | (prog[pc + 2] << 8) | (prog[pc + 3] << 16) | (prog[pc + 4] << 24); pc += 5; break;
      case 0x03: sp--; pc++; break;
      case 0x04: ds[sp] = ds[sp - 1]; sp++; pc++; break;
      case 0x05: a = ds[sp - 1]; ds[sp - 1] = ds[sp - 2]; ds[sp - 2] = a; pc++; break;
      case 0x06: ds[sp] = ds[sp - 2]; sp++; pc++; break;
      case 0x07: a = ds[sp - 3]; ds[sp - 3] = ds[sp - 2]; ds[sp - 2] = ds[sp - 1]; ds[sp - 1] = a; pc++; break;
      case 0x10: b = ds[--sp]; a = ds[--sp]; ds[sp++] = (a + b) | 0; pc++; break;
      case 0x11: b = ds[--sp]; a = ds[--sp]; ds[sp++] = (a - b) | 0; pc++; break;
      case 0x12: b = ds[--sp]; a = ds[--sp]; ds[sp++] = Math.imul(a, b); pc++; break;
      case 0x13: b = ds[--sp]; a = ds[--sp]; if (b === 0) return [out, 4]; ds[sp++] = Math.trunc(a / b) | 0; pc++; break;
      case 0x14: b = ds[--sp]; a = ds[--sp]; if (b === 0) return [out, 4]; ds[sp++] = (a % b) | 0; pc++; break;
      case 0x15: b = ds[--sp]; a = ds[--sp]; if (b === 0) return [out, 4]; ds[sp++] = Math.floor((a >>> 0) / (b >>> 0)) | 0; pc++; break;
      case 0x16: b = ds[--sp]; a = ds[--sp]; if (b === 0) return [out, 4]; ds[sp++] = ((a >>> 0) % (b >>> 0)) | 0; pc++; break;
      case 0x17: a = ds[--sp]; ds[sp++] = (-a) | 0; pc++; break;
      case 0x18: b = ds[--sp]; a = ds[--sp]; ds[sp++] = a & b; pc++; break;
      case 0x19: b = ds[--sp]; a = ds[--sp]; ds[sp++] = a | b; pc++; break;
      case 0x1a: b = ds[--sp]; a = ds[--sp]; ds[sp++] = a ^ b; pc++; break;
      case 0x1b: a = ds[--sp]; ds[sp++] = ~a; pc++; break;
      case 0x1c: b = ds[--sp]; a = ds[--sp]; ds[sp++] = a << (b & 31); pc++; break;
      case 0x1d: b = ds[--sp]; a = ds[--sp]; ds[sp++] = a >> (b & 31); pc++; break;
      case 0x1e: b = ds[--sp]; a = ds[--sp]; ds[sp++] = (a >>> (b & 31)) | 0; pc++; break;
      case 0x20: b = ds[--sp]; a = ds[--sp]; ds[sp++] = a === b ? 1 : 0; pc++; break;
      case 0x21: b = ds[--sp]; a = ds[--sp]; ds[sp++] = a < b ? 1 : 0; pc++; break;
      case 0x22: b = ds[--sp]; a = ds[--sp]; ds[sp++] = (a >>> 0) < (b >>> 0) ? 1 : 0; pc++; break;
      case 0x30: pc += 3 + s16(prog, pc); break;
      case 0x31: a = ds[--sp]; pc += 3 + (a === 0 ? s16(prog, pc) : 0); break;
      case 0x32: a = ds[--sp]; pc += 3 + (a !== 0 ? s16(prog, pc) : 0); break;
      case 0x33: if (csp >= 64) return [out, 7]; cs[csp++] = pc + 3; pc = prog[pc + 1] | (prog[pc + 2] << 8); break;
      case 0x34: if (csp === 0) return [out, 8]; pc = cs[--csp]; break;
      case 0x40: a = ds[--sp]; if (a < 0 || a > 255) return [out, 6]; ds[sp++] = mem[a]; pc++; break;
      case 0x41: a = ds[--sp]; b = ds[--sp]; if (a < 0 || a > 255) return [out, 6]; mem[a] = b; pc++; break;
      case 0x50: { a = ds[--sp]; const s = String(a); if (out.length + s.length > 65536) return [out, 11]; for (let i = 0; i < s.length; i++) out.push(s.charCodeAt(i)); pc++; break; }
      case 0x51: a = ds[--sp]; if (out.length + 1 > 65536) return [out, 11]; out.push(a & 255); pc++; break;
      case 0x52: ds[sp++] = inPos < input.length ? input[inPos++] : -1; pc++; break;
      case 0x53: a = ds[--sp]; return [out, a & 255];
    }
  }
}

const ids = readdirSync(IN_DIR, { withFileTypes: true })
  .filter((e) => e.isDirectory())
  .map((e) => e.name)
  .sort();
for (const id of ids) {
  const dir = join(IN_DIR, id);
  let prog = Buffer.alloc(0);
  let input = Buffer.alloc(0);
  try { prog = readFileSync(join(dir, "program.bin")); } catch {}
  try { input = readFileSync(join(dir, "input.bin")); } catch {}
  const [bytes, code] = run(prog, input);
  const outDir = join(OUT_DIR, id);
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, "stdout.bin"), Buffer.from(bytes));
  writeFileSync(join(outDir, "exit.txt"), String(code) + "\n");
}
