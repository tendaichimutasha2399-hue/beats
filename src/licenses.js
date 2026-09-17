import fs from 'node:fs';
import path from 'node:path';
import PDFDocument from 'pdfkit';

/**
 * EDIT THIS FILE to change your licence terms and prices.
 * Every number below is yours to set. `rights` rows print as a table on the
 * agreement; `clauses` print as numbered paragraphs.
 */

const CREDIT = (producer) => `Buyer must credit the Producer as "Prod. by ${producer}" in the title or description of any release, video or distribution of the New Song.`;

const COMMON_CLAUSES = (producer, legal) => [
  `Grant of licence. The Producer (${legal}, performing as ${producer}) grants the Buyer a licence to use the Instrumental named above to create one new derivative musical work (the "New Song"), subject to the limits set out in this agreement.`,
  `Ownership. Unless this agreement grants Exclusive Rights, the Producer retains full ownership of the Instrumental, including the master recording and the underlying composition. The Buyer owns their own vocal performance and lyrics.`,
  `Delivery. Files are delivered as an immediate digital download. Because the goods are digital and delivered instantly, all sales are final and non-refundable once the files have been downloaded.`,
  `Resale. The Buyer may not sell, licence, lease, give away or otherwise redistribute the Instrumental on its own, or as part of a sample pack, loop kit or beat store. The Instrumental may only be distributed inside the New Song.`,
  `Term. A non-exclusive licence runs for ten (10) years from the purchase date and may be renewed at the Producer's then-current rate. Exclusive Rights run in perpetuity.`,
  `Breach. Exceeding any limit in this agreement ends the licence automatically. The Buyer may upgrade to a higher tier at any time to stay covered.`,
  `Indemnity. The Buyer is responsible for clearing any sample, interpolation or third-party recording they add to the New Song, and agrees to hold the Producer harmless for claims arising from the Buyer's own additions.`,
  `Entire agreement. This document is the whole agreement between the parties for this purchase and replaces any prior discussion.`,
];

export const TIERS = {
  mp3_lease: {
    name: 'MP3 Lease',
    kind: 'beat',
    files: 'Tagless MP3 (320kbps)',
    blurb: 'Non-exclusive. For demos, mixtapes and early releases.',
    exclusive: false,
    rights: [
      ['Distribution', 'Up to 2,500 copies'],
      ['Audio streams', 'Up to 50,000'],
      ['Music videos', '1'],
      ['Live performances', 'Unlimited, non-profit'],
      ['Radio broadcast', 'Not permitted'],
      ['Beat remains for sale', 'Yes'],
    ],
  },
  wav_lease: {
    name: 'WAV Lease',
    kind: 'beat',
    files: 'WAV (24-bit) + tagless MP3',
    blurb: 'Non-exclusive. Mastering-grade audio and higher caps.',
    exclusive: false,
    rights: [
      ['Distribution', 'Up to 10,000 copies'],
      ['Audio streams', 'Up to 200,000'],
      ['Music videos', '1'],
      ['Live performances', 'Unlimited, non-profit'],
      ['Radio broadcast', '2 stations'],
      ['Beat remains for sale', 'Yes'],
    ],
  },
  trackout_lease: {
    name: 'Trackout Lease',
    kind: 'beat',
    files: 'Separated stems (ZIP) + WAV + MP3',
    blurb: 'Non-exclusive. Full stems so your engineer can remix the mix.',
    exclusive: false,
    rights: [
      ['Distribution', 'Up to 20,000 copies'],
      ['Audio streams', 'Up to 500,000'],
      ['Music videos', 'Unlimited'],
      ['Live performances', 'Unlimited, profit permitted'],
      ['Radio broadcast', '5 stations'],
      ['Beat remains for sale', 'Yes'],
    ],
  },
  unlimited_lease: {
    name: 'Unlimited Lease',
    kind: 'beat',
    files: 'Separated stems (ZIP) + WAV + MP3',
    blurb: 'Non-exclusive, but no caps on sales or streams.',
    exclusive: false,
    rights: [
      ['Distribution', 'Unlimited'],
      ['Audio streams', 'Unlimited'],
      ['Music videos', 'Unlimited'],
      ['Live performances', 'Unlimited, profit permitted'],
      ['Radio broadcast', 'Unlimited'],
      ['Beat remains for sale', 'Yes'],
    ],
  },
  exclusive: {
    name: 'Exclusive Rights',
    kind: 'beat',
    files: 'Separated stems (ZIP) + WAV + MP3',
    blurb: 'The beat is removed from the store on purchase. No one else can licence it.',
    exclusive: true,
    rights: [
      ['Distribution', 'Unlimited'],
      ['Audio streams', 'Unlimited'],
      ['Music videos', 'Unlimited'],
      ['Live performances', 'Unlimited, profit permitted'],
      ['Radio broadcast', 'Unlimited'],
      ['Beat remains for sale', 'No — removed from store'],
      ['Producer publishing share', '50% of the composition'],
    ],
    extraClauses: [
      'Exclusivity. On payment the Producer stops licensing the Instrumental to anyone else and removes it from sale. Licences already issued to other buyers before this date remain valid and are not revoked.',
      'Publishing. The Producer retains a 50% share of the composition (publishing) of the New Song and is to be registered as a co-writer with the Buyer\'s PRO and distributor. Master royalties from the New Song belong to the Buyer.',
    ],
  },
  pack_standard: {
    name: 'Sample Pack Licence',
    kind: 'pack',
    files: 'ZIP archive of samples, loops and one-shots',
    blurb: 'Royalty-free use of the sounds in your own productions.',
    exclusive: false,
    rights: [
      ['Use in your productions', 'Unlimited, royalty-free'],
      ['Commercial release', 'Permitted'],
      ['Credit required', 'No'],
      ['Reselling the sounds', 'Not permitted'],
      ['Use in another sample pack', 'Not permitted'],
      ['Sharing the files', 'Not permitted'],
    ],
    clausesOverride: (producer, legal) => [
      `Grant of licence. ${legal}, performing as ${producer}, grants the Buyer a non-exclusive, worldwide, royalty-free licence to use the sounds in this pack in the Buyer's own musical productions, in perpetuity.`,
      'Permitted use. The Buyer may use, edit, layer, pitch, stretch and process the sounds inside a finished musical work and release that work commercially with no royalty owed to the Producer.',
      'Prohibited use. The Buyer may not redistribute the sounds in any form where the sounds themselves are the product — including sample packs, loop kits, preset banks, drum kits, NFTs, or AI training datasets — whether the sounds are edited or not.',
      'Sharing. The licence covers one person or one company. The files may not be shared, uploaded to file-sharing services, or included in a group buy.',
      'Delivery. Files are delivered as an immediate digital download. All sales are final and non-refundable once the files have been downloaded.',
      'Ownership. The Producer retains ownership of the sounds. Nothing in this licence transfers copyright in the sounds themselves.',
      'Clearance. All sounds in this pack are original or fully cleared by the Producer.',
      'Breach. Redistribution of the sounds ends this licence immediately.',
    ],
  },
};

export const BEAT_TIERS = Object.entries(TIERS).filter(([, t]) => t.kind === 'beat');
export const PACK_TIERS = Object.entries(TIERS).filter(([, t]) => t.kind === 'pack');

export function tierName(key) {
  return TIERS[key]?.name || key;
}

/** Build the PDF agreement. Returns the absolute path written. */
export function buildLicensePdf({ outPath, license, product, producer }) {
  const tier = TIERS[license.tier];
  fs.mkdirSync(path.dirname(outPath), { recursive: true });

  const doc = new PDFDocument({ size: 'A4', margin: 56 });
  const stream = fs.createWriteStream(outPath);
  doc.pipe(stream);

  const ink = '#141210';
  const muted = '#6b625a';
  const rule = () => {
    doc.moveTo(56, doc.y).lineTo(539, doc.y).lineWidth(0.75).strokeColor('#d8d0c8').stroke();
    doc.moveDown(0.8);
  };

  doc.fillColor(ink).font('Helvetica-Bold').fontSize(20).text(tier.exclusive ? 'Exclusive Rights Agreement' : 'Licence Agreement');
  doc.moveDown(0.2);
  doc.font('Helvetica').fontSize(10).fillColor(muted)
    .text(`${tier.name} · Licence ${license.license_code} · Issued ${new Date(license.created_at).toISOString().slice(0, 10)}`);
  doc.moveDown(1);
  rule();

  const row = (label, value) => {
    const y = doc.y;
    doc.font('Helvetica').fontSize(9.5).fillColor(muted).text(label, 56, y, { width: 150 });
    doc.font('Helvetica-Bold').fontSize(10).fillColor(ink).text(value || '—', 210, y, { width: 329 });
    doc.moveDown(0.45);
  };

  row('Producer (Licensor)', `${producer.legalName} p/k/a ${producer.name}`);
  row('Producer contact', producer.email);
  row('Buyer (Licensee)', license.buyer_name || license.buyer_email || 'Buyer');
  row('Buyer email', license.buyer_email);
  row(tier.kind === 'pack' ? 'Sample pack' : 'Instrumental', product.title);
  if (product.bpm) row('Tempo / key', [product.bpm ? `${product.bpm} BPM` : null, product.music_key].filter(Boolean).join(' · '));
  row('Files delivered', tier.files);
  row('Order', license.order_number ? `#${license.order_number}` : license.order_id);

  doc.moveDown(0.6);
  rule();

  doc.font('Helvetica-Bold').fontSize(12).fillColor(ink).text('What this licence allows');
  doc.moveDown(0.5);
  for (const [label, value] of tier.rights) {
    const y = doc.y;
    doc.font('Helvetica').fontSize(10).fillColor(muted).text(label, 56, y, { width: 220 });
    doc.font('Helvetica').fontSize(10).fillColor(ink).text(value, 286, y, { width: 253 });
    doc.moveDown(0.35);
  }

  doc.moveDown(0.6);
  rule();

  doc.font('Helvetica-Bold').fontSize(12).fillColor(ink).text('Terms');
  doc.moveDown(0.5);

  const clauses = tier.clausesOverride
    ? tier.clausesOverride(producer.name, producer.legalName)
    : [...COMMON_CLAUSES(producer.name, producer.legalName), ...(tier.extraClauses || [])];

  if (tier.kind === 'beat') clauses.push(CREDIT(producer.name));
  clauses.push(`Governing law. This agreement is governed by the laws of ${producer.country}.`);

  clauses.forEach((text, i) => {
    doc.font('Helvetica').fontSize(9.5).fillColor(ink)
      .text(`${i + 1}.  ${text}`, { align: 'left', lineGap: 2 });
    doc.moveDown(0.45);
  });

  doc.moveDown(1);
  rule();
  doc.font('Helvetica').fontSize(8.5).fillColor(muted).text(
    `This agreement takes effect on the date of purchase and is accepted by the Buyer on completing the order. Licence reference ${license.license_code}. Keep this document — it is your proof of rights for distributors, PROs and content-ID claims.`,
    { lineGap: 1.5 },
  );

  doc.end();
  return new Promise((resolve, reject) => {
    stream.on('finish', () => resolve(outPath));
    stream.on('error', reject);
  });
}
