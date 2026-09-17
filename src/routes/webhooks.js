import express from 'express';
import crypto from 'node:crypto';
import path from 'node:path';
import db, { PRIVATE_DIR } from '../db.js';
import { verifyWebhook, gql } from '../shopify.js';
import { TIERS, tierName, buildLicensePdf } from '../licenses.js';
import { sendDelivery } from '../mailer.js';

const router = express.Router();

function guard(req, res, next) {
  if (!verifyWebhook(req.body, req.get('X-Shopify-Hmac-Sha256'))) {
    return res.status(401).send('bad hmac');
  }
  req.shopDomain = req.get('X-Shopify-Shop-Domain');
  req.payload = JSON.parse(req.body.toString('utf8'));
  next();
}

router.post('/orders/paid', guard, (req, res) => {
  // Shopify expects a fast 200. Do the work after replying.
  res.status(200).send('ok');
  setImmediate(() => fulfilOrder(req.shopDomain, req.payload).catch((e) => console.error('fulfil failed', e)));
});

router.post('/app/uninstalled', guard, (req, res) => {
  db.prepare('DELETE FROM shops WHERE shop = ?').run(req.shopDomain);
  console.log(`[app] uninstalled from ${req.shopDomain}`);
  res.status(200).send('ok');
});

// Shopify's mandatory privacy webhooks. Nothing to do: we store no browsing data,
// and buyer records are removed with the shop on uninstall.
for (const p of ['/customers/data_request', '/customers/redact', '/shop/redact']) {
  router.post(p, guard, (req, res) => res.status(200).send('ok'));
}

async function fulfilOrder(shop, order) {
  const lineItems = order.line_items || [];
  const buyerName =
    [order.customer?.first_name, order.customer?.last_name].filter(Boolean).join(' ') ||
    order.billing_address?.name ||
    order.shipping_address?.name ||
    null;
  const buyerEmail = order.email || order.contact_email || order.customer?.email || null;

  const producer = {
    name: process.env.PRODUCER_NAME || 'Producer',
    legalName: process.env.PRODUCER_LEGAL_NAME || process.env.PRODUCER_NAME || 'Producer',
    email: process.env.PRODUCER_EMAIL || '',
    country: process.env.PRODUCER_COUNTRY || 'Zimbabwe',
  };

  for (const item of lineItems) {
    const asset = db
      .prepare('SELECT * FROM assets WHERE variant_id = ?')
      .get(String(item.variant_id));
    if (!asset) continue;

    const product = db
      .prepare('SELECT * FROM products WHERE id = ? AND shop = ?')
      .get(asset.product_id, shop);
    if (!product) continue;

    const already = db
      .prepare('SELECT token FROM licenses WHERE order_id = ? AND asset_id = ?')
      .get(String(order.id), asset.id);
    if (already) continue;

    const now = new Date();
    const expires = new Date(now.getTime() + Number(process.env.DOWNLOAD_DAYS || 30) * 86400000);
    const token = crypto.randomBytes(24).toString('hex');
    const code = `BS-${now.getFullYear()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;

    const info = db
      .prepare(
        `INSERT INTO licenses (shop, order_id, order_number, product_id, asset_id, tier,
                               buyer_name, buyer_email, license_code, token, created_at, expires_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        shop,
        String(order.id),
        String(order.order_number ?? order.name ?? ''),
        product.id,
        asset.id,
        asset.tier,
        buyerName,
        buyerEmail,
        code,
        token,
        now.toISOString(),
        expires.toISOString(),
      );

    const license = db.prepare('SELECT * FROM licenses WHERE id = ?').get(info.lastInsertRowid);

    const pdfPath = path.join(PRIVATE_DIR, 'licenses', `${code}.pdf`);
    await buildLicensePdf({ outPath: pdfPath, license, product, producer });
    db.prepare('UPDATE licenses SET pdf_path = ? WHERE id = ?').run(pdfPath, license.id);

    if (buyerEmail) {
      await sendDelivery({
        to: buyerEmail,
        buyerName,
        title: product.title,
        tierName: tierName(asset.tier),
        link: `${process.env.APP_URL}/d/${token}`,
        expiresAt: expires.toISOString().slice(0, 10),
      }).catch((e) => console.error('email failed', e));
    } else {
      console.warn(`[delivery] No buyer email on order ${order.id}. Link: ${process.env.APP_URL}/d/${token}`);
    }

    // Exclusive sale — pull the beat out of the store so nobody else can licence it.
    if (TIERS[asset.tier]?.exclusive && product.shopify_product_id) {
      const row = db.prepare('SELECT access_token FROM shops WHERE shop = ?').get(shop);
      if (row) {
        await gql(
          shop,
          row.access_token,
          `mutation Archive($product: ProductUpdateInput!) {
            productUpdate(product: $product) { product { id status } userErrors { message } }
          }`,
          { product: { id: `gid://shopify/Product/${product.shopify_product_id}`, status: 'ARCHIVED' } },
        ).catch((e) => console.error('archive failed', e));
        db.prepare("UPDATE products SET status = 'sold_exclusive' WHERE id = ?").run(product.id);
      }
    }
  }
}

export default router;
