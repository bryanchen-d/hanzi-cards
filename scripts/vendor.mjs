// Copies the pinyin-pro ES module build into public/vendor so the static site
// can import it without a bundler or CDN. Runs automatically after `npm install`.
import { copyFileSync, cpSync, readFileSync, rmSync } from 'node:fs';

const src = new URL('../node_modules/pinyin-pro/', import.meta.url);
const dest = new URL('../public/vendor/pinyin-pro/', import.meta.url);
const { version } = JSON.parse(readFileSync(new URL('package.json', src), 'utf8'));

rmSync(dest, { recursive: true, force: true });
cpSync(new URL('dist/esm/', src), dest, { recursive: true });
copyFileSync(new URL('LICENSE', src), new URL('LICENSE', dest));
console.log(`Vendored pinyin-pro ${version} → public/vendor/pinyin-pro/`);
