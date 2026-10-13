const fs = require("fs");
const path = require("path");
const { PDFParse } = require("pdf-parse");

const resumePath = path.resolve(__dirname, "..", "data", "resume.pdf");
const buffer = fs.readFileSync(resumePath);

const parser = new PDFParse(buffer);
parser.parse().then(data => {
  console.log("=== RESUME TEXT ===");
  console.log(data.text);
  console.log("=== END ===");
  console.log("Pages:", data.numpages);
}).catch(err => {
  console.error("Error:", err.message);
});
