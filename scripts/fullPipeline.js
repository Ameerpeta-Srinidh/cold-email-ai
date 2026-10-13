#!/usr/bin/env node
import "dotenv/config";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SCRIPTS_DIR = __dirname;

function runStep(scriptName, label) {
  console.log(`\n${"═".repeat(60)}`);
  console.log(`  🚀 ${label}`);
  console.log(`${"═".repeat(60)}\n`);

  try {
    execFileSync("node", [path.join(SCRIPTS_DIR, scriptName)], {
      stdio: "inherit",
      env: process.env,
    });
    return true;
  } catch (error) {
    console.error(`\n⚠️  Step "${label}" encountered an error.`);
    return false;
  }
}

async function askContinue(rl, message) {
  const answer = await rl.question(`\n${message} (yes/no): `);
  return answer.trim().toLowerCase() === "yes";
}

async function main() {
  const rl = readline.createInterface({ input, output });

  console.log("╔═══════════════════════════════════════════════════════════╗");
  console.log("║                                                           ║");
  console.log("║   🤖  COLD EMAIL AI — FULL PIPELINE                      ║");
  console.log("║                                                           ║");
  console.log("║   This will run the complete internship outreach flow:    ║");
  console.log("║                                                           ║");
  console.log("║   1. 🔍 Discover leads (web search + LinkedIn)           ║");
  console.log("║   2. ✉️  Generate personalized emails                     ║");
  console.log("║   3. 📨 Review & send approved emails                    ║");
  console.log("║   4. 🤖 Auto-apply on career portals (optional)          ║");
  console.log("║   5. 📊 Show status summary                              ║");
  console.log("║                                                           ║");
  console.log("╚═══════════════════════════════════════════════════════════╝");

  // Verify required env vars
  const requiredVars = ["SMTP_PASS", "SERPAPI_KEY"];
  const missing = requiredVars.filter((v) => !process.env[v]);

  if (missing.length > 0) {
    console.error(`\n❌ Missing required environment variables: ${missing.join(", ")}`);
    console.error("   Copy .env.example to .env and fill in your API keys/passwords.");
    process.exitCode = 1;
    rl.close();
    return;
  }

  // ── Step 1: Discover Leads ──
  const doDiscover = await askContinue(rl, "Step 1: Discover new leads via web search?");
  if (doDiscover) {
    runStep("discoverLeads.js", "LEAD DISCOVERY");
  }

  // ── Step 2: Generate Emails ──
  const doGenerate = await askContinue(rl, "Step 2: Generate personalized email drafts?");
  if (doGenerate) {
    runStep("generateEmails.js", "EMAIL GENERATION");
  }

  // ── Step 3: Review & Send ──
  const doSend = await askContinue(rl, "Step 3: Review and send approved emails?");
  if (doSend) {
    if (!process.env.SMTP_PASS) {
      console.log("⚠️  SMTP_PASS not configured. Skipping email send.");
    } else {
      runStep("approveAndSend.js", "EMAIL REVIEW & SEND");
    }
  }

  // ── Step 4: Auto-Apply ──
  const doApply = await askContinue(rl, "Step 4: Auto-apply on career portals? (requires Playwright)");
  if (doApply) {
    runStep("autoApply.js", "PORTAL AUTO-APPLY");
  }

  // ── Step 5: Status ──
  console.log();
  runStep("status.js", "PIPELINE STATUS");

  rl.close();
  console.log("\n✅ Pipeline complete. Good luck with your applications! 🎉\n");
}

main().catch((error) => {
  console.error("Pipeline failed:", error.message);
  process.exitCode = 1;
});
