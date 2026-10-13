import "dotenv/config";

const HUNTER_API_URL = "https://api.hunter.io/v2";

/**
 * Common corporate email patterns ordered by popularity.
 */
const EMAIL_PATTERNS = [
  (first, last, domain) => `${first}@${domain}`,
  (first, last, domain) => `${first}.${last}@${domain}`,
  (first, last, domain) => `${first[0]}${last}@${domain}`,
  (first, last, domain) => `${first}${last[0]}@${domain}`,
  (first, last, domain) => `${first}${last}@${domain}`,
  (first, last, domain) => `${last}@${domain}`,
  (first, last, domain) => `${first[0]}.${last}@${domain}`,
  (first, last, domain) => `${first}_${last}@${domain}`,
  (first, last, domain) => `${last}.${first}@${domain}`,
];

/**
 * Guess professional email addresses for a person at a company.
 * @param {string} fullName    e.g. "Jane Smith"
 * @param {string} companyDomain  e.g. "stripe.com"
 * @returns {string[]} Array of potential email addresses
 */
export function guessEmails(fullName, companyDomain) {
  const parts = fullName.toLowerCase().replace(/[^a-z\s]/g, "").trim().split(/\s+/);
  if (parts.length < 2) return [];

  const first = parts[0];
  const last = parts[parts.length - 1];
  const domain = companyDomain.toLowerCase().replace(/^www\./, "");

  return EMAIL_PATTERNS.map((pattern) => pattern(first, last, domain));
}

/**
 * Use Hunter.io to find the email pattern for a domain and verify an email.
 * @param {string} companyDomain  e.g. "stripe.com"
 * @param {string} fullName      e.g. "Jane Smith"
 * @returns {Promise<{email:string|null, confidence:number, sources:number}>}
 */
export async function findEmailViaHunter(companyDomain, fullName) {
  const apiKey = process.env.HUNTER_API_KEY;
  if (!apiKey) {
    return { email: null, confidence: 0, sources: 0, method: "hunter_unavailable" };
  }

  const parts = fullName.trim().split(/\s+/);
  if (parts.length < 2) {
    return { email: null, confidence: 0, sources: 0, method: "invalid_name" };
  }

  const firstName = parts[0];
  const lastName = parts[parts.length - 1];

  try {
    const params = new URLSearchParams({
      domain: companyDomain.replace(/^www\./, ""),
      first_name: firstName,
      last_name: lastName,
      api_key: apiKey,
    });

    const response = await fetch(`${HUNTER_API_URL}/email-finder?${params}`);

    if (!response.ok) {
      const body = await response.text();
      console.warn(`Hunter.io request failed (${response.status}): ${body}`);
      return { email: null, confidence: 0, sources: 0, method: "hunter_error" };
    }

    const data = await response.json();
    const result = data.data || {};

    return {
      email: result.email || null,
      confidence: result.confidence || 0,
      sources: result.sources || 0,
      method: "hunter",
    };
  } catch (error) {
    console.warn(`Hunter.io lookup failed for ${fullName} at ${companyDomain}: ${error.message}`);
    return { email: null, confidence: 0, sources: 0, method: "hunter_error" };
  }
}

/**
 * Get the domain email pattern from Hunter.io for a company.
 * @param {string} companyDomain
 * @returns {Promise<{pattern:string|null, emails:Array}>}
 */
export async function getDomainPattern(companyDomain) {
  const apiKey = process.env.HUNTER_API_KEY;
  if (!apiKey) {
    return { pattern: null, emails: [] };
  }

  try {
    const params = new URLSearchParams({
      domain: companyDomain.replace(/^www\./, ""),
      api_key: apiKey,
    });

    const response = await fetch(`${HUNTER_API_URL}/domain-search?${params}`);

    if (!response.ok) {
      return { pattern: null, emails: [] };
    }

    const data = await response.json();
    const result = data.data || {};

    return {
      pattern: result.pattern || null,
      emails: (result.emails || []).map((e) => ({
        email: e.value,
        firstName: e.first_name,
        lastName: e.last_name,
        position: e.position,
        confidence: e.confidence,
      })),
    };
  } catch {
    return { pattern: null, emails: [] };
  }
}

/**
 * Best-effort email finder: tries Hunter.io first, falls back to pattern guessing.
 * @param {string} fullName
 * @param {string} companyDomain
 * @returns {Promise<{email:string, confidence:number, method:string}>}
 */
export async function findBestEmail(fullName, companyDomain) {
  const domain = companyDomain.toLowerCase().replace(/^www\./, "");

  // 1. Try Hunter.io first
  const hunterResult = await findEmailViaHunter(domain, fullName);
  if (hunterResult.email && hunterResult.confidence >= 70) {
    return {
      email: hunterResult.email,
      confidence: hunterResult.confidence,
      method: "hunter_verified",
    };
  }

  // 2. Check domain pattern from Hunter and apply it
  const domainInfo = await getDomainPattern(domain);
  if (domainInfo.pattern) {
    const parts = fullName.toLowerCase().replace(/[^a-z\s]/g, "").trim().split(/\s+/);
    if (parts.length >= 2) {
      const first = parts[0];
      const last = parts[parts.length - 1];
      const patternEmail = applyPattern(domainInfo.pattern, first, last, domain);
      if (patternEmail) {
        return {
          email: patternEmail,
          confidence: 60,
          method: "hunter_pattern",
        };
      }
    }
  }

  // 3. If Hunter found something with lower confidence, still use it
  if (hunterResult.email) {
    return {
      email: hunterResult.email,
      confidence: hunterResult.confidence,
      method: "hunter_low_confidence",
    };
  }

  // 4. Fall back to the most common pattern guesses
  const guesses = guessEmails(fullName, domain);
  if (guesses.length > 0) {
    return {
      email: guesses[0], // firstname@domain is most common
      confidence: 30,
      method: "pattern_guess",
    };
  }

  return { email: null, confidence: 0, method: "no_result" };
}

/**
 * Apply a Hunter.io email pattern to a name.
 * Patterns can be: {first}, {last}, {f}, {l}, etc.
 */
function applyPattern(pattern, first, last, domain) {
  const replacements = {
    "{first}": first,
    "{last}": last,
    "{f}": first[0],
    "{l}": last[0],
  };

  let email = pattern;
  for (const [token, value] of Object.entries(replacements)) {
    email = email.replace(token, value);
  }

  // If the pattern didn't include @domain, add it
  if (!email.includes("@")) {
    email = `${email}@${domain}`;
  }

  return email;
}
