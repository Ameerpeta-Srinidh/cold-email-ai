import "dotenv/config";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { closeDb, getDb, withTransaction } from "../db.js";
import { loadLeadsFromCsv } from "../utils/csvLoader.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");

async function main() {
  const csvPath =
    process.argv[2] || path.join(projectRoot, "data", "leads.csv");
  const leads = await loadLeadsFromCsv(csvPath);
  const db = await getDb();

  if (leads.length === 0) {
    console.log(`No valid leads found in ${csvPath}.`);
    return;
  }

  let inserted = 0;
  let updated = 0;

  await withTransaction(async () => {
    for (const lead of leads) {
      const existing = await db.get(
        `
          SELECT id
          FROM leads
          WHERE email = ?
        `,
        lead.email
      );

      await db.run(
        `
          INSERT INTO leads (name, email, company, role, updated_at)
          VALUES (?, ?, ?, ?, ?)
          ON CONFLICT(email) DO UPDATE SET
            name = excluded.name,
            company = excluded.company,
            role = excluded.role,
            updated_at = excluded.updated_at
        `,
        lead.name,
        lead.email,
        lead.company,
        lead.role,
        new Date().toISOString()
      );

      if (existing) {
        updated += 1;
      } else {
        inserted += 1;
      }
    }
  });

  const totalLeads = await db.get("SELECT COUNT(*) AS count FROM leads");

  console.log(`Imported leads from ${csvPath}`);
  console.log(`Inserted: ${inserted}`);
  console.log(`Updated existing: ${updated}`);
  console.log(`Total leads in database: ${totalLeads.count}`);
}

main()
  .catch((error) => {
    console.error("Lead import failed.");
    console.error(error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeDb();
  });
