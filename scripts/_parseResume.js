import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const pdfModule = require("pdf-parse");
const pdf = pdfModule.default || pdfModule;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const resumePath = path.resolve(__dirname, "..", "data", "resume.pdf");
const buffer = fs.readFileSync(resumePath);
const data = await pdf(buffer);

console.log("=== RESUME TEXT ===");
console.log(data.text);
console.log("=== END ===");
console.log("Pages:", data.numpages);
console.log("Characters:", data.text.length);
