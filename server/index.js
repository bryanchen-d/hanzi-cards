// Local preview server for the static site in public/.
// It is served at both / and /hanzi-cards/ (the GitHub Pages path), so relative-path bugs show up locally.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';

const publicDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
const port = Number(process.env.PORT) || 3000;
const host = process.env.HOST || 'localhost';

const app = express();
app.disable('x-powered-by');
app.use('/hanzi-cards', express.static(publicDir));
app.use(express.static(publicDir));

const server = app.listen(port, host, () => {
  console.log(`Hanzi Cards preview at http://${host}:${port}/ (also /hanzi-cards/)`);
});

const shutdown = () => server.close(() => process.exit(0));
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
