import nodemailer from 'nodemailer';
import { config } from '../config.js';

const transport = nodemailer.createTransport({
  host: config.smtp.host,
  port: config.smtp.port,
  secure: config.smtp.port === 465,
  auth: config.smtp.user ? { user: config.smtp.user, pass: config.smtp.pass } : undefined,
});

export async function sendOtpEmail(to, code) {
  await transport.sendMail({
    from: config.smtp.from,
    to,
    subject: 'Your attendance login code',
    text: `Your attendance login code is ${code}. It expires in 5 minutes. If you did not request it, ignore this email.`,
    html: `<p>Your attendance login code is <b style="font-size:20px">${code}</b>.</p><p>It expires in 5 minutes.</p>`,
  });
}

export async function sendOtpEmailSafe(to, code) {
  try {
    await sendOtpEmail(to, code);
  } catch (err) {
    console.error(`Failed to send OTP email to ${to}: ${err.message}`);
  }
}
