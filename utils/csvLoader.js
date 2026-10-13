import fs from "node:fs";
import path from "node:path";
import { parse } from "csv-parse";

const REQUIRED_COLUMNS = ["name", "email", "company", "role"];

function normalizeRecord(record) {
  return Object.fromEntries(
    Object.entries(record).map(([key, value]) => [
      String(key).trim().toLowerCase(),
      typeof value === "string" ? value.trim() : value
    ])
  );
}

function assertRequiredColumns(record) {
  const missingColumns = REQUIRED_COLUMNS.filter((column) => !(column in record));

  if (missingColumns.length > 0) {
    throw new Error(
      `CSV is missing required columns: ${missingColumns.join(", ")}`
    );
  }
}

function normalizeLead(record, rowNumber) {
  const lead = normalizeRecord(record);
  assertRequiredColumns(lead);

  if (!lead.name) {
    throw new Error(`Row ${rowNumber}: "name" is required.`);
  }

  if (!lead.email) {
    throw new Error(`Row ${rowNumber}: "email" is required.`);
  }

  if (!lead.company) {
    throw new Error(`Row ${rowNumber}: "company" is required.`);
  }

  const email = lead.email.toLowerCase();

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error(`Row ${rowNumber}: "${lead.email}" is not a valid email.`);
  }

  return {
    name: lead.name,
    email,
    company: lead.company,
    role: lead.role || ""
  };
}

export async function loadLeadsFromCsv(filePath) {
  const absolutePath = path.resolve(filePath);

  if (!fs.existsSync(absolutePath)) {
    throw new Error(`CSV file not found: ${absolutePath}`);
  }

  const rows = [];
  const seenEmails = new Set();
  const parser = fs
    .createReadStream(absolutePath)
    .pipe(
      parse({
        columns: true,
        trim: true,
        skip_empty_lines: true
      })
    );

  let rowNumber = 1;

  for await (const record of parser) {
    rowNumber += 1;

    const lead = normalizeLead(record, rowNumber);

    if (seenEmails.has(lead.email)) {
      continue;
    }

    seenEmails.add(lead.email);
    rows.push(lead);
  }

  return rows;
}
