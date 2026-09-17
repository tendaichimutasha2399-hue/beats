import crypto from 'node:crypto';

const API_VERSION = process.env.SHOPIFY_API_VERSION || '2025-01';

export function isValidShop(shop) {
  return typeof shop === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9-]*\.myshopify\.com$/.test(shop);
}

function safeEqual(a, b) {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/** Verify the hmac Shopify appends to admin/OAuth redirects. */
export function verifyQueryHmac(query) {
  const { hmac, signature, ...rest } = query;
  if (!hmac) return false;
  const message = Object.keys(rest)
    .sort()
    .map((key) => `${key}=${Array.isArray(rest[key]) ? rest[key].join(',') : rest[key]}`)
    .join('&');
  const digest = crypto
    .createHmac('sha256', process.env.SHOPIFY_API_SECRET)
    .update(message)
    .digest('hex');
  return safeEqual(digest, String(hmac));
}

/** Verify a webhook body against the X-Shopify-Hmac-Sha256 header. */
export function verifyWebhook(rawBody, headerHmac) {
  if (!headerHmac) return false;
  const digest = crypto
    .createHmac('sha256', process.env.SHOPIFY_API_SECRET)
    .update(rawBody)
    .digest('base64');
  return safeEqual(digest, String(headerHmac));
}

export function buildAuthUrl(shop, state) {
  const params = new URLSearchParams({
    client_id: process.env.SHOPIFY_API_KEY,
    scope: process.env.SCOPES,
    redirect_uri: `${process.env.APP_URL}/auth/callback`,
    state,
  });
  return `https://${shop}/admin/oauth/authorize?${params}`;
}

export async function exchangeCodeForToken(shop, code) {
  const res = await fetch(`https://${shop}/admin/oauth/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: process.env.SHOPIFY_API_KEY,
      client_secret: process.env.SHOPIFY_API_SECRET,
      code,
    }),
  });
  if (!res.ok) throw new Error(`Token exchange failed: ${res.status} ${await res.text()}`);
  const data = await res.json();
  return data.access_token;
}

/** Run a GraphQL Admin API operation. Throws on transport or userErrors. */
export async function gql(shop, token, query, variables = {}) {
  const res = await fetch(`https://${shop}/admin/api/${API_VERSION}/graphql.json`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': token,
    },
    body: JSON.stringify({ query, variables }),
  });
  const body = await res.json();
  if (!res.ok || body.errors) {
    throw new Error(`Shopify API error: ${JSON.stringify(body.errors || body)}`);
  }
  for (const value of Object.values(body.data || {})) {
    if (value && Array.isArray(value.userErrors) && value.userErrors.length) {
      throw new Error(value.userErrors.map((e) => `${(e.field || []).join('.')}: ${e.message}`).join('; '));
    }
  }
  return body.data;
}

const WEBHOOK_TOPICS = ['ORDERS_PAID', 'APP_UNINSTALLED'];

export async function registerWebhooks(shop, token) {
  const existing = await gql(
    shop,
    token,
    `query { webhookSubscriptions(first: 50) { nodes { id topic endpoint { ... on WebhookHttpEndpoint { callbackUrl } } } } }`,
  );
  const nodes = existing.webhookSubscriptions.nodes;

  for (const topic of WEBHOOK_TOPICS) {
    const callbackUrl = `${process.env.APP_URL}/webhooks/${topic.toLowerCase().replace('_', '/')}`;
    const already = nodes.some((n) => n.topic === topic && n.endpoint?.callbackUrl === callbackUrl);
    if (already) continue;
    await gql(
      shop,
      token,
      `mutation Register($topic: WebhookSubscriptionTopic!, $sub: WebhookSubscriptionInput!) {
        webhookSubscriptionCreate(topic: $topic, webhookSubscription: $sub) {
          webhookSubscription { id }
          userErrors { field message }
        }
      }`,
      { topic, sub: { callbackUrl, format: 'JSON' } },
    );
  }
}

/** Find the Online Store publication so new products actually show up in the shop. */
export async function getOnlineStorePublicationId(shop, token) {
  const data = await gql(shop, token, `query { publications(first: 20) { nodes { id name } } }`);
  const online = data.publications.nodes.find((p) => p.name === 'Online Store');
  return online?.id || data.publications.nodes[0]?.id || null;
}

export function numericId(gid) {
  return String(gid || '').split('/').pop();
}
