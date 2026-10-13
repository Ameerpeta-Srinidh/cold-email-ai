import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const OLLAMA_API_URL = process.env.OLLAMA_URL || "http://localhost:11434/api/chat";
const DEFAULT_MODEL = process.env.OLLAMA_MODEL || "llama3";

async function parsePdf(filePath) {
  const data = new Uint8Array(await fs.readFile(filePath));
  const pdf = await pdfjsLib.getDocument({ data }).promise;
  let text = "";
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    text += content.items.map((item) => item.str).join(" ") + "\n";
  }
  return text;
}

async function callOllama(messages, options = {}) {
  const payload = {
    model: options.model || DEFAULT_MODEL,
    messages,
    stream: false,
    options: {
      temperature: options.temperature || 0.1,
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

async function main() {
  const resumePath = path.resolve(__dirname, "..", "data", "resume.pdf");
  const profilePath = path.resolve(__dirname, "..", "data", "profile.json");
  
  if (!(await fs.stat(resumePath).catch(() => false))) {
    console.error(`Resume file not found at ${resumePath}`);
    process.exit(1);
  }

  console.log("📄 Extracting text from resume...");
  let text;
  try {
    text = await parsePdf(resumePath);
  } catch (err) {
    console.error("Failed to parse PDF:", err.message);
    process.exit(1);
  }
  
  if (!text.trim()) {
    console.error("No text could be extracted from the resume.");
    process.exit(1);
  }

  console.log("🤖 Analyzing resume with Ollama...");

  const prompt = `
Extract the following information from the resume text to build a candidate profile for cold emails.
Return ONLY a JSON object that matches the structure below:

{
  "name": "Full name",
  "email": "Email address",
  "phone": "Phone number",
  "linkedin": "LinkedIn URL",
  "portfolio": "Portfolio/Website URL",
  "github": "GitHub URL",
  "location": "City, Country",
  "education": {
    "degree": "Degree name",
    "university": "University name",
    "graduation_year": "Graduation year",
    "gpa": "GPA if mentioned"
  },
  "target_roles": ["Top 3-5 roles this person is fit for"],
  "skills": {
    "languages": ["Programming languages"],
    "frameworks": ["Frameworks and libraries"],
    "tools": ["Dev tools, databases, software"],
    "domains": ["Industries or specific domains like ML, Frontend, Structural Engineering"]
  },
  "projects": [
    {
      "name": "Project name",
      "description": "Short, punchy 1-2 sentence description highlighting the impact or complexity.",
      "tech": ["Key tech stack used"],
      "url": "Project URL if mentioned"
    }
  ],
  "resume_summary": "A 2-3 sentence summary of the person's profile suitable for a recruiter to read."
}

Resume Text:
${text}
`;

  try {
    const profileData = await callOllama([
      { role: "system", content: "You are an expert technical recruiter." },
      { role: "user", content: prompt }
    ], { json: true });
    
    // Read the existing profile to merge or keep some fields like target roles if we want
    let existingProfile = {};
    try {
      existingProfile = JSON.parse(await fs.readFile(profilePath, "utf-8"));
    } catch (e) {
      // Ignore
    }

    const mergedProfile = { ...existingProfile, ...profileData, resume_path: resumePath };

    await fs.writeFile(profilePath, JSON.stringify(mergedProfile, null, 2));
    console.log("✅ Profile successfully updated based on your resume:");
    console.log(`   Name: ${mergedProfile.name}`);
    console.log(`   Skills found: ${
      [...(mergedProfile.skills?.languages||[]), ...(mergedProfile.skills?.frameworks||[])].length
    }`);
    console.log(`   Projects found: ${mergedProfile.projects?.length || 0}`);
    console.log(`   Saved to >> data/profile.json`);

  } catch (err) {
    console.error("❌ Failed to analyze resume:", err.message);
  }
}

main();
