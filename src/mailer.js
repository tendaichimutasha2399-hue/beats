import nodemailer from 'nodemailer';

let transport = null;
if (process.env.SMTP_HOST && process.env.SMTP_USER) {
  transport = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: Number(process.env.SMTP_PORT) === 465,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });
}

export const mailEnabled = () => Boolean(transport);

export async function sendDelivery({ to, buyerName, title, tierName, link, expiresAt }) {
  if (!transport) {
    console.log(`[delivery] SMTP not configured. Link for ${to}: ${link}`);
    return false;
  }

  const producer = process.env.PRODUCER_NAME || 'the producer';
  const html = `
    <div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,sans-serif;max-width:520px;color:#141210">
      <p>Hi ${escapeHtml(buyerName || 'there')},</p>
      <p>Your files for <strong>${escapeHtml(title)}</strong> (${escapeHtml(tierName)}) are ready.</p>
      <p style="margin:28px 0">
        <a href="${link}" style="background:#141210;color:#fff;padding:12px 20px;border-radius:6px;text-decoration:none;display:inline-block">Download your files</a>
      </p>
      <p style="color:#6b625a;font-size:13px">
        The link works until ${escapeHtml(expiresAt)} and includes your signed licence agreement as a PDF.
        Save both somewhere safe — distributors and PROs may ask for the licence.
      </p>
      <p style="color:#6b625a;font-size:13px">Any trouble, just reply to this email.<br>${escapeHtml(producer)}</p>
    </div>`;

  await transport.sendMail({
    from: process.env.MAIL_FROM || process.env.PRODUCER_EMAIL,
    to,
    subject: `Your download — ${title} (${tierName})`,
    html,
  });
  return true;
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
