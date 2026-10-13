# Cold Email AI v2

Autonomous internship outreach agent. Discovers companies matching your skills, finds hiring managers, generates personalized cold emails, and auto-applies on career portals.

## Setup

npm install
npx playwright install chromium
cp .env.example .env

Edit .env with your API keys and data/profile.json with your skills.

## Usage

npm run pipeline          # Full pipeline
npm run discover:leads    # Find companies and contacts
npm run generate:emails   # Create email drafts
npm run approve:send      # Review and send
npm run auto:apply        # Apply on career portals
npm run status            # Dashboard
npm run import:leads      # Manual CSV import

## Required API Keys

OPENAI_API_KEY - email generation and skill matching
SERPAPI_KEY - company and people discovery
RESEND_API_KEY - email delivery (for sending)
HUNTER_API_KEY - optional, better email discovery
