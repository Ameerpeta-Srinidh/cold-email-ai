import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadProfile } from "./ai.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Detect what type of ATS portal a URL belongs to.
 * @param {string} url
 * @returns {string} Portal type identifier
 */
export function detectPortalType(url) {
  const lowerUrl = url.toLowerCase();

  if (lowerUrl.includes("greenhouse.io") || lowerUrl.includes("boards.greenhouse")) return "greenhouse";
  if (lowerUrl.includes("lever.co")) return "lever";
  if (lowerUrl.includes("workday.com") || lowerUrl.includes("myworkdayjobs")) return "workday";
  if (lowerUrl.includes("ashbyhq.com")) return "ashby";
  if (lowerUrl.includes("smartrecruiters.com")) return "smartrecruiters";
  if (lowerUrl.includes("icims.com")) return "icims";
  if (lowerUrl.includes("jobvite.com")) return "jobvite";
  if (lowerUrl.includes("breezy.hr")) return "breezy";
  if (lowerUrl.includes("jazz.co") || lowerUrl.includes("applytojob")) return "jazz";
  if (lowerUrl.includes("bamboohr.com")) return "bamboohr";
  if (lowerUrl.includes("workable.com")) return "workable";
  if (lowerUrl.includes("recruitee.com")) return "recruitee";

  return "generic";
}

/**
 * Apply to a job posting using Playwright.
 *
 * @param {import('playwright').Page} page  Playwright page object
 * @param {string} url                       The application URL
 * @param {object} options
 * @param {string} options.screenshotDir     Directory to save screenshots
 * @returns {Promise<{success:boolean, portalType:string, screenshotPath:string|null, error?:string}>}
 */
export async function applyOnPortal(page, url, options = {}) {
  const profile = loadProfile();
  const portalType = detectPortalType(url);
  const screenshotDir = options.screenshotDir || path.resolve(__dirname, "..", "data", "screenshots");

  // Ensure screenshot dir exists
  if (!fs.existsSync(screenshotDir)) {
    fs.mkdirSync(screenshotDir, { recursive: true });
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const screenshotPath = path.join(screenshotDir, `apply_${portalType}_${timestamp}.png`);

  try {
    console.log(`  🌐 Navigating to ${url}`);
    await page.goto(url, { waitUntil: "networkidle", timeout: 30000 });
    await page.waitForTimeout(2000);

    // Take a screenshot of the initial page
    await page.screenshot({ path: screenshotPath, fullPage: true });

    // Try to find and click an "Apply" button
    const applyClicked = await clickApplyButton(page);

    if (applyClicked) {
      await page.waitForTimeout(2000);

      // Fill in the form
      await fillApplicationForm(page, profile);

      // Upload resume if path is configured
      if (profile.resume_path && fs.existsSync(profile.resume_path)) {
        await uploadResume(page, profile.resume_path);
      }

      // Take post-fill screenshot
      const filledScreenshot = screenshotPath.replace(".png", "_filled.png");
      await page.screenshot({ path: filledScreenshot, fullPage: true });

      console.log(`  📸 Screenshots saved`);

      return {
        success: true,
        portalType,
        screenshotPath: filledScreenshot,
        note: "Form filled — manual submission may be required. Review the screenshot.",
      };
    }

    // If no apply button found, just save the careers page
    return {
      success: false,
      portalType,
      screenshotPath,
      error: "Could not find an Apply button on this page.",
    };
  } catch (error) {
    // Try to get a screenshot even on failure
    try {
      await page.screenshot({ path: screenshotPath, fullPage: true });
    } catch {}

    return {
      success: false,
      portalType,
      screenshotPath,
      error: error.message,
    };
  }
}

// ── Form Interaction Helpers ─────────────────────────────

async function clickApplyButton(page) {
  const applySelectors = [
    // Common ATS apply buttons
    'a:has-text("Apply")',
    'button:has-text("Apply")',
    'a:has-text("Apply Now")',
    'button:has-text("Apply Now")',
    'a:has-text("Apply for this job")',
    'button:has-text("Apply for this job")',
    '[data-qa="btn-apply"]',
    '.apply-button',
    '#apply-button',
    '.postings-btn-wrapper a',
    // Greenhouse
    '#submit_app',
    // Lever
    '.postings-btn',
    'a.postings-link',
  ];

  for (const selector of applySelectors) {
    try {
      const button = page.locator(selector).first();
      if (await button.isVisible({ timeout: 2000 })) {
        await button.click();
        console.log(`  ✅ Clicked apply button: ${selector}`);
        return true;
      }
    } catch {
      // Try next selector
    }
  }

  return false;
}

async function fillApplicationForm(page, profile) {
  const nameParts = profile.name.split(" ");
  const firstName = nameParts[0] || "";
  const lastName = nameParts.slice(1).join(" ") || "";

  // Field mapping: [selectors] → value
  const fields = [
    // Name fields
    {
      selectors: ['input[name*="first_name" i]', 'input[name*="firstname" i]', 'input[id*="first" i]', '#first_name', 'input[placeholder*="First" i]'],
      value: firstName,
    },
    {
      selectors: ['input[name*="last_name" i]', 'input[name*="lastname" i]', 'input[id*="last" i]', '#last_name', 'input[placeholder*="Last" i]'],
      value: lastName,
    },
    // Full name
    {
      selectors: ['input[name*="name" i]:not([name*="first"]):not([name*="last"])', 'input[placeholder*="Full name" i]', 'input[placeholder*="Name" i]:not([placeholder*="First"]):not([placeholder*="Last"])'],
      value: profile.name,
    },
    // Email
    {
      selectors: ['input[name*="email" i]', 'input[type="email"]', '#email', 'input[placeholder*="email" i]'],
      value: profile.email || process.env.FROM_EMAIL || "",
    },
    // Phone
    {
      selectors: ['input[name*="phone" i]', 'input[type="tel"]', '#phone', 'input[placeholder*="phone" i]'],
      value: profile.phone || "",
    },
    // LinkedIn
    {
      selectors: ['input[name*="linkedin" i]', 'input[placeholder*="linkedin" i]', 'input[name*="urls[LinkedIn]" i]'],
      value: profile.linkedin || process.env.LINKEDIN_URL || "",
    },
    // Portfolio / Website
    {
      selectors: ['input[name*="website" i]', 'input[name*="portfolio" i]', 'input[placeholder*="website" i]', 'input[placeholder*="portfolio" i]'],
      value: profile.portfolio || process.env.PORTFOLIO_URL || "",
    },
    // GitHub
    {
      selectors: ['input[name*="github" i]', 'input[placeholder*="github" i]'],
      value: profile.github || "",
    },
    // Location
    {
      selectors: ['input[name*="location" i]', 'input[placeholder*="location" i]', 'input[placeholder*="city" i]'],
      value: profile.location || "",
    },
  ];

  let filled = 0;

  for (const field of fields) {
    if (!field.value) continue;

    for (const selector of field.selectors) {
      try {
        const input = page.locator(selector).first();
        if (await input.isVisible({ timeout: 1000 })) {
          await input.fill(field.value);
          filled++;
          break;
        }
      } catch {
        // Try next selector
      }
    }
  }

  // Try to fill cover letter / additional info textareas
  const coverLetterSelectors = [
    'textarea[name*="cover" i]',
    'textarea[name*="letter" i]',
    'textarea[placeholder*="cover" i]',
    'textarea[name*="additional" i]',
    '#cover_letter',
  ];

  const coverLetter = `I'm ${profile.name}, a passionate engineering student with hands-on experience building ${profile.projects.map((p) => p.name).join(", ")}. I'm excited about this opportunity and would love to bring my skills in ${Object.values(profile.skills).flat().slice(0, 5).join(", ")} to your team.`;

  for (const selector of coverLetterSelectors) {
    try {
      const textarea = page.locator(selector).first();
      if (await textarea.isVisible({ timeout: 1000 })) {
        await textarea.fill(coverLetter);
        filled++;
        break;
      }
    } catch {}
  }

  console.log(`  📝 Filled ${filled} form field(s)`);
  return filled;
}

async function uploadResume(page, resumePath) {
  const fileInputSelectors = [
    'input[type="file"]',
    'input[name*="resume" i]',
    'input[name*="cv" i]',
    'input[accept*="pdf" i]',
    '#resume',
  ];

  for (const selector of fileInputSelectors) {
    try {
      const fileInput = page.locator(selector).first();
      if (await fileInput.count() > 0) {
        await fileInput.setInputFiles(resumePath);
        console.log(`  📄 Resume uploaded: ${path.basename(resumePath)}`);
        return true;
      }
    } catch {}
  }

  console.log(`  ⚠️  Could not find file upload input for resume.`);
  return false;
}
