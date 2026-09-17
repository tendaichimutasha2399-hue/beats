import 'dotenv/config';
import express from 'express';
import cookieParser from 'cookie-parser';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import db, { PUBLIC_DIR } from './db.js';
import { isValidShop, verifyQueryHmac } from './shopify.js';
import authRouter from './routes/auth.js';
import adminRouter from './routes/admin.js';
import webhookRouter from './routes/webhooks.js';
import downloadRouter from './routes/download.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.set('trust proxy', 1);

for (const key of ['SHOPIFY_API_KEY', 'SHOPIFY_API_SECRET', 'APP_URL', 'SESSION_SECRET']) {
  if (!process.env[key]) {
    console.error(`Missing ${key} in .env — copy .env.example to .env and fill it in.`);
    process.exit(1);
  }
}

// Webhooks need the raw body for signature checking, so they go before the JSON parser.
app.use('/webhooks', express.raw({ type: '*/*', limit: '5mb' }), webhookRouter);

app.use(express.json());
app.use(cookieParser(process.env.SESSION_SECRET));

app.use('/auth', authRouter);
app.use('/d', downloadRouter);
app.use('/media', express.static(PUBLIC_DIR, { maxAge: '7d' }));

function requireShop(req, res, next) {
  const queryShop = String(req.query.shop || '').toLowerCase();

  // Arriving from the Shopify admin: signed link, so trust it and set the session.
  if (queryShop && isValidShop(queryShop) && verifyQueryHmac(req.query)) {
    const connected = db.prepare('SELECT 1 FROM shops WHERE shop = ?').get(queryShop);
    if (!connected) return res.redirect(`/auth?shop=${encodeURIComponent(queryShop)}`);
    res.cookie('shop', queryShop, {
      signed: true, httpOnly: true, secure: true, sameSite: 'lax',
      maxAge: 30 * 24 * 60 * 60 * 1000,
    });
    req.shop = queryShop;
    return next();
  }

  const cookieShop = req.signedCookies.shop;
  if (cookieShop && db.prepare('SELECT 1 FROM shops WHERE shop = ?').get(cookieShop)) {
    req.shop = cookieShop;
    return next();
  }

  if (req.path.startsWith('/api') || req.xhr) return res.status(401).json({ error: 'Session expired. Reload the page.' });
  return res.redirect(queryShop ? `/auth?shop=${encodeURIComponent(queryShop)}` : '/');
}

app.use('/api', requireShop, adminRouter);
app.get('/admin', requireShop, (req, res) => res.sendFile(path.join(__dirname, 'views', 'admin.html')));

app.get('/', (req, res) => {
  if (req.signedCookies.shop) return res.redirect('/admin');
  res.type('html').send(`<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Connect your store</title>
<style>body{font:16px/1.5 system-ui,sans-serif;background:#14110f;color:#ede6df;display:grid;place-items:center;
height:100vh;margin:0;padding:20px}form{max-width:380px;width:100%}h1{font-size:24px;margin:0 0 6px}
p{color:#9a8f86;margin:0 0 20px}input,button{width:100%;padding:12px 14px;border-radius:8px;font:inherit;border:1px solid #3a322c}
input{background:#1e1a17;color:#ede6df;margin-bottom:10px}button{background:#e8a33d;color:#14110f;border:0;font-weight:600;cursor:pointer}
</style></head><body><form action="/auth" method="get">
<h1>Connect your store</h1><p>Enter the Shopify domain you want to sell beats from.</p>
<input name="shop" placeholder="your-store.myshopify.com" required>
<button type="submit">Connect store</button></form></body></html>`);
});

app.get('/healthz', (req, res) => res.json({ ok: true }));

app.use((err, req, res, next) => {
  console.error(err);
  res.status(err.status || 500).json({ error: err.message || 'Something broke.' });
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Beat store app listening on :${port} (${process.env.APP_URL})`));
