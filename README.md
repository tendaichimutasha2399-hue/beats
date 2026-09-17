# Beat store — a custom Shopify app

Upload beats and sample packs, set a price for each licence tier, and the app creates the
product in your Shopify store. When someone pays, the buyer automatically gets a download
link plus a licence agreement PDF with their name on it.

This is a **custom app** for your own store. It does not need Shopify App Store review.

---

## What it does

- One upload form for a beat (title, BPM, key, genre, artwork, tagged preview) or a sample pack.
- Five beat licences out of the box — MP3 Lease, WAV Lease, Trackout Lease, Unlimited Lease, Exclusive Rights — and a royalty-free licence for packs. Tick the ones you want, set a price, attach the file.
- Creates the Shopify product with one variant per licence, marked as a digital item (no shipping, no stock tracking), and publishes it to your Online Store.
- On a paid order: generates a PDF agreement naming the buyer, creates an expiring download link, emails it.
- Sells an Exclusive? The beat is archived in Shopify automatically so nobody else can buy it.
- Sales tab lists every licence issued, with a copy-link and resend button.

Your master files are never served from a public URL. They only move through a one-time token link.

---

## Step 1 — Host the app

The app is a Node server. It has to be reachable over HTTPS.

Free/cheap options that work: **Render**, **Railway**, **Fly.io**, or any VPS.

```bash
npm install
cp .env.example .env     # fill it in (Step 2 gives you the keys)
npm start
```

**Important — storage.** Beats and packs are large and stored on disk in `DATA_DIR`.
Render and Railway wipe the filesystem on every deploy unless you attach a **persistent
disk/volume** and point `DATA_DIR` at it. Do that before you upload anything real.
Set `DATA_DIR=/var/data` (or wherever your volume mounts).

## Step 2 — Create the app in Shopify

1. Go to [partners.shopify.com](https://partners.shopify.com), create a free Partner account.
2. **Apps → Create app → Create app manually.** Name it whatever you like.
3. Open **Configuration** and set:
   - App URL: `https://your-app-domain.com/admin`
   - Allowed redirection URL: `https://your-app-domain.com/auth/callback`
   - **Embed app in Shopify admin: OFF.** This app runs in its own tab, which keeps the login simple.
4. Copy the **Client ID** and **Client secret** into `.env` as `SHOPIFY_API_KEY` and `SHOPIFY_API_SECRET`.
5. Under **API access → Protected customer data**, request access and tick **Name** and **Email**. You need this to put the buyer's name on the licence and email them the files. For a custom app on your own store it is granted on submitting the short form.

## Step 3 — Install it on your store

In the Partner dashboard: **Distribution → Custom distribution**, enter your
`your-store.myshopify.com` domain, generate the install link, open it, click Install.

Or just visit `https://your-app-domain.com/` and type your store domain.

After installing you land on the upload screen. Webhooks register themselves.

## Step 4 — Turn on delivery email

Fill in the `SMTP_*` values in `.env`. Any SMTP provider works — Resend, Postmark, Brevo,
SendGrid, or your own mailbox. Without it everything still works; you just copy the
download link from the Sales tab and send it yourself.

## Step 5 — Checkout settings in Shopify

In **Settings → Checkout**, make sure email is required at checkout and consider turning
off shipping address collection, since nothing here ships.

---

## Editing your licence terms

Open `src/licenses.js`. Every tier, every limit and every clause lives in that one file in
plain text. Change the stream caps, add a tier, rewrite a clause — the PDF picks it up on
the next sale. Prices are set per product in the upload form, not here.

**These templates are a starting point, not legal advice.** Have a lawyer in your
jurisdiction read them before you sell under them, especially the Exclusive Rights
publishing split.

## Playing the preview on your product page

Each product gets a `beatstore.preview_url` metafield. To add a player to your theme, edit
`sections/main-product.liquid` and drop this in:

```liquid
{% if product.metafields.beatstore.preview_url %}
  <audio controls preload="none" src="{{ product.metafields.beatstore.preview_url }}"></audio>
{% endif %}
```

You may need to expose the metafield first under **Settings → Custom data → Products**.

---

## Routes

| Route | Who uses it |
|---|---|
| `/` | Store connect form |
| `/auth`, `/auth/callback` | Shopify OAuth |
| `/admin` | Your upload and sales dashboard |
| `/api/*` | The dashboard's own calls |
| `/webhooks/orders/paid` | Shopify, on payment |
| `/d/:token` | The buyer's download page |
| `/healthz` | Uptime checks |

## Things to know

- Refunds do not revoke a licence automatically. Cancel manually if you need to.
- The download link allows 5 downloads over 30 days by default (`DOWNLOAD_LIMIT`, `DOWNLOAD_DAYS`).
- Uploads are capped at 1 GB per file (`MAX_UPLOAD_MB`). Free hosting tiers often have their own request limits — bump the plan if big packs fail.
- If you ever want to list this publicly on the App Store, you'll need billing API support, GDPR webhook handling beyond the stubs in `src/routes/webhooks.js`, and Shopify's review.
