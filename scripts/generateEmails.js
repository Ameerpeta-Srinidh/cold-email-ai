import "dotenv/config";
import { closeDb, getDb, updateLeadStatus, withTransaction } from "../db.js";
import { generateOutreachEmail, scoreCompanyMatch } from "../utils/ai.js";

async function fetchLeadsWithoutInitialEmail(db) {
  return db.all(`
    SELECT l.id, l.name, l.email, l.company, l.role,
           l.match_score, l.match_reasoning, l.email_confidence
    FROM leads l
    LEFT JOIN emails e
      ON e.lead_id = l.id AND e.kind = 'initial'
    WHERE e.id IS NULL
      AND l.status IN ('new', 'contacted')
    ORDER BY l.match_score DESC NULLS LAST
  `);
}

async function main() {
  const db = await getDb();
  const leads = await fetchLeadsWithoutInitialEmail(db);

  if (leads.length === 0) {
    console.log("No leads awaiting email generation.");
    return;
  }

  console.log(`Found ${leads.length} lead(s) without email drafts.\n`);

  let generated = 0;
  let failed = 0;

  for (const lead of leads) {
    try {
      console.log(`Generating email for ${lead.name} at ${lead.company}...`);

      // Build match info from stored data or compute it
      let matchInfo = {};
      if (lead.match_score != null) {
        matchInfo.score = lead.match_score;
        matchInfo.reasoning = lead.match_reasoning || "";
      } else {
        // Score on-the-fly if no score exists
        try {
          matchInfo = await scoreCompanyMatch({
            company: lead.company,
            role: lead.role,
          });
          // Update the lead with the score
          await db.run(
            `UPDATE leads SET match_score = ?, match_reasoning = ?, updated_at = ? WHERE id = ?`,
            matchInfo.score,
            matchInfo.reasoning,
            new Date().toISOString(),
            lead.id
          );
        } catch {
          matchInfo = {};
        }
      }

      const draft = await generateOutreachEmail(lead, matchInfo);

      await withTransaction(async () => {
        await db.run(
          `INSERT INTO emails (lead_id, kind, subject, body, status, created_at, updated_at)
           VALUES (?, 'initial', ?, ?, 'pending', ?, ?)`,
          lead.id,
          draft.subject,
          draft.body,
          new Date().toISOString(),
          new Date().toISOString()
        );

        await updateLeadStatus(lead.id, "email_generated");
      });

      generated += 1;
      console.log(`  ✅ Subject: ${draft.subject}`);

      // Rate limit OpenAI calls
      await new Promise((resolve) => setTimeout(resolve, 500));
    } catch (error) {
      failed += 1;
      console.error(
        `  ❌ Failed for ${lead.name}: ${error.message}`
      );
    }
  }

  console.log(`\nGeneration complete. Created ${generated} email drafts.`);
  console.log(`Failures: ${failed}`);
}

main()
  .catch((error) => {
    console.error("Email generation failed.");
    console.error(error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeDb();
  });
