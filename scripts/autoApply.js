#!/usr/bin/env node
import "dotenv/config";
import { closeDb, getDb, logApplication } from "../db.js";
import { applyOnPortal, detectPortalType } from "../utils/portalApplicant.js";

async function main() {
  let chromium;

  try {
    const pw = await import("playwright");
    chromium = pw.chromium;
  } catch {
    console.error("❌ Playwright is not installed.");
    console.error('   Run: npm install playwright && npx playwright install chromium');
    process.exitCode = 1;
    return;
  }

  const db = await getDb();

  // Find leads with career pages that haven't been applied to yet
  const leadsWithCareers = await db.all(`
    SELECT l.id, l.name, l.company, l.role, l.careers_page, l.match_score
    FROM leads l
    WHERE l.careers_page IS NOT NULL
      AND l.careers_page != ''
      AND l.id NOT IN (
        SELECT COALESCE(a.lead_id, 0) FROM applications a
        WHERE a.status IN ('submitted', 'confirmed')
      )
    ORDER BY l.match_score DESC NULLS LAST
    LIMIT 10
  `);

  if (leadsWithCareers.length === 0) {
    console.log("No leads with career pages to apply to.");
    console.log("Run 'npm run discover:leads' first to find companies.");
    return;
  }

  console.log("╔═══════════════════════════════════════════════════════╗");
  console.log("║         🤖 AUTO-APPLY ENGINE                         ║");
  console.log("╚═══════════════════════════════════════════════════════╝");
  console.log();
  console.log(`Found ${leadsWithCareers.length} career pages to attempt.\n`);

  // Launch browser
  const browser = await chromium.launch({
    headless: false, // Show browser so user can see what's happening
  });

  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  });

  let applied = 0;
  let failed = 0;
  let skipped = 0;

  for (const lead of leadsWithCareers) {
    console.log(`\n🏢 ${lead.company} — ${lead.careers_page}`);
    console.log(`   Role: ${lead.role} | Match Score: ${lead.match_score || "N/A"}/100`);

    const page = await context.newPage();

    try {
      const result = await applyOnPortal(page, lead.careers_page);

      if (result.success) {
        applied++;
        console.log(`   ✅ Application form filled successfully!`);
        if (result.note) console.log(`   📝 ${result.note}`);

        await logApplication({
          lead_id: lead.id,
          company: lead.company,
          role: lead.role,
          portal_url: lead.careers_page,
          portal_type: result.portalType,
          status: "submitted",
          screenshot_path: result.screenshotPath,
          applied_at: new Date().toISOString(),
        });
      } else {
        failed++;
        console.log(`   ❌ Could not auto-apply: ${result.error}`);

        await logApplication({
          lead_id: lead.id,
          company: lead.company,
          role: lead.role,
          portal_url: lead.careers_page,
          portal_type: result.portalType,
          status: "failed",
          screenshot_path: result.screenshotPath,
          error_message: result.error,
        });
      }
    } catch (error) {
      failed++;
      console.log(`   ❌ Error: ${error.message}`);

      await logApplication({
        lead_id: lead.id,
        company: lead.company,
        role: lead.role,
        portal_url: lead.careers_page,
        portal_type: detectPortalType(lead.careers_page),
        status: "failed",
        error_message: error.message,
      });
    } finally {
      await page.close();
    }

    // Pause between applications
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }

  await browser.close();

  // ── Summary ──
  console.log("\n╔═══════════════════════════════════════════════════════╗");
  console.log("║         📊 AUTO-APPLY SUMMARY                        ║");
  console.log("╚═══════════════════════════════════════════════════════╝");
  console.log(`  Attempted:  ${leadsWithCareers.length}`);
  console.log(`  Successful: ${applied}`);
  console.log(`  Failed:     ${failed}`);
  console.log(`  Skipped:    ${skipped}`);
  console.log(`\nScreenshots are saved in data/screenshots/`);
}

main()
  .catch((error) => {
    console.error("\n❌ Auto-apply failed.");
    console.error(error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeDb();
  });
