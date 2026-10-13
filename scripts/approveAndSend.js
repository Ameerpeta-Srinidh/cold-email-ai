import "dotenv/config";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import {
  closeDb,
  getDb,
  updateLeadStatus,
  withTransaction
} from "../db.js";
import {
  getDailyLimit,
  sendEmail,
  waitRandomDelay
} from "../utils/emailSender.js";

function getStartOfLocalDayIso() {
  const value = new Date();
  value.setHours(0, 0, 0, 0);
  return value.toISOString();
}

function printPreview(email, index, total) {
  console.log(`\n========== Email ${index + 1} of ${total} ==========`);
  console.log(`Name: ${email.name}`);
  console.log(`Email: ${email.email}`);
  console.log(`Company: ${email.company}`);
  console.log(`Role: ${email.role || "Not provided"}`);
  console.log(`Subject: ${email.subject}`);
  console.log("Body:");
  console.log(email.body);
}

async function fetchPendingEmails(db) {
  return db.all(`
    SELECT
      e.id AS email_id,
      e.subject,
      e.body,
      e.created_at,
      l.id AS lead_id,
      l.name,
      l.email,
      l.company,
      l.role
    FROM emails e
    INNER JOIN leads l ON l.id = e.lead_id
    WHERE e.status = 'pending'
      AND e.kind = 'initial'
    ORDER BY e.created_at ASC, e.id ASC
  `);
}

async function main() {
  const db = await getDb();
  const pendingEmails = await fetchPendingEmails(db);

  if (pendingEmails.length === 0) {
    console.log("No pending emails are ready for approval.");
    return;
  }

  const dailyLimit = getDailyLimit();
  const sentToday = await db.get(
    `
      SELECT COUNT(*) AS count
      FROM emails
      WHERE status = 'sent'
        AND sent_at IS NOT NULL
        AND sent_at >= ?
    `,
    getStartOfLocalDayIso()
  );
  const remainingCapacity = Math.max(0, dailyLimit - sentToday.count);
  const sendBatch = pendingEmails.slice(0, remainingCapacity);

  console.log(`Pending emails: ${pendingEmails.length}`);
  console.log(`Daily limit: ${dailyLimit}`);
  console.log(`Already sent today: ${sentToday.count}`);
  console.log(`Available to send now: ${sendBatch.length}`);

  if (pendingEmails.length > remainingCapacity) {
    console.log(
      `${pendingEmails.length - remainingCapacity} email(s) will stay pending because of the daily limit.`
    );
  }

  pendingEmails.forEach((email, index) => {
    printPreview(email, index, pendingEmails.length);
  });

  const rl = readline.createInterface({ input, output });
  const answer = (
    await rl.question("\nApprove sending all emails? (yes/no) ")
  )
    .trim()
    .toLowerCase();
  rl.close();

  if (answer !== "yes") {
    console.log("Approval declined. No emails were sent.");
    return;
  }

  if (sendBatch.length === 0) {
    console.log("Daily limit reached. No emails were sent in this run.");
    return;
  }

  let sent = 0;
  let failed = 0;

  for (const [index, email] of sendBatch.entries()) {
    try {
      const approvalTimestamp = new Date().toISOString();

      await db.run(
        `
          UPDATE emails
          SET status = 'sending', approved_at = ?, updated_at = ?
          WHERE id = ?
        `,
        approvalTimestamp,
        approvalTimestamp,
        email.email_id
      );

      const response = await sendEmail({
        to: email.email,
        subject: email.subject,
        body: email.body
      });

      await withTransaction(async () => {
        const sentTimestamp = new Date().toISOString();

        await db.run(
          `
            UPDATE emails
            SET status = 'sent',
                resend_id = ?,
                error_message = NULL,
                sent_at = ?,
                updated_at = ?
            WHERE id = ?
          `,
          response?.id || null,
          sentTimestamp,
          sentTimestamp,
          email.email_id
        );

        await updateLeadStatus(email.lead_id, "email_sent");
      });

      sent += 1;
      console.log(
        `[${index + 1}/${sendBatch.length}] Sent to ${email.name} <${email.email}>`
      );
    } catch (error) {
      failed += 1;

      await db.run(
        `
          UPDATE emails
          SET status = 'failed',
              error_message = ?,
              updated_at = ?
          WHERE id = ?
        `,
        error.message,
        new Date().toISOString(),
        email.email_id
      );

      console.error(
        `[${index + 1}/${sendBatch.length}] Failed to send to ${email.email}: ${error.message}`
      );
    }

    if (index < sendBatch.length - 1) {
      const delayMs = await waitRandomDelay();
      console.log(`Waiting ${(delayMs / 1000).toFixed(1)}s before next send...`);
    }
  }

  console.log(`Run complete. Sent: ${sent}. Failed: ${failed}.`);
}

main()
  .catch((error) => {
    console.error("Approval/send workflow failed.");
    console.error(error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeDb();
  });
