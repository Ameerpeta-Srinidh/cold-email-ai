import "dotenv/config";

const SERPAPI_URL = "https://serpapi.com/search.json";

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

/**
 * Run a Google search via SerpAPI and return organic results.
 * @param {string} query  The search query
 * @param {number} num    Number of results (max 100)
 * @returns {Promise<Array<{title:string, link:string, snippet:string}>>}
 */
export async function searchGoogle(query, num = 20) {
  const apiKey = requireEnv("SERPAPI_KEY");

  const params = new URLSearchParams({
    q: query,
    api_key: apiKey,
    engine: "google",
    num: String(num),
    hl: "en",
    gl: "in",
  });

  const response = await fetch(`${SERPAPI_URL}?${params}`);

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`SerpAPI request failed (${response.status}): ${body}`);
  }

  const data = await response.json();
  return (data.organic_results || []).map((r) => ({
    title: r.title || "",
    link: r.link || "",
    snippet: r.snippet || "",
    position: r.position,
  }));
}

/**
 * Search LinkedIn for people at a specific company with a given role.
 * @param {string} company   Company name
 * @param {string} role      Role to search for (e.g. "Engineering Manager")
 * @returns {Promise<Array<{name:string, title:string, link:string}>>}
 */
export async function searchLinkedInPeople(company, role) {
  const query = `site:linkedin.com/in "${role}" "${company}"`;
  const results = await searchGoogle(query, 10);

  return results
    .filter((r) => r.link.includes("linkedin.com/in/"))
    .map((r) => {
      // Extract name from LinkedIn title pattern: "Name - Title - Company | LinkedIn"
      const namePart = r.title.split(" - ")[0].replace(/ \| LinkedIn$/i, "").trim();
      return {
        name: namePart,
        title: r.title,
        linkedinUrl: r.link,
        snippet: r.snippet,
      };
    });
}

/**
 * Search for internship postings at companies matching given skills.
 * @param {string[]} skills   Array of skill keywords
 * @param {string[]} roles    Array of target role titles
 * @returns {Promise<Array<{title:string, link:string, snippet:string, company:string}>>}
 */
export async function searchInternships(skills, roles) {
  const allResults = [];
  const seenLinks = new Set();

  // Build targeted search queries
  const skillChunks = chunkArray(skills, 3);
  const queries = [];

  // Prioritized locations based on user preference
  const locations = [
    '"remote" OR "Hyderabad"',
    '"Bangalore" OR "Pune" OR "Mumbai"',
    '"India"'
  ];

  for (const role of roles.slice(0, 3)) {
    for (const chunk of skillChunks.slice(0, 2)) {
      for (const loc of locations) {
        queries.push(`"${role}" ${chunk.join(" ")} ${loc} hiring 2026`);
        queries.push(`"${role}" ${chunk.join(" ")} ${loc} internship apply`);
      }
    }
  }

  // Also search career pages directly
  queries.push(`internship software engineering careers apply 2026 "remote" OR "Hyderabad" OR "Bangalore"`);
  queries.push(`internship machine learning AI careers 2026 "remote" OR "Hyderabad" OR "Bangalore"`);

  for (const query of queries) {
    try {
      const results = await searchGoogle(query, 10);
      for (const r of results) {
        if (!seenLinks.has(r.link)) {
          seenLinks.add(r.link);
          allResults.push({
            ...r,
            company: extractCompanyFromResult(r),
            sourceQuery: query,
          });
        }
      }
      // Be polite to the API
      await new Promise((resolve) => setTimeout(resolve, 500));
    } catch (error) {
      console.warn(`Search query failed: "${query}" — ${error.message}`);
    }
  }

  return allResults;
}

/**
 * Find the careers page for a specific company.
 * @param {string} company
 * @returns {Promise<string|null>}
 */
export async function findCareersPage(company) {
  const results = await searchGoogle(`${company} careers internship apply`, 5);

  const careersResult = results.find(
    (r) =>
      r.link.includes("/careers") ||
      r.link.includes("/jobs") ||
      r.link.includes("greenhouse.io") ||
      r.link.includes("lever.co") ||
      r.link.includes("workday.com") ||
      r.link.includes("ashbyhq.com") ||
      r.link.includes("boards.") ||
      r.title.toLowerCase().includes("careers") ||
      r.title.toLowerCase().includes("jobs")
  );

  return careersResult ? careersResult.link : null;
}

/**
 * Search for hiring managers / recruiters at a company.
 * @param {string} company
 * @returns {Promise<Array<{name:string, role:string, linkedinUrl:string}>>}
 */
export async function findHiringContacts(company) {
  const rolesToSearch = [
    "Engineering Manager",
    "Hiring Manager",
    "Technical Recruiter",
    "Talent Acquisition",
    "Head of Engineering",
    "VP Engineering",
    "CTO",
    "Director of Engineering",
    "Recruiter",
  ];

  const contacts = [];
  const seenNames = new Set();

  for (const role of rolesToSearch) {
    try {
      const people = await searchLinkedInPeople(company, role);
      for (const person of people) {
        const normalizedName = person.name.toLowerCase().trim();
        if (!seenNames.has(normalizedName) && normalizedName.length > 2) {
          seenNames.add(normalizedName);
          contacts.push({
            name: person.name,
            role: role,
            company: company,
            linkedinUrl: person.linkedinUrl,
            snippet: person.snippet,
          });
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 400));
    } catch (error) {
      console.warn(`Contact search failed for "${role}" at ${company}: ${error.message}`);
    }

    // Stop once we have enough contacts per company
    if (contacts.length >= 5) break;
  }

  return contacts;
}

// ── Helpers ──────────────────────────────────────────────

function chunkArray(arr, size) {
  const chunks = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

function extractCompanyFromResult(result) {
  // Try to extract company name from the URL domain
  try {
    const url = new URL(result.link);
    const host = url.hostname.replace("www.", "").split(".")[0];
    // Capitalize
    return host.charAt(0).toUpperCase() + host.slice(1);
  } catch {
    return "";
  }
}
