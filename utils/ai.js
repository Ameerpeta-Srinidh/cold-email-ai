import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const OLLAMA_API_URL = process.env.OLLAMA_URL || "http://localhost:11434/api/chat";
const DEFAULT_MODEL = process.env.OLLAMA_MODEL || "llama3";

// ── Load Profile ─────────────────────────────────────────

let _cachedProfile = null;

export function loadProfile() {
  if (_cachedProfile) return _cachedProfile;

  const profilePath = path.resolve(__dirname, "..", "data", "profile.json");
  if (!fs.existsSync(profilePath)) {
    throw new Error(`Profile not found at ${profilePath}. Create data/profile.json first.`);
  }
  _cachedProfile = JSON.parse(fs.readFileSync(profilePath, "utf-8"));
  return _cachedProfile;
}

// ── Ollama Helpers ───────────────────────────────────────

async function callOllama(messages, options = {}) {
  const payload = {
    model: options.model || DEFAULT_MODEL,
    messages,
    stream: false,
    options: {
      temperature: options.temperature ?? 0.7,
    }
  };

  if (options.json) {
    payload.format = "json";
  }

  const response = await fetch(OLLAMA_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Ollama request failed (${response.status}): ${errorText}. Make sure Ollama is running!`);
  }

  const data = await response.json();
  const content = data?.message?.content;

  if (!content) {
    throw new Error("Ollama returned an empty response.");
  }

  return options.json ? JSON.parse(content) : content;
}

// ── Stage 3: Company Match Scoring ──────────────────────

/**
 * Score how well a company/role matches the user's profile.
 * Returns a 0-100 score with reasoning.
 *
 * @param {{company:string, role:string, description?:string, snippet?:string}} lead
 * @returns {Promise<{score:number, reasoning:string, relevant_skills:string[], relevant_projects:string[]}>}
 */
export async function scoreCompanyMatch(lead) {
  const profile = loadProfile();

  const messages = [
    {
      role: "system",
      content: `You are a career matching assistant. You evaluate how well a candidate's skills and projects match a company/role. Return JSON only.`,
    },
    {
      role: "user",
      content: `Rate the match (0-100) between this candidate and this opportunity.

CANDIDATE PROFILE:
- Name: ${profile.name}
- Skills: ${JSON.stringify(profile.skills)}
- Projects: ${profile.projects.map((p) => `${p.name}: ${p.description}`).join("\n  ")}
- Target Roles: ${profile.target_roles.join(", ")}

OPPORTUNITY:
- Company: ${lead.company}
- Role/Contact Title: ${lead.role}
- Context: ${lead.description || lead.snippet || "N/A"}

Return a JSON object with:
{
  "score": <0-100 integer>,
  "reasoning": "<1-2 sentence explanation>",
  "relevant_skills": ["<skills from candidate that match>"],
  "relevant_projects": ["<project names from candidate that are relevant>"]
}`,
    },
  ];

  return await callOllama(messages, { json: true, temperature: 0.3 });
}

// ── Stage 4: Enhanced Email Generation ──────────────────

const OUTREACH_SYSTEM_PROMPT = `You are a personalized cold email writer for internship outreach. You write concise, genuine, non-spammy emails that get responses.

Rules:
- Keep the body under 120 words.
- Sound like an enthusiastic student, NOT a salesperson.
- Reference ONE specific project that's relevant to the company.
- Mention 2-3 specific technical skills that match the role.
- End with a soft ask (quick chat, 15-min call, advice).
- DO NOT use generic phrases like "I came across your profile" or "I hope this email finds you well".
- Open with something specific about the company or the person's work.
- Include portfolio/LinkedIn links if provided.
- Return a JSON object: { "subject": "...", "body": "..." }`;

/**
 * Generate a personalized cold outreach email for a lead.
 *
 * @param {{name:string, email:string, company:string, role:string}} lead
 * @param {{score?:number, relevant_skills?:string[], relevant_projects?:string[]}} matchInfo
 * @returns {Promise<{subject:string, body:string}>}
 */
export async function generateOutreachEmail(lead, matchInfo = {}) {
  const profile = loadProfile();

  const relevantProject = pickRelevantProject(profile, matchInfo);
  const relevantSkills = matchInfo.relevant_skills?.slice(0, 3) || pickTopSkills(profile, 3);

  const links = [];
  if (profile.linkedin) links.push(`LinkedIn: ${profile.linkedin}`);
  if (profile.portfolio) links.push(`Portfolio: ${profile.portfolio}`);
  if (profile.github) links.push(`GitHub: ${profile.github}`);

  const messages = [
    { role: "system", content: OUTREACH_SYSTEM_PROMPT },
    {
      role: "user",
      content: `Write a cold outreach email for an internship opportunity.

ABOUT ME:
- Name: ${profile.name}
- Relevant skills: ${relevantSkills.join(", ")}
- Relevant project: ${relevantProject.name} — ${relevantProject.description}
  Tech: ${relevantProject.tech.join(", ")}
${links.length > 0 ? `- Links: ${links.join(" | ")}` : ""}
- Resume summary: ${profile.resume_summary}

RECIPIENT:
- Name: ${lead.name}
- Role: ${lead.role}
- Company: ${lead.company}

CONTEXT:
- Match score: ${matchInfo.score || "N/A"}/100
- Why it matches: ${matchInfo.reasoning || "General outreach"}

Generate the JSON email now.`,
    },
  ];

  const draft = await callOllama(messages, { json: true });

  return sanitizeEmailDraft(draft, lead);
}

/**
 * Generate email using the legacy simple prompt (backward compatibility).
 */
export async function generateOutreachEmailSimple(lead) {
  return generateOutreachEmail(lead, {});
}

// ── Helpers ──────────────────────────────────────────────

function pickRelevantProject(profile, matchInfo) {
  if (matchInfo.relevant_projects?.length > 0) {
    const matchedName = matchInfo.relevant_projects[0];
    const found = profile.projects.find(
      (p) => p.name.toLowerCase() === matchedName.toLowerCase()
    );
    if (found) return found;
  }
  // Default to first project
  return profile.projects[0] || { name: "Project", description: "N/A", tech: [] };
}

function pickTopSkills(profile, count) {
  const allSkills = [
    ...(profile.skills.languages || []),
    ...(profile.skills.frameworks || []),
    ...(profile.skills.ml_ai || []),
  ];
  return allSkills.slice(0, count);
}

function sanitizeEmailDraft(draft, lead) {
  let subject = String(draft.subject || "").trim();
  let body = String(draft.body || "").trim();

  if (!subject) {
    subject = `Internship Inquiry — ${lead.company}`;
  }

  if (!body) {
    throw new Error("OpenAI returned an empty email body.");
  }

  // Clean up excessive whitespace
  body = body.replace(/\n{3,}/g, "\n\n").trim();

  // Ensure the company or person is mentioned
  const lowerBody = body.toLowerCase();
  if (
    !lowerBody.includes(lead.company.toLowerCase()) &&
    !lowerBody.includes(lead.name.toLowerCase().split(" ")[0])
  ) {
    body = `Hi ${lead.name.split(" ")[0]},\n\n${body}`;
  }

  return { subject, body };
}

// Backward-compatible export
export { OUTREACH_SYSTEM_PROMPT as BASE_PROMPT };
