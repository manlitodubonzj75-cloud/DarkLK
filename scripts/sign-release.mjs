/**
 * Подпись файла ключом из переменной UPDATE_SIGNING_KEY (Ed25519, PEM).
 * Создаёт <file>.sig (base64) и сразу проверяет подпись публичным ключом из репозитория —
 * так CI упадёт, если секрет не соответствует ключу, вшитому в приложение.
 *
 *   UPDATE_SIGNING_KEY="$(cat key.pem)" node scripts/sign-release.mjs final-release/SHA256SUMS.txt
 */
import { createPrivateKey, createPublicKey, sign, verify } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const file = process.argv[2];
if (!file) {
  console.error('Использование: node scripts/sign-release.mjs <file>');
  process.exit(1);
}
const pem = process.env.UPDATE_SIGNING_KEY;
if (!pem) {
  console.error('Нет UPDATE_SIGNING_KEY');
  process.exit(1);
}
const pubPath = path.join(root, 'electron', 'update-public-key.pem');
if (!fs.existsSync(pubPath)) {
  console.error('Нет electron/update-public-key.pem — сначала node scripts/update-keys.mjs');
  process.exit(1);
}

const data = fs.readFileSync(file);
const sig = sign(null, data, createPrivateKey(pem));
if (!verify(null, data, createPublicKey(fs.readFileSync(pubPath)), sig)) {
  console.error('Секрет UPDATE_SIGNING_KEY не соответствует electron/update-public-key.pem');
  process.exit(1);
}
fs.writeFileSync(`${file}.sig`, sig.toString('base64') + '\n');
console.log(`Подписано: ${file}.sig`);
