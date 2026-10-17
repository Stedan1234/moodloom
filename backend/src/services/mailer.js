// Sends transactional email. If SMTP_HOST isn't configured (local dev), the
// message is printed to the backend console instead, so the reset flow is
// fully usable on a laptop with no mail server: copy the link from the log.
export async function sendMail({ to, subject, text }) {
  if (!process.env.SMTP_HOST) {
    console.log(`\n[mailer] SMTP not configured — would send email:\n  To: ${to}\n  Subject: ${subject}\n\n${text}\n`);
    return { delivered: false };
  }
  const { default: nodemailer } = await import('nodemailer');
  const transport = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === 'true',
    auth: process.env.SMTP_USER
      ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
      : undefined,
  });
  await transport.sendMail({
    from: process.env.MAIL_FROM || 'Moodloom <no-reply@localhost>',
    to,
    subject,
    text,
  });
  return { delivered: true };
}
