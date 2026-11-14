// Sends transactional email. With no SMTP_HOST configured (local dev) the
// message is printed to the backend console instead, so the reset flow is
// usable on a laptop with no mail server: copy the link from the log.
import { config } from '../config.js';

export const outbox = []; // last few messages, for the automated tests

export async function sendMail({ to, subject, text }) {
  if (config.isTest) {
    outbox.push({ to, subject, text });
    if (outbox.length > 20) outbox.shift();
    return { delivered: false };
  }
  if (!config.smtp.host) {
    console.log(`\n[mailer] SMTP not configured. Would send:\n  To: ${to}\n  Subject: ${subject}\n\n${text}\n`);
    return { delivered: false };
  }
  const { default: nodemailer } = await import('nodemailer');
  const transport = nodemailer.createTransport({
    host: config.smtp.host,
    port: config.smtp.port,
    secure: config.smtp.secure,
    auth: config.smtp.user ? { user: config.smtp.user, pass: config.smtp.pass } : undefined,
  });
  await transport.sendMail({ from: config.smtp.from, to, subject, text });
  return { delivered: true };
}
