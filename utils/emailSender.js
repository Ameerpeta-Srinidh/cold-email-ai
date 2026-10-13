import "dotenv/config";
import { setTimeout as sleep } from "node:timers/promises";
import nodemailer from "nodemailer";

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export function getDailyLimit() {
  const rawLimit = process.env.DAILY_LIMIT;
  const parsed = Number.parseInt(rawLimit || "30", 10);

  if (!Number.isInteger(parsed) || parsed <= 0) {
    return 30;
  }

  return Math.min(parsed, 30);
}

export function getRandomDelayMs(min = 2000, max = 5000) {
  const lower = Math.min(min, max);
  const upper = Math.max(min, max);
  return Math.floor(Math.random() * (upper - lower + 1)) + lower;
}

export async function waitRandomDelay(min = 2000, max = 5000) {
  const delayMs = getRandomDelayMs(min, max);
  await sleep(delayMs);
  return delayMs;
}

export async function sendEmail({ to, subject, body }) {
  const user = requireEnv("SMTP_USER");
  const pass = requireEnv("SMTP_PASS");
  
  const host = process.env.SMTP_HOST || "smtp.gmail.com";
  const port = process.env.SMTP_PORT || "465";
  const fromName = process.env.FROM_NAME?.trim() || "Internship Applicant";

  const transporter = nodemailer.createTransport({
    host,
    port: parseInt(port, 10),
    secure: parseInt(port, 10) === 465, 
    auth: {
      user,
      pass,
    },
  });

  const mailOptions = {
    from: `"${fromName}" <${user}>`,
    to,
    subject,
    text: body,
  };

  try {
    const info = await transporter.sendMail(mailOptions);
    return { id: info.messageId, status: "sent" };
  } catch (error) {
    throw new Error(`Nodemailer request failed: ${error.message}`);
  }
}
