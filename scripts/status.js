import "dotenv/config";
import { closeDb, getDb } from "../db.js";

async function main() {
  const db = await getDb();

  const [
    totalLeads,
    newLeads,
    discoveredLeads,
    avgMatchScore,
    generatedEmails,
    sentEmails,
    pendingEmails,
    failedEmails,
    replyEvents,
    followUps,
    totalApplications,
    submittedApplications,
    failedApplications,
    topCompanies,
  ] = await Promise.all([
    db.get("SELECT COUNT(*) AS count FROM leads"),
    db.get("SELECT COUNT(*) AS count FROM leads WHERE status = 'new'"),
    db.get("SELECT COUNT(*) AS count FROM leads WHERE source = 'discovered'"),
    db.get("SELECT ROUND(AVG(match_score), 1) AS avg FROM leads WHERE match_score IS NOT NULL"),
    db.get("SELECT COUNT(*) AS count FROM emails"),
    db.get("SELECT COUNT(*) AS count FROM emails WHERE status = 'sent'"),
    db.get("SELECT COUNT(*) AS count FROM emails WHERE status = 'pending'"),
    db.get("SELECT COUNT(*) AS count FROM emails WHERE status = 'failed'"),
    db.get("SELECT COUNT(*) AS count FROM reply_events"),
    db.get("SELECT COUNT(*) AS count FROM follow_ups"),
    db.get("SELECT COUNT(*) AS count FROM applications"),
    db.get("SELECT COUNT(*) AS count FROM applications WHERE status = 'submitted'"),
    db.get("SELECT COUNT(*) AS count FROM applications WHERE status = 'failed'"),
    db.all(`
      SELECT company, match_score, role, email_confidence
      FROM leads
      WHERE match_score IS NOT NULL
      ORDER BY match_score DESC
      LIMIT 5
    `),
  ]);

  console.log("╔═══════════════════════════════════════════════════════╗");
  console.log("║         📊 COLD EMAIL AI — STATUS DASHBOARD          ║");
  console.log("╚═══════════════════════════════════════════════════════╝");
  console.log();

  console.log("── Leads ──────────────────────────────────────────────");
  console.log(`  Total leads:          ${totalLeads.count}`);
  console.log(`  New / uncontacted:    ${newLeads.count}`);
  console.log(`  Auto-discovered:      ${discoveredLeads.count}`);
  console.log(`  Avg match score:      ${avgMatchScore.avg || "N/A"}/100`);
  console.log();

  console.log("── Emails ─────────────────────────────────────────────");
  console.log(`  Drafts generated:     ${generatedEmails.count}`);
  console.log(`  Pending review:       ${pendingEmails.count}`);
  console.log(`  Sent:                 ${sentEmails.count}`);
  console.log(`  Failed:               ${failedEmails.count}`);
  console.log();

  console.log("── Portal Applications ────────────────────────────────");
  console.log(`  Total attempts:       ${totalApplications.count}`);
  console.log(`  Submitted:            ${submittedApplications.count}`);
  console.log(`  Failed:               ${failedApplications.count}`);
  console.log();

  console.log("── Follow-up ──────────────────────────────────────────");
  console.log(`  Reply events:         ${replyEvents.count}`);
  console.log(`  Follow-ups queued:    ${followUps.count}`);

  if (topCompanies.length > 0) {
    console.log();
    console.log("── Top Matched Companies ──────────────────────────────");
    for (const c of topCompanies) {
      const bar = "█".repeat(Math.round((c.match_score || 0) / 5));
      console.log(`  ${(c.company || "?").padEnd(20)} ${String(c.match_score || 0).padStart(3)}/100 ${bar}`);
    }
  }

  console.log();
}

main()
  .catch((error) => {
    console.error("Status check failed.");
    console.error(error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeDb();
  });
