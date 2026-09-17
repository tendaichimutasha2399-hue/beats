import express from 'express';
import crypto from 'node:crypto';
import db from '../db.js';
import {
  isValidShop,
  verifyQueryHmac,
  buildAuthUrl,
  exchangeCodeForToken,
  registerWebhooks,
} from '../shopify.js';

const router = express.Router();

// Step 1 — merchant lands here from the install link or the Shopify admin.
router.get('/', (req, res) => {
  const shop = String(req.query.shop || '').toLowerCase();
  if (!isValidShop(shop)) return res.status(400).send('Add ?shop=your-store.myshopify.com to the URL.');

  const state = crypto.randomBytes(16).toString('hex');
  res.cookie('oauth_state', state, {
    signed: true,
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    maxAge: 10 * 60 * 1000,
  });
  res.redirect(buildAuthUrl(shop, state));
});

// Step 2 — Shopify sends the merchant back with a code.
router.get('/callback', async (req, res) => {
  try {
    const shop = String(req.query.shop || '').toLowerCase();
    if (!isValidShop(shop)) return res.status(400).send('Invalid shop.');
    if (!verifyQueryHmac(req.query)) return res.status(401).send('Signature check failed.');
    if (req.query.state !== req.signedCookies.oauth_state) return res.status(401).send('State check failed. Start the install again.');

    const token = await exchangeCodeForToken(shop, req.query.code);

    db.prepare(
      `INSERT INTO shops (shop, access_token, installed_at) VALUES (?, ?, ?)
       ON CONFLICT(shop) DO UPDATE SET access_token = excluded.access_token`,
    ).run(shop, token, new Date().toISOString());

    await registerWebhooks(shop, token);

    res.clearCookie('oauth_state');
    res.cookie('shop', shop, {
      signed: true,
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      maxAge: 30 * 24 * 60 * 60 * 1000,
    });
    res.redirect('/admin');
  } catch (err) {
    console.error(err);
    res.status(500).send(`Install failed: ${err.message}`);
  }
});

router.get('/logout', (req, res) => {
  res.clearCookie('shop');
  res.redirect('/');
});

export default router;
