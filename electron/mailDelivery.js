'use strict';

const fs = require('node:fs');
const path = require('node:path');
const nodemailer = require('nodemailer');
const MailComposer = require('nodemailer/lib/mail-composer');

/**
 * Getting a message, with the renders attached, from this app to the client.
 *
 * A `mailto:` link - which is how drafts have always opened - has no way to
 * carry an attachment; the standard simply does not have one. So a message
 * with renders goes one of two other ways:
 *
 *  - through Gmail, when GD has connected it and allowed data to leave the
 *    machine. The app sends it itself, attachments and all, whatever mail
 *    program he uses.
 *  - otherwise as a draft file: a complete message with the pictures inside
 *    it, opened in his own mail program for him to read and send.
 *
 * A message with nothing to attach still opens the plain draft it always did,
 * so nothing changes for the emails that never needed this.
 */

const VIEW_ORDER = ['front', 'side', 'back', 'three_quarter'];
const VIEW_LABEL = { front: 'Front', side: 'Side', back: 'Back', three_quarter: 'Three-quarter' };

/**
 * The most attachments may add up to before they are encoded.
 *
 * Gmail refuses a message over 25MB, and that limit is on the message as
 * sent - base64 makes every attachment a third larger on the way. 18MB of
 * pictures comes to about 24MB encoded, which leaves room for the text.
 */
const MAX_ATTACH_BYTES = 18 * 1024 * 1024;

/**
 * The newest set of views for each suit on the order.
 *
 * "Render all four views" makes one set; a refinement of one view joins the
 * set it refines. So the newest set is the batch of the newest render, and
 * within it the newest picture of each view is the one to send. Renders
 * arrive newest first, so the first of anything found is the newest.
 */
function latestRenderSets(project) {
  const renders = project.renders ?? [];
  const suits = project.suits ?? [];
  const primary = suits[0]?.id ?? null;
  const owners = suits.length ? suits : [{ id: null, name: project.name, surname: project.surname }];

  const sets = [];
  for (const suit of owners) {
    const mine = renders.filter((r) =>
      suit.id === null ? true : r.suit_id === suit.id || (r.suit_id == null && suit.id === primary)
    );
    if (!mine.length) continue;
    const batch = mine[0].batch_id;
    const inBatch = mine.filter((r) => r.batch_id === batch);
    const pictures = VIEW_ORDER
      .map((view) => inBatch.find((r) => r.view === view))
      .filter(Boolean);
    if (pictures.length) sets.push({ suit, pictures });
  }
  return sets;
}

/** A filename that is safe on every system a client might open it on. */
const safe = (text) => String(text ?? '').replace(/[^\w .()-]+/g, ' ').replace(/\s+/g, ' ').trim();

/**
 * The renders, as the client will receive them: badged and watermarked, as
 * JPEGs, named for what they are.
 *
 * The badge goes on here as it does for every render that leaves the app.
 * JPEG, because a render is a photograph and a PNG of one is five times the
 * size for nothing a client could see.
 *
 * `readImage` and `stamp` are handed in rather than required, so the tests
 * can see exactly what went in and what came out.
 */
function buildAttachments(project, { readImage, stamp, scope }) {
  const sets = latestRenderSets(project);
  const people = new Map();
  for (const { suit } of sets) people.set(suit.client_id ?? 'solo', (people.get(suit.client_id ?? 'solo') ?? 0) + 1);

  const attachments = [];
  let total = 0;
  let omitted = 0;
  for (const { suit, pictures } of sets) {
    const person = safe(`${suit.name ?? project.name ?? ''} ${suit.surname ?? project.surname ?? ''}`);
    // A man with two suits needs the suit named, or his two fronts collide.
    const which = (people.get(suit.client_id ?? 'solo') ?? 0) > 1 ? safe(suit.label || suit.fabric_name || `suit ${suit.id}`) : '';
    for (const render of pictures) {
      const bytes = stamp(readImage(scope, render.filename), 'jpeg');
      if (total + bytes.length > MAX_ATTACH_BYTES) { omitted++; continue; }
      total += bytes.length;
      const name = [safe(project.order_ref || 'GD Suits'), person, which, VIEW_LABEL[render.view] ?? safe(render.view)]
        .filter(Boolean).join(' - ');
      attachments.push({ filename: `${name}.jpg`, content: bytes, contentType: 'image/jpeg' });
    }
  }
  return { attachments, total, omitted };
}

/** What `{renders}` becomes in the wording, from the same sets that are attached. */
function rendersLine(project) {
  const sets = latestRenderSets(project);
  if (!sets.length) return '';
  const views = [...new Set(sets.flatMap((s) => s.pictures.map((p) => VIEW_LABEL[p.view] ?? p.view)))]
    .map((v) => v.toLowerCase());
  const list = views.length > 1 ? `${views.slice(0, -1).join(', ')} and ${views[views.length - 1]}` : views[0];
  return sets.length > 1
    ? `I have attached pictures of each suit on the order - the ${list} views.`
    : `I have attached pictures of your suit - the ${list} views.`;
}

/**
 * Sends it, or opens it for sending, and says which.
 *
 * `gmail` is only ever the answer from integrations.statusOf, which is where
 * the consent gate lives: this function does not decide whether data may
 * leave the machine, it is told. `allowGmail` lets a caller keep a message a
 * draft regardless - the standing emails do, because they were built on the
 * rule that a timer decides and a person sends.
 */
async function deliver({
  to, from, subject, body, attachments = [],
  gmail, allowGmail = true, gmailAddress, gmailPassword,
  draftDir, draftName, openPath, openMail, transport,
}) {
  if (allowGmail && gmail?.ready) {
    const sender = transport ?? nodemailer.createTransport({
      host: 'smtp.gmail.com',
      port: 465,
      secure: true,
      auth: { user: gmailAddress, pass: gmailPassword },
    });
    const info = await sender.sendMail({ from: gmailAddress, to, subject, text: body, attachments });
    return { via: 'gmail', to, messageId: info.messageId ?? null, attached: attachments.length };
  }

  if (attachments.length) {
    // X-Unsent tells a mail program this is a message to finish and send,
    // not one that arrived. Outlook honours it and opens a draft; Apple Mail
    // opens it for reading, and Message > Send Again makes it a draft with
    // the pictures still attached.
    const message = await new MailComposer({
      from: from || undefined, to, subject, text: body, attachments,
      headers: { 'X-Unsent': '1' },
    }).compile().build();
    fs.mkdirSync(draftDir, { recursive: true });
    const file = path.join(draftDir, `${safe(draftName) || 'Draft'}.eml`);
    fs.writeFileSync(file, message, { mode: 0o600 });
    const problem = await openPath(file);
    if (problem) throw new Error(`The draft was written but could not be opened: ${problem}`);
    return { via: 'draft-file', to, path: file, attached: attachments.length };
  }

  if (!openMail({ to, subject, body })) {
    throw new Error('Could not open a mail draft - check the client has a valid email address.');
  }
  return { via: 'mailto', to, attached: 0 };
}

module.exports = {
  VIEW_ORDER, VIEW_LABEL, MAX_ATTACH_BYTES,
  latestRenderSets, buildAttachments, rendersLine, deliver,
};
