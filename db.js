import "dotenv/config";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sqlite3 from "sqlite3";
import { open } from "sqlite";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DB_PATH =
  process.env.DATABASE_PATH || path.resolve(__dirname, "database.sqlite");

let dbPromise = null;

async function initializeDatabase(db) {
  if (db.__coldEmailInitialized) {
    return db;
  }

  await db.exec(`
    CREATE TABLE IF NOT EXISTS leads (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      company TEXT NOT NULL,
      role TEXT,
      linkedin_url TEXT,
      careers_page TEXT,
      match_score INTEGER,
      match_reasoning TEXT,
      email_confidence INTEGER,
      email_method TEXT,
      source TEXT DEFAULT 'manual',
      status TEXT NOT NULL DEFAULT 'new' CHECK (
        status IN ('new', 'contacted', 'email_generated', 'email_sent', 'replied', 'archived')
      ),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_leads_email ON leads (email);

    CREATE INDEX IF NOT EXISTS idx_leads_status ON leads (status);

    CREATE TABLE IF NOT EXISTS emails (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      lead_id INTEGER NOT NULL,
      kind TEXT NOT NULL DEFAULT 'initial',
      subject TEXT NOT NULL,
      body TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending' CHECK (
        status IN ('pending', 'approved', 'sending', 'sent', 'failed')
      ),
      resend_id TEXT,
      error_message TEXT,
      approved_at TEXT,
      sent_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_emails_lead_kind ON emails (lead_id, kind);
    CREATE INDEX IF NOT EXISTS idx_emails_status ON emails (status);

    CREATE TABLE IF NOT EXISTS reply_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      lead_id INTEGER NOT NULL,
      email_id INTEGER,
      direction TEXT NOT NULL DEFAULT 'inbound' CHECK (
        direction IN ('inbound', 'outbound')
      ),
      raw_body TEXT NOT NULL DEFAULT 'placeholder',
      parsed_intent TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE CASCADE,
      FOREIGN KEY (email_id) REFERENCES emails(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS follow_ups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      lead_id INTEGER NOT NULL,
      parent_email_id INTEGER,
      status TEXT NOT NULL DEFAULT 'queued' CHECK (
        status IN ('queued', 'scheduled', 'sent', 'skipped')
      ),
      scheduled_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE CASCADE,
      FOREIGN KEY (parent_email_id) REFERENCES emails(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS applications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      lead_id INTEGER,
      company TEXT NOT NULL,
      role TEXT,
      portal_url TEXT,
      portal_type TEXT,
      status TEXT NOT NULL DEFAULT 'pending' CHECK (
        status IN ('pending', 'submitted', 'failed', 'confirmed', 'skipped')
      ),
      screenshot_path TEXT,
      error_message TEXT,
      applied_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE SET NULL
    );

    CREATE INDEX IF NOT EXISTS idx_applications_status ON applications (status);
    CREATE INDEX IF NOT EXISTS idx_applications_company ON applications (company);
  `);

  db.__coldEmailInitialized = true;
  return db;
}

export async function getDb() {
  if (!dbPromise) {
    dbPromise = open({
      filename: DB_PATH,
      driver: sqlite3.Database,
    }).then(initializeDatabase);
  }

  return dbPromise;
}

export async function withTransaction(work) {
  const db = await getDb();

  await db.exec("BEGIN");

  try {
    const result = await work(db);
    await db.exec("COMMIT");
    return result;
  } catch (error) {
    await db.exec("ROLLBACK");
    throw error;
  }
}

export async function updateLeadStatus(leadId, status) {
  const db = await getDb();

  await db.run(
    `
      UPDATE leads
      SET status = ?, updated_at = ?
      WHERE id = ?
    `,
    status,
    new Date().toISOString(),
    leadId
  );
}

/**
 * Upsert a discovered lead into the database.
 */
export async function upsertLead(lead) {
  const db = await getDb();

  const existing = await db.get("SELECT id FROM leads WHERE email = ?", lead.email);

  if (existing) {
    await db.run(
      `UPDATE leads
       SET name = COALESCE(?, name),
           company = COALESCE(?, company),
           role = COALESCE(?, role),
           linkedin_url = COALESCE(?, linkedin_url),
           careers_page = COALESCE(?, careers_page),
           match_score = COALESCE(?, match_score),
           match_reasoning = COALESCE(?, match_reasoning),
           email_confidence = COALESCE(?, email_confidence),
           email_method = COALESCE(?, email_method),
           source = COALESCE(?, source),
           updated_at = ?
       WHERE id = ?`,
      lead.name,
      lead.company,
      lead.role,
      lead.linkedin_url || null,
      lead.careers_page || null,
      lead.match_score ?? null,
      lead.match_reasoning || null,
      lead.email_confidence ?? null,
      lead.email_method || null,
      lead.source || null,
      new Date().toISOString(),
      existing.id
    );
    return { id: existing.id, action: "updated" };
  }

  const result = await db.run(
    `INSERT INTO leads (name, email, company, role, linkedin_url, careers_page, match_score, match_reasoning, email_confidence, email_method, source, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    lead.name,
    lead.email,
    lead.company,
    lead.role || "",
    lead.linkedin_url || null,
    lead.careers_page || null,
    lead.match_score ?? null,
    lead.match_reasoning || null,
    lead.email_confidence ?? null,
    lead.email_method || null,
    lead.source || "discovered",
    new Date().toISOString()
  );

  return { id: result.lastID, action: "inserted" };
}

/**
 * Log a portal application attempt.
 */
export async function logApplication(app) {
  const db = await getDb();

  const result = await db.run(
    `INSERT INTO applications (lead_id, company, role, portal_url, portal_type, status, screenshot_path, error_message, applied_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    app.lead_id || null,
    app.company,
    app.role || null,
    app.portal_url || null,
    app.portal_type || null,
    app.status || "pending",
    app.screenshot_path || null,
    app.error_message || null,
    app.applied_at || null
  );

  return result.lastID;
}

export async function closeDb() {
  if (!dbPromise) {
    return;
  }

  const db = await dbPromise;
  await db.close();
  dbPromise = null;
}
