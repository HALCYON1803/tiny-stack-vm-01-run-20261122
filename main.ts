// Tiny stack VM for make.fun's tiny stack ISA: 32-bit wrapping values,
// a 256-value data stack, a 64-deep call stack, 256 words of memory.
// A trap ends a program at once with the trap's code, keeping the
// output written so far; one run answers every instance found.
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const IN_DIR = process.env.MAKEFUN_INPUT_DIR || "/input";
const OUT_DIR = process.env.MAKEFUN_OUTPUT_DIR || "/output";

function run(prog, input) {
  const st = new Int32Array(257);
  const cs = new Int32Array(64);
  const mem = new Int32Array(256);
  const out = Buffer.alloc(65536);
  const n = prog.length;
  let sp = 0, cp = 0, pc = 0, ip = 0, ol = 0, steps = 0;
  const need = (k) => { if (sp < k) throw 2; };
  const room = () => { if (sp >= 256) throw 3; };
  const off = () => { // signed 16-bit immediate
    const v = prog[pc + 1] | (prog[pc + 2] << 8);
    return v >= 32768 ? v - 65536 : v;
  };
  try {
    while (true) {
      // Per-step checks, in the order the spec lists them: the step
      // limit first, then pc range, then opcode, then immediate fit,
      // and only then the instruction's own stack and trap checks.
      // That order is what decides the exit code when several
      // faults coincide on the same step, so it must not be reordered.
      if (steps >= 1000000) throw 10;
      if (pc < 0 || pc >= n) throw 9;
      const op = prog[pc];
      let w = 1; // instruction width in bytes
      if (op === 1) w = 2;
      else if (op === 2) w = 5;
      else if (op >= 0x30 && op <= 0x33) w = 3;
      else if (!(op <= 7 || (op >= 0x10 && op <= 0x22) || op === 0x34 ||
        (op >= 0x40 && op <= 0x41) || (op >= 0x50 && op <= 0x53))) throw 5; // unknown opcode
      if (pc + w > n) throw 9;
      steps++;
      let nx = pc + w; // where pc goes unless the instruction jumps
      switch (op) {
        case 0x00: return [out.subarray(0, ol), 0];
        case 0x01: room(); st[sp++] = (prog[pc + 1] << 24) >> 24; break;
        case 0x02: room(); st[sp++] = prog[pc + 1] | (prog[pc + 2] << 8) | (prog[pc + 3] << 16) | (prog[pc + 4] << 24); break;
        case 0x03: need(1); sp--; break;
        case 0x04: need(1); room(); st[sp] = st[sp - 1]; sp++; break;
        case 0x05: need(2); { const t = st[sp - 1]; st[sp - 1] = st[sp - 2]; st[sp - 2] = t; } break;
        case 0x06: need(2); room(); st[sp] = st[sp - 2]; sp++; break;
        case 0x07: need(3); { const t = st[sp - 3]; st[sp - 3] = st[sp - 2]; st[sp - 2] = st[sp - 1]; st[sp - 1] = t; } break;
        case 0x10: need(2); { const b = st[sp - 1]; st[sp - 2] = (st[sp - 2] + b) | 0; sp--; } break;
        case 0x11: need(2); { const b = st[sp - 1]; st[sp - 2] = (st[sp - 2] - b) | 0; sp--; } break;
        case 0x12: need(2); { const b = st[sp - 1]; st[sp - 2] = Math.imul(st[sp - 2], b); sp--; } break;
        case 0x13: need(2); { const b = st[sp - 1]; if (!b) throw 4; st[sp - 2] = (st[sp - 2] / b) | 0; sp--; } break;
        case 0x14: need(2); { const b = st[sp - 1]; if (!b) throw 4; st[sp - 2] %= b; sp--; } break;
        case 0x15: need(2); { const b = st[sp - 1] >>> 0; if (!b) throw 4; st[sp - 2] = ((st[sp - 2] >>> 0) / b) | 0; sp--; } break;
        case 0x16: need(2); { const b = st[sp - 1] >>> 0; if (!b) throw 4; st[sp - 2] = ((st[sp - 2] >>> 0) % b) | 0; sp--; } break;
        case 0x17: need(1); st[sp - 1] = (-st[sp - 1]) | 0; break;
        case 0x18: need(2); { const b = st[sp - 1]; st[sp - 2] &= b; sp--; } break;
        case 0x19: need(2); { const b = st[sp - 1]; st[sp - 2] |= b; sp--; } break;
        case 0x1a: need(2); { const b = st[sp - 1]; st[sp - 2] ^= b; sp--; } break;
        case 0x1b: need(1); st[sp - 1] = ~st[sp - 1]; break;
        case 0x1c: need(2); { const b = st[sp - 1]; st[sp - 2] <<= b & 31; sp--; } break;
        case 0x1d: need(2); { const b = st[sp - 1]; st[sp - 2] >>= b & 31; sp--; } break;
        case 0x1e: need(2); { const b = st[sp - 1]; st[sp - 2] = (st[sp - 2] >>> (b & 31)) | 0; sp--; } break;
        case 0x20: need(2); { const b = st[sp - 1]; st[sp - 2] = st[sp - 2] === b ? 1 : 0; sp--; } break;
        case 0x21: need(2); { const b = st[sp - 1]; st[sp - 2] = st[sp - 2] < b ? 1 : 0; sp--; } break;
        case 0x22: need(2); { const b = st[sp - 1] >>> 0; st[sp - 2] = (st[sp - 2] >>> 0) < b ? 1 : 0; sp--; } break;
        case 0x30: nx = pc + w + off(); break;
        case 0x31: need(1); if (st[--sp] === 0) nx = pc + w + off(); break;
        case 0x32: need(1); if (st[--sp] !== 0) nx = pc + w + off(); break;
        case 0x33: if (cp >= 64) throw 7; cs[cp++] = pc + w; nx = prog[pc + 1] | (prog[pc + 2] << 8); break;
        case 0x34: if (!cp) throw 8; nx = cs[--cp]; break;
        case 0x40: need(1); { const a = st[sp - 1]; if (a < 0 || a > 255) throw 6; st[sp - 1] = mem[a]; } break;
        case 0x41: need(2); { const a = st[sp - 1]; if (a < 0 || a > 255) throw 6; mem[a] = st[sp - 2]; sp -= 2; } break;
        case 0x50: need(1); { const s = String(st[--sp]); if (ol + s.length > 65536) throw 11; out.write(s, ol); ol += s.length; } break;
        case 0x51: need(1); { const v = st[--sp]; if (ol + 1 > 65536) throw 11; out[ol++] = v & 255; } break;
        case 0x52: room(); st[sp++] = ip < input.length ? input[ip++] : -1; break;
        case 0x53: need(1); return [out.subarray(0, ol), st[--sp] & 255];
      }
      pc = nx;
    }
  } catch (c) { return [out.subarray(0, ol), c]; }
}

// An unreadable file reads as empty, so it still gets an answer.
function readQuiet(p) {
  try { return readFileSync(p); } catch { return Buffer.alloc(0); }
}

let ids = [];
try {
  ids = readdirSync(IN_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory()).map((d) => d.name).sort();
} catch {}

for (const id of ids) {
  const prog = readQuiet(join(IN_DIR, id, "program.bin"));
  const input = readQuiet(join(IN_DIR, id, "input.bin"));
  const [o, code] = run(prog, input);
  const dir = join(OUT_DIR, id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "stdout.bin"), o);
  writeFileSync(join(dir, "exit.txt"), code + "\n");
}
