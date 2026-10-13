#!/usr/bin/env node
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { closeDb, upsertLead } from "../db.js";
import { scoreCompanyMatch, loadProfile } from "../utils/ai.js";
import { findBestEmail } from "../utils/emailFinder.js";
import {
  searchInternships,
  findHiringContacts,
  findCareersPage,
} from "../utils/webSearch.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const MIN_MATCH_SCORE = 40; // Only keep leads scoring above this

async function main() {
  const profile = loadProfile();

  console.log("╔═══════════════════════════════════════════════════════╗");
  console.log("║         🔍 LEAD DISCOVERY ENGINE                     ║");
  console.log("╚═══════════════════════════════════════════════════════╝");
  console.log();
  console.log(`Profile: ${profile.name}`);
  console.log(`Target roles: ${profile.target_roles.join(", ")}`);
  console.log(`Skills: ${Object.values(profile.skills).flat().slice(0, 8).join(", ")}...`);
  console.log();

  // ── Step 1: Discover companies/internships via web search ──
  console.log("━━━ Step 1: Searching for matching internships... ━━━");
  const allSkills = Object.values(profile.skills).flat();
  const searchResults = await searchInternships(allSkills, profile.target_roles);
  console.log(`Found ${searchResults.length} search results.\n`);

  // ── Step 2: Extract unique companies ──
  const companies = extractUniqueCompanies(searchResults);
  console.log(`Identified ${companies.length} unique companies.\n`);

  // ── Step 3: Score each company for match ──
  console.log("━━━ Step 2: Scoring company matches with AI... ━━━");
  const scoredCompanies = [];

  for (const company of companies) {
    try {
      const matchResult = await scoreCompanyMatch({
        company: company.name,
        role: company.role || "Software Engineering Intern",
        snippet: company.snippet,
      });

      company.matchScore = matchResult.score;
      company.matchReasoning = matchResult.reasoning;
      company.relevantSkills = matchResult.relevant_skills;
      company.relevantProjects = matchResult.relevant_projects;

      const emoji = matchResult.score >= 70 ? "🟢" : matchResult.score >= 50 ? "🟡" : "🔴";
      console.log(`  ${emoji} ${company.name}: ${matchResult.score}/100 — ${matchResult.reasoning}`);

      if (matchResult.score >= MIN_MATCH_SCORE) {
        scoredCompanies.push(company);
      }

      // Rate limit
      await sleep(300);
    } catch (error) {
      console.warn(`  ⚠️  Failed to score ${company.name}: ${error.message}`);
    }
  }

  console.log(`\n${scoredCompanies.length} companies passed the match threshold (>= ${MIN_MATCH_SCORE}).\n`);

  if (scoredCompanies.length === 0) {
    console.log("No matching companies found. Try broadening your search or lowering the threshold.");
    return;
  }

  // ── Step 4: Find contacts at each company ──
  console.log("━━━ Step 3: Finding hiring contacts... ━━━");
  const allLeads = [];

  for (const company of scoredCompanies) {
    try {
      console.log(`\n🏢 ${company.name} (score: ${company.matchScore}/100)`);

      // Find hiring contacts via LinkedIn search
      const contacts = await findHiringContacts(company.name);

      if (contacts.length === 0) {
        console.log(`   No contacts found. Trying generic outreach...`);
        // Create a generic lead entry
        contacts.push({
          name: `Hiring Team`,
          role: "Recruiter",
          company: company.name,
          linkedinUrl: "",
        });
      }

      // Find careers page
      const careersPage = await findCareersPage(company.name);
      if (careersPage) {
        console.log(`   📋 Careers page: ${careersPage}`);
      }

      // Find emails for each contact
      for (const contact of contacts.slice(0, 3)) {
        const companyDomain = guessCompanyDomain(company.name);
        const emailResult = await findBestEmail(contact.name, companyDomain);

        if (emailResult.email) {
          console.log(
            `   ✉️  ${contact.name} (${contact.role}) → ${emailResult.email} [${emailResult.method}, ${emailResult.confidence}% confidence]`
          );

          allLeads.push({
            name: contact.name,
            email: emailResult.email,
            company: company.name,
            role: contact.role,
            linkedin_url: contact.linkedinUrl || null,
            careers_page: careersPage || null,
            match_score: company.matchScore,
            match_reasoning: company.matchReasoning,
            email_confidence: emailResult.confidence,
            email_method: emailResult.method,
            source: "discovered",
          });
        } else {
          console.log(`   ❌ ${contact.name}: No email found.`);
        }
      }

      await sleep(500);
    } catch (error) {
      console.warn(`   ⚠️  Error processing ${company.name}: ${error.message}`);
    }
  }

  // ── Step 5: Save all leads to database ──
  console.log("\n━━━ Step 4: Saving leads to database... ━━━");
  let inserted = 0;
  let updated = 0;

  for (const lead of allLeads) {
    try {
      const result = await upsertLead(lead);
      if (result.action === "inserted") {
        inserted++;
      } else {
        updated++;
      }
    } catch (error) {
      console.warn(`  ⚠️  Failed to save ${lead.name}: ${error.message}`);
    }
  }

  // ── Step 6: Export to CSV for reference ──
  const csvPath = path.resolve(__dirname, "..", "data", "discovered_leads.csv");
  exportToCsv(allLeads, csvPath);

  // ── Summary ──
  console.log("\n╔═══════════════════════════════════════════════════════╗");
  console.log("║         📊 DISCOVERY SUMMARY                         ║");
  console.log("╚═══════════════════════════════════════════════════════╝");
  console.log(`  Companies searched:  ${companies.length}`);
  console.log(`  Companies matched:   ${scoredCompanies.length}`);
  console.log(`  Leads discovered:    ${allLeads.length}`);
  console.log(`  New leads inserted:  ${inserted}`);
  console.log(`  Existing updated:    ${updated}`);
  console.log(`  CSV exported to:     ${csvPath}`);
  console.log();
  console.log(`Next step: run "npm run generate:emails" to create personalized outreach drafts.`);
}

// ── Helpers ──────────────────────────────────────────────

function extractUniqueCompanies(results) {
  const seen = new Set();
  const companies = [];

  for (const r of results) {
    const name = (r.company || "").trim();
    if (!name || seen.has(name.toLowerCase())) continue;

    // Skip job boards and aggregators
    const skipDomains = [
      "linkedin", "indeed", "glassdoor", "monster", "ziprecruiter",
      "dice", "naukri", "angel", "wellfound", "ycombinator",
      "google", "bing", "yahoo", "reddit", "quora",
    ];
    if (skipDomains.some((d) => name.toLowerCase().includes(d))) continue;

    seen.add(name.toLowerCase());
    companies.push({
      name: name,
      link: r.link,
      snippet: r.snippet,
      role: extractRole(r),
    });
  }

  return companies;
}

function extractRole(result) {
  const title = (result.title || "").toLowerCase();
  if (title.includes("engineer")) return "Software Engineering Intern";
  if (title.includes("machine learning") || title.includes("ml")) return "ML Intern";
  if (title.includes("data")) return "Data Science Intern";
  if (title.includes("frontend") || title.includes("front-end")) return "Frontend Intern";
  if (title.includes("backend") || title.includes("back-end")) return "Backend Intern";
  if (title.includes("full stack") || title.includes("fullstack")) return "Full Stack Intern";
  return "Software Engineering Intern";
}

function guessCompanyDomain(companyName) {
  // Well-known mappings
  const knownDomains = {
    google: "google.com",
    meta: "meta.com",
    facebook: "meta.com",
    apple: "apple.com",
    amazon: "amazon.com",
    microsoft: "microsoft.com",
    netflix: "netflix.com",
    stripe: "stripe.com",
    notion: "notion.so",
    figma: "figma.com",
    vercel: "vercel.com",
    openai: "openai.com",
    anthropic: "anthropic.com",
    uber: "uber.com",
    airbnb: "airbnb.com",
    spotify: "spotify.com",
    shopify: "shopify.com",
    databricks: "databricks.com",
    snowflake: "snowflake.com",
    coinbase: "coinbase.com",
    robinhood: "robinhood.com",
    palantir: "palantir.com",
    datadog: "datadoghq.com",
    twilio: "twilio.com",
    cloudflare: "cloudflare.com",
    hashicorp: "hashicorp.com",
    confluent: "confluent.io",
    mongodb: "mongodb.com",
    elastic: "elastic.co",
    atlassian: "atlassian.com",
    slack: "slack.com",
    salesforce: "salesforce.com",
    adobe: "adobe.com",
    nvidia: "nvidia.com",
    intel: "intel.com",
    oracle: "oracle.com",
    ibm: "ibm.com",
    redhat: "redhat.com",
    vmware: "vmware.com",
    cisco: "cisco.com",
    paypal: "paypal.com",
    square: "squareup.com",
    block: "block.xyz",
    doordash: "doordash.com",
    instacart: "instacart.com",
    lyft: "lyft.com",
    pinterest: "pinterest.com",
    snapchat: "snap.com",
    snap: "snap.com",
    twitter: "x.com",
    tiktok: "tiktok.com",
    bytedance: "bytedance.com",
    roblox: "roblox.com",
    epic: "epicgames.com",
    unity: "unity.com",
    plaid: "plaid.com",
    rippling: "rippling.com",
    brex: "brex.com",
    gusto: "gusto.com",
    airtable: "airtable.com",
    linear: "linear.app",
    retool: "retool.com",
    supabase: "supabase.io",
  };

  const normalized = companyName.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (knownDomains[normalized]) return knownDomains[normalized];

  // Default: companyname.com
  return `${normalized}.com`;
}

function exportToCsv(leads, filePath) {
  const header = "name,email,company,role,match_score,email_confidence,linkedin_url,careers_page\n";
  const rows = leads.map((l) =>
    [
      csvEscape(l.name),
      csvEscape(l.email),
      csvEscape(l.company),
      csvEscape(l.role),
      l.match_score || "",
      l.email_confidence || "",
      csvEscape(l.linkedin_url || ""),
      csvEscape(l.careers_page || ""),
    ].join(",")
  );

  fs.writeFileSync(filePath, header + rows.join("\n") + "\n", "utf-8");
}

function csvEscape(value) {
  const str = String(value || "");
  if (str.includes(",") || str.includes('"') || str.includes("\n")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main()
  .catch((error) => {
    console.error("\n❌ Lead discovery failed.");
    console.error(error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeDb();
  });
