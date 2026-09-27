/**
 * Манифест релиза latest.json — по нему мобильное приложение узнаёт о новой версии
 * (без GitHub API и его лимита 60 запросов/час на IP — в сети вуза это важно).
 *
 *   node scripts/make-release-manifest.mjs <dir> <version> [notes-file]
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const [dir, version, notesFile] = process.argv.slice(2);
if (!dir || !version) {
  console.error('Использование: node scripts/make-release-manifest.mjs <dir> <version> [notes-file]');
  process.exit(1);
}

const files = fs.readdirSync(dir)
  .filter((n) => !['latest.json', 'SHA256SUMS.txt', 'SHA256SUMS.txt.sig'].includes(n))
  .filter((n) => fs.statSync(path.join(dir, n)).isFile())
  .sort()
  .map((name) => {
    const buf = fs.readFileSync(path.join(dir, name));
    return { name, size: buf.length, sha256: createHash('sha256').update(buf).digest('hex') };
  });

const manifest = {
  version: version.replace(/^v/, ''),
  tag: `v${version.replace(/^v/, '')}`,
  publishedAt: new Date().toISOString(),
  notes: notesFile && fs.existsSync(notesFile) ? fs.readFileSync(notesFile, 'utf8').trim() : '',
  files
};

fs.writeFileSync(path.join(dir, 'latest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(`latest.json: v${manifest.version}, файлов: ${files.length}`);
