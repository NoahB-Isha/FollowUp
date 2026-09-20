import nodemailer from 'nodemailer';

export function smtpConfigured() {
  return !!(process.env.SMTP_HOST && process.env.SMTP_FROM);
}

export function transport() {
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: Number(process.env.SMTP_PORT) === 465,
    auth: process.env.SMTP_USER
      ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
      : undefined,
  });
}

export async function sendMail({ to, subject, html, text }) {
  return transport().sendMail({ from: process.env.SMTP_FROM, to, subject, html, text });
}
