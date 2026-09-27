/**
 * Генерация ключа подписи обновлений (Ed25519). Запускать ОДИН раз.
 *
 *   node scripts/update-keys.mjs
 *
 * - публичный ключ пишется в electron/update-public-key.pem — его коммитим;
 * - приватный ключ пишется в файл ВНЕ репозитория (домашняя папка) — его кладём
 *   в секрет UPDATE_SIGNING_KEY окружения "release" на GitHub и храним резервную копию.
 */
import { generateKeyPairSync } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pubPath = path.join(root, 'electron', 'update-public-key.pem');
const privPath = path.join(os.homedir(), 'darkmsal-update-signing-key.pem');

if (fs.existsSync(pubPath) && !process.argv.includes('--force')) {
  console.error(`Ключ уже есть: ${pubPath}\nПерегенерация сломает обновления у всех установленных копий. Если точно надо — добавь --force.`);
  process.exit(1);
}
if (fs.existsSync(privPath)) {
  console.error(`Файл ${privPath} уже существует — не перезаписываю.`);
  process.exit(1);
}

const { publicKey, privateKey } = generateKeyPairSync('ed25519');
fs.writeFileSync(pubPath, publicKey.export({ type: 'spki', format: 'pem' }));
fs.writeFileSync(privPath, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });

console.log(`Публичный ключ: ${pubPath} (закоммить)`);
console.log(`Приватный ключ: ${privPath}`);
console.log('\nДальше: GitHub → Settings → Environments → release → Add secret');
console.log('  имя: UPDATE_SIGNING_KEY, значение: всё содержимое файла приватного ключа.');
console.log('Сохрани копию приватного ключа в надёжном месте. Потеряешь — придётся перевыпускать приложение.');
