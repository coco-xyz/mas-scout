# MAS Scout

Automated MAS (Monetary Authority of Singapore) license monitoring and compliance sales pipeline.

Built for [Cynopsis Solutions](https://www.cynopsis-solutions.com/) — a RegTech company providing KYC/AML compliance software.

---

## Problem

Cynopsis sells compliance software to companies that just received financial licenses (CMS, MPI) from MAS. These newly licensed companies have an immediate legal obligation to set up KYC/AML systems — making them ideal customers.

Current sales workflow is entirely manual:
1. Manually check MAS website for new license holders
2. Manually search LinkedIn for compliance directors
3. Manually write and send outreach emails
4. Manually prepare for discovery calls

This limits coverage to ~5-10 prospects per week per person.

---

## Architecture

```
┌──────────────────────────────────────────────────────────┐
│                      MAS Scout                            │
├──────────────┬──────────────┬─────────────┬──────────────┤
│  Watcher     │  Enricher    │  Outreach   │  Prep        │
│  (Step 1)    │  (Step 2)    │  (Step 3)   │  (Step 4)    │
│              │              │             │              │
│ FID diff     │ LinkedIn/    │ Personalized│ Reply        │
│ Press scan   │ Apollo       │ sequences   │ classifier   │
│ RSS monitor  │ Firmographic │ Multi-ch    │ Brief gen    │
│              │ data         │ scheduling  │ CRM sync     │
└──────┬───────┴──────┬───────┴──────┬──────┴──────┬───────┘
       │              │              │             │
       ▼              ▼              ▼             ▼
┌──────────────────────────────────────────────────────────┐
│                   Shared Data Layer                       │
│  - Prospect DB (companies + contacts + status)            │
│  - Sequence DB (outreach status per prospect)             │
│  - Template library (per license type)                    │
│  - Analytics (conversion tracking)                        │
└──────────────────────────────────────────────────────────┘
```

---

## Modules

### 1. Watcher — MAS License Monitor

**Input:** MAS Financial Institutions Directory (eservices.mas.gov.sg/fid)
**Output:** Newly licensed companies with metadata

- Daily scrape of MAS FID, diff against stored snapshot
- Detects new CMS (Capital Markets Services) and MPI (Major Payment Institution) license holders
- Supplements with press release monitoring (PRNewswire, Business Wire, fintech media)
- Extracts: company name, license type, grant date, registered address, website

**Key insight:** Companies that received licenses 2-4 weeks ago are in the "standing up compliance" phase — the golden window for sales.

**Tech:** Node.js, Puppeteer/Playwright for FID scraping, RSS parser
**External deps:** MAS FID (public, no auth), news APIs

### 2. Enricher — Contact & Company Intelligence

**Input:** Newly licensed company name
**Output:** Decision-maker contacts with firmographic data

- Searches LinkedIn / Apollo.io / Hunter.io for compliance roles at target company
- Priority ranking: CCO > MLRO > Head of Compliance > VP Compliance > Director
- Filters out non-decision-maker titles (Analyst, Associate)
- Enriches with: company headcount, funding stage, tech stack, recent news

**Tech:** Node.js, Apollo/PhantomBuster APIs
**External deps:** Apollo.io API (paid), LinkedIn (via PhantomBuster or Sales Navigator)

### 3. Outreach — Personalized Multi-Channel Sequences

**Input:** Enriched prospect record (company + contact + license type)
**Output:** Automated outreach sequences

- Generates personalized emails per prospect using:
  - License type → specific regulatory obligations (e.g., "PSA Section 29 requires MPI holders to maintain transaction monitoring")
  - Company context (size, funding, industry vertical)
  - Timing hook ("Congratulations on your [license] granted [date]")
- Multi-channel sequence: Email Day 1 → LinkedIn connect Day 3 → LinkedIn message Day 7 → Follow-up email Day 10
- Human review gate before sending (configurable: auto-send for high-confidence, review for edge cases)

**Tech:** Node.js, LLM for content generation
**External deps:** Email sending (Instantly.ai / Lemlist), LinkedIn automation (Expandi / PhantomBuster)

### 4. Prep — Reply Handling & Call Preparation

**Input:** Inbound replies from prospects
**Output:** Classified replies + meeting bookings + pre-call briefs

- **Reply classification:** Positive (book call) / Neutral (send info) / Objection / Negative
- **Auto-booking:** Positive replies get Calendly link + context-rich confirmation
- **Pre-call brief:** 24h before each call, auto-generates:
  - Company background + license details
  - Applicable regulatory requirements for their license type
  - Relevant Cynopsis products (Artemis for KYC, Athena for tx monitoring, Iris for advisers)
  - Recent company news + talking points
- **CRM sync:** All interactions logged automatically

**Tech:** Node.js, LLM for classification and brief generation
**External deps:** Calendar API (Cal.com / Calendly), CRM API (HubSpot / Salesforce)

---

## Data Model

```
Company {
  id: string
  name: string
  licenseType: "CMS" | "MPI" | "RFA" | ...
  licenseDate: date
  registeredAddress: string
  website: string
  headcount: number
  fundingStage: string
  source: "mas_fid" | "press" | "manual"
  discoveredAt: date
}

Contact {
  id: string
  companyId: string
  name: string
  title: string
  email: string
  linkedInUrl: string
  priority: number  // 1=CCO, 2=MLRO, 3=Head, 4=VP, 5=Director
  source: "apollo" | "linkedin" | "hunter" | "manual"
}

Sequence {
  id: string
  contactId: string
  status: "pending" | "active" | "replied" | "booked" | "closed"
  steps: [{
    channel: "email" | "linkedin"
    scheduledAt: date
    sentAt: date | null
    content: string
    opened: boolean
    replied: boolean
  }]
}
```

---

## Resource Requirements

### Infrastructure
- 1 VPS (shared with other services, minimal footprint)
- Database: SQLite for MVP, PostgreSQL for production
- Scheduler: cron or PM2-based

### External Services (MVP)
- **Apollo.io** — contact enrichment (free tier: 50 credits/month; paid: $49/month)
- **Instantly.ai or Lemlist** — email sequences ($30-97/month)
- **PhantomBuster** — LinkedIn automation ($56/month for Starter)
- **LLM API** — content generation (Claude or GPT, ~$20-50/month at scale)

### Development Timeline
- **Phase 1 (Watcher):** ~1 week
  - FID scraper, diff engine, press monitor
  - Deliverable: daily list of new MAS license holders
- **Phase 2 (Enricher):** ~1 week
  - Apollo/LinkedIn integration, contact ranking
  - Deliverable: enriched prospect cards
- **Phase 3 (Outreach):** ~1-2 weeks
  - Template library per license type, sequence engine, human review UI
  - Deliverable: semi-automated outreach pipeline
- **Phase 4 (Prep):** ~1 week
  - Reply classifier, brief generator, CRM integration
  - Deliverable: end-to-end pipeline from license grant to discovery call

### Team
- 1 developer (Node.js + API integrations)
- Cynopsis sales team for template validation and sequence tuning
- Agent team (Jessie + Lucy) for development, Boot for QA/DevOps

---

## MVP Scope

Phase 1 — the Watcher:
1. Daily MAS FID scrape + diff → detect new CMS/MPI license holders
2. Press release monitoring for license grant announcements
3. Output: daily digest to configured channel (email, Lark, Telegram)

This alone gives the sales team a **real-time signal** they currently lack — knowing exactly when a potential customer gets licensed.

---

## License

MIT
