import nodemailer from 'nodemailer';

export function getEmailNotifyStatus(): { configured: boolean; missing: string[] } {
  const required = ['SMTP_HOST', 'SMTP_USER', 'SMTP_PASS'];
  const missing = required.filter((key) => !process.env[key]);
  return { configured: missing.length === 0, missing };
}

export async function sendEmailNotification(opts: {
  to: string;
  subject: string;
  text: string;
}): Promise<{ ok: boolean; skipped?: boolean; error?: string }> {
  const status = getEmailNotifyStatus();
  if (!status.configured) {
    return { ok: false, skipped: true, error: `SMTP未設定: ${status.missing.join(', ')}` };
  }

  try {
    const port = Number(process.env.SMTP_PORT ?? '587');
    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port,
      secure: process.env.SMTP_SECURE === 'true' || port === 465,
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    });

    await transporter.sendMail({
      from: process.env.SMTP_FROM ?? process.env.SMTP_USER,
      to: opts.to,
      subject: opts.subject,
      text: opts.text,
    });
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e.message ?? String(e) };
  }
}
