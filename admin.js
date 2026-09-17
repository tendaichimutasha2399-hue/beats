import express from 'express';
import multer from 'multer';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import db, { PRIVATE_DIR, PUBLIC_DIR } from '../db.js';
import { gql, getOnlineStorePublicationId, numericId } from '../shopify.js';
import { TIERS, tierName } from '../licenses.js';
import { sendDelivery, mailEnabled } from '../mailer.js';

const router = express.Router();

const storage = multer.diskStorage({
  destination(req, file, cb) {
    const isPublic = file.fieldname === 'artwork' || file.fieldname === 'preview';
    cb(null, isPublic ? PUBLIC_DIR : PRIVATE_DIR);
  },
  filename(req, file, cb) {
    const safe = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-80);
    cb(null, `${crypto.randomBytes(8).toString('hex')}-${safe}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: Number(process.env.MAX_UPLOAD_MB || 1024) * 1024 * 1024 },
});

function shopToken(shop) {
  const row = db.prepare('SELECT access_token FROM shops WHERE shop = ?').get(shop);
  if (!row) throw new Error('Store not connected. Reinstall the app.');
  return row.access_token;
}

/* ------------------------------------------------------------------ catalogue */

router.get('/catalog', (req, res) => {
  const products = db
    .prepare('SELECT * FROM products WHERE shop = ? ORDER BY id DESC')
    .all(req.shop);
  const assets = db.prepare('SELECT id, product_id, tier, price FROM assets').all();
  res.json(
    products.map((p) => ({
      ...p,
      tiers: assets
        .filter((a) => a.product_id === p.id)
        .map((a) => ({ tier: a.tier, name: tierName(a.tier), price: a.price })),
      admin_url: p.shopify_product_id
        ? `https://${req.shop}/admin/products/${p.shopify_product_id}`
        : null,
    })),
  );
});

router.get('/tiers', (req, res) => {
  res.json(
    Object.entries(TIERS).map(([key, t]) => ({
      key,
      name: t.name,
      kind: t.kind,
      files: t.files,
      blurb: t.blurb,
      exclusive: Boolean(t.exclusive),
    })),
  );
});

/* ------------------------------------------------------------------ create */

router.post('/products', upload.any(), async (req, res) => {
  const written = (req.files || []).map((f) => f.path);
  try {
    const token = shopToken(req.shop);
    const kind = req.body.kind === 'pack' ? 'pack' : 'beat';
    const title = (req.body.title || '').trim();
    if (!title) throw new Error('Give it a title.');

    const prices = JSON.parse(req.body.prices || '{}');
    const byField = Object.fromEntries((req.files || []).map((f) => [f.fieldname, f]));

    const chosen = Object.keys(prices).filter((tier) => TIERS[tier] && byField[`file_${tier}`]);
    if (!chosen.length) throw new Error('Add a price and a file for at least one licence.');

    const artwork = byField.artwork?.filename || null;
    const preview = byField.preview?.filename || null;
    const now = new Date().toISOString();

    const info = db
      .prepare(
        `INSERT INTO products (shop, kind, title, bpm, music_key, genre, tags, description,
                               artwork, preview, status, created_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,'active',?)`,
      )
      .run(
        req.shop,
        kind,
        title,
        req.body.bpm ? Number(req.body.bpm) : null,
        req.body.music_key || null,
        req.body.genre || null,
        req.body.tags || null,
        req.body.description || null,
        artwork,
        preview,
        now,
      );
    const productId = info.lastInsertRowid;

    const insertAsset = db.prepare(
      'INSERT INTO assets (product_id, tier, price, file_path, file_name) VALUES (?,?,?,?,?)',
    );
    for (const tier of chosen) {
      const f = byField[`file_${tier}`];
      insertAsset.run(productId, tier, String(Number(prices[tier]).toFixed(2)), f.path, f.originalname);
    }

    const shopify = await createShopifyProduct({
      shop: req.shop,
      token,
      kind,
      title,
      body: req.body,
      chosen,
      prices,
      artwork,
      preview,
    });

    db.prepare('UPDATE products SET shopify_product_id = ?, shopify_handle = ? WHERE id = ?')
      .run(shopify.productId, shopify.handle, productId);

    const setVariant = db.prepare('UPDATE assets SET variant_id = ? WHERE product_id = ? AND tier = ?');
    for (const v of shopify.variants) setVariant.run(v.variantId, productId, v.tier);

    res.json({ ok: true, id: productId, url: `https://${req.shop}/products/${shopify.handle}` });
  } catch (err) {
    console.error(err);
    for (const p of written) fs.rm(p, { force: true }, () => {});
    res.status(400).json({ error: err.message });
  }
});

async function createShopifyProduct({ shop, token, kind, title, body, chosen, prices, artwork, preview }) {
  const tierNames = chosen.map((t) => TIERS[t].name);
  const descriptionHtml = buildDescription({ kind, body, chosen });

  const media = artwork
    ? [{ originalSource: `${process.env.APP_URL}/media/${artwork}`, mediaContentType: 'IMAGE', alt: title }]
    : [];

  const metafields = [{ namespace: 'beatstore', key: 'kind', type: 'single_line_text_field', value: kind }];
  if (preview) {
    metafields.push({
      namespace: 'beatstore',
      key: 'preview_url',
      type: 'url',
      value: `${process.env.APP_URL}/media/${preview}`,
    });
  }
  if (body.bpm) metafields.push({ namespace: 'beatstore', key: 'bpm', type: 'number_integer', value: String(Number(body.bpm)) });
  if (body.music_key) metafields.push({ namespace: 'beatstore', key: 'song_key', type: 'single_line_text_field', value: body.music_key });

  const created = await gql(
    shop,
    token,
    `mutation Create($product: ProductCreateInput!, $media: [CreateMediaInput!]) {
      productCreate(product: $product, media: $media) {
        product { id handle }
        userErrors { field message }
      }
    }`,
    {
      product: {
        title,
        descriptionHtml,
        vendor: process.env.PRODUCER_NAME || undefined,
        productType: kind === 'pack' ? 'Sample Pack' : 'Beat',
        status: 'ACTIVE',
        tags: [
          kind === 'pack' ? 'sample pack' : 'beat',
          body.genre,
          body.bpm ? `${body.bpm} bpm` : null,
          body.music_key,
          ...(body.tags || '').split(',').map((t) => t.trim()),
        ].filter(Boolean),
        productOptions: [{ name: 'License', values: tierNames.map((name) => ({ name })) }],
        metafields,
      },
      media,
    },
  );

  const productGid = created.productCreate.product.id;
  const handle = created.productCreate.product.handle;

  const variantsRes = await gql(
    shop,
    token,
    `mutation AddVariants($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
      productVariantsBulkCreate(productId: $productId, variants: $variants, strategy: REMOVE_STANDALONE_VARIANT) {
        productVariants { id title selectedOptions { name value } }
        userErrors { field message }
      }
    }`,
    {
      productId: productGid,
      variants: chosen.map((tier) => ({
        optionValues: [{ optionName: 'License', name: TIERS[tier].name }],
        price: String(Number(prices[tier]).toFixed(2)),
        taxable: true,
        inventoryItem: { tracked: false, requiresShipping: false },
      })),
    },
  );

  const publicationId = await getOnlineStorePublicationId(shop, token);
  if (publicationId) {
    await gql(
      shop,
      token,
      `mutation Publish($id: ID!, $input: [PublicationInput!]!) {
        publishablePublish(id: $id, input: $input) { userErrors { field message } }
      }`,
      { id: productGid, input: [{ publicationId }] },
    );
  }

  const variants = variantsRes.productVariantsBulkCreate.productVariants.map((v) => {
    const label = v.selectedOptions.find((o) => o.name === 'License')?.value;
    const tier = chosen.find((t) => TIERS[t].name === label);
    return { tier, variantId: numericId(v.id) };
  });

  return { productId: numericId(productGid), handle, variants };
}

function buildDescription({ kind, body, chosen }) {
  const lines = [];
  if (body.description) lines.push(`<p>${escapeHtml(body.description)}</p>`);

  const specs = [
    body.bpm ? `${body.bpm} BPM` : null,
    body.music_key ? `Key of ${body.music_key}` : null,
    body.genre,
  ].filter(Boolean);
  if (specs.length) lines.push(`<p><strong>${specs.join(' &middot; ')}</strong></p>`);

  lines.push(kind === 'pack' ? '<h3>Licence</h3>' : '<h3>Choose your licence</h3>');
  lines.push('<ul>');
  for (const tier of chosen) {
    const t = TIERS[tier];
    lines.push(`<li><strong>${t.name}</strong> — ${t.files}. ${escapeHtml(t.blurb)}</li>`);
  }
  lines.push('</ul>');
  lines.push('<p>Files and a signed licence agreement are emailed to you the moment payment clears.</p>');
  return lines.join('\n');
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* ------------------------------------------------------------------ delete */

router.delete('/products/:id', async (req, res) => {
  try {
    const product = db.prepare('SELECT * FROM products WHERE id = ? AND shop = ?').get(req.params.id, req.shop);
    if (!product) return res.status(404).json({ error: 'Not found.' });

    if (product.shopify_product_id) {
      const token = shopToken(req.shop);
      await gql(
        req.shop,
        token,
        `mutation Del($input: ProductDeleteInput!) { productDelete(input: $input) { deletedProductId userErrors { message } } }`,
        { input: { id: `gid://shopify/Product/${product.shopify_product_id}` } },
      ).catch((e) => console.warn('Shopify delete skipped:', e.message));
    }

    for (const a of db.prepare('SELECT file_path FROM assets WHERE product_id = ?').all(product.id)) {
      fs.rm(a.file_path, { force: true }, () => {});
    }
    for (const name of [product.artwork, product.preview].filter(Boolean)) {
      fs.rm(path.join(PUBLIC_DIR, name), { force: true }, () => {});
    }
    db.prepare('DELETE FROM assets WHERE product_id = ?').run(product.id);
    db.prepare('DELETE FROM products WHERE id = ?').run(product.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/* ------------------------------------------------------------------ licences */

router.get('/licenses', (req, res) => {
  const rows = db
    .prepare(
      `SELECT l.*, p.title FROM licenses l
       JOIN products p ON p.id = l.product_id
       WHERE l.shop = ? ORDER BY l.id DESC LIMIT 100`,
    )
    .all(req.shop);
  res.json(
    rows.map((l) => ({
      id: l.id,
      title: l.title,
      tier: tierName(l.tier),
      buyer_name: l.buyer_name,
      buyer_email: l.buyer_email,
      order_number: l.order_number,
      license_code: l.license_code,
      downloads: l.downloads,
      created_at: l.created_at,
      expires_at: l.expires_at,
      link: `${process.env.APP_URL}/d/${l.token}`,
    })),
  );
});

router.post('/licenses/:id/resend', async (req, res) => {
  const l = db
    .prepare(
      `SELECT l.*, p.title FROM licenses l JOIN products p ON p.id = l.product_id
       WHERE l.id = ? AND l.shop = ?`,
    )
    .get(req.params.id, req.shop);
  if (!l) return res.status(404).json({ error: 'Not found.' });

  const sent = await sendDelivery({
    to: l.buyer_email,
    buyerName: l.buyer_name,
    title: l.title,
    tierName: tierName(l.tier),
    link: `${process.env.APP_URL}/d/${l.token}`,
    expiresAt: l.expires_at.slice(0, 10),
  }).catch((e) => {
    console.error(e);
    return false;
  });

  res.json({ ok: true, emailed: sent, mailConfigured: mailEnabled() });
});

router.get('/settings', (req, res) => {
  res.json({
    shop: req.shop,
    mailConfigured: mailEnabled(),
    producer: process.env.PRODUCER_NAME || null,
    appUrl: process.env.APP_URL,
  });
});

export default router;
