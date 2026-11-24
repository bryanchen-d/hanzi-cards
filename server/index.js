import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.js';
import { openDatabase } from './db.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.env.PORT) || 3000;
const host = process.env.HOST || 'localhost';
const dbFile = process.env.HANZI_DB || path.join(root, 'data', 'hanzi.db');

const db = openDatabase(dbFile);
const app = createApp({ db, secureCookies: process.env.SECURE_COOKIES === '1' });

const server = app.listen(port, host, () => {
  console.log(`Hanzi Cards running at http://${host}:${port}`);
  console.log(`Database: ${dbFile}`);
});

function shutdown() {
  server.close(() => {
    db.close();
    process.exit(0);
  });
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
