/**
 * @file argon2-auth.ts
 * @description Cryptographic PIN and Master Password derivation using Argon2id (`@noble/hashes/argon2`).
 * Generates a 16-byte random salt and encodes hashes in standard PHC string format
 * (`$argon2id$v=19$m=...,t=...,p=...$<salt_hex>$<hash_hex>`), verified in constant time.
 */
import { argon2id } from '@noble/hashes/argon2';
import { randomBytes } from '@noble/hashes/utils';
import { parseWithSchema, pinSchema } from '@/lib/schemas';

const ARGON2_MEMORY = 4096; // 4 MiB fast enough for UI/tests while cryptographically Argon2id
const ARGON2_ITERATIONS = 2;
const ARGON2_PARALLELISM = 1;
const ARGON2_KEY_LEN = 32;

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.trim();
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

/**
 * Constant-time hexadecimal string comparison to mitigate timing side-channel attacks.
 */
function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

/**
 * Derives an Argon2id PHC string from a user PIN or Master Password (min 4 characters)
 * using a fresh 128-bit cryptographic salt.
 */
export function hashPinArgon2id(pin: string): string {
  const trimmed = parseWithSchema(pinSchema, pin);
  const salt = randomBytes(16);
  const derived = argon2id(trimmed, salt, {
    m: ARGON2_MEMORY,
    t: ARGON2_ITERATIONS,
    p: ARGON2_PARALLELISM,
    dkLen: ARGON2_KEY_LEN,
  });
  return `$argon2id$v=19$m=${ARGON2_MEMORY},t=${ARGON2_ITERATIONS},p=${ARGON2_PARALLELISM}$${bytesToHex(salt)}$${bytesToHex(derived)}`;
}

/**
 * Verifies a candidate PIN or Master Password against an Argon2id PHC string in constant time.
 */
export function verifyPinArgon2id(pin: string, encodedHash: string): boolean {
  const trimmed = pin.trim();
  if (!trimmed || !encodedHash) return false;
  const parts = encodedHash.split('$').filter(Boolean);
  // Format: ['argon2id', 'v=19', 'm=...,t=...,p=...', '<salt_hex>', '<hash_hex>']
  if (parts.length !== 5 || parts[0] !== 'argon2id') {
    return false;
  }
  const paramsPart = parts[2];
  const saltHex = parts[3];
  const expectedHex = parts[4];

  let m = ARGON2_MEMORY;
  let t = ARGON2_ITERATIONS;
  let p = ARGON2_PARALLELISM;
  for (const kv of paramsPart.split(',')) {
    const [k, v] = kv.split('=');
    const num = parseInt(v, 10);
    if (!Number.isNaN(num)) {
      if (k === 'm') m = num;
      if (k === 't') t = num;
      if (k === 'p') p = num;
    }
  }

  const salt = hexToBytes(saltHex);
  const derived = argon2id(trimmed, salt, {
    m,
    t,
    p,
    dkLen: expectedHex.length / 2,
  });
  return timingSafeEqualHex(bytesToHex(derived), expectedHex);
}
