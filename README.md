# ClawForce

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-blue.svg)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-22+-green.svg)](https://nodejs.org/)
[![MCP](https://img.shields.io/badge/MCP-Compatible-purple.svg)](https://modelcontextprotocol.io/)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](http://makeapullrequest.com)
[![Built with Claude Code](https://img.shields.io/badge/Built%20with-Claude%20Code-orange.svg)](https://claude.ai/code)

**Dispatch a mob. Collect the proof.**

ClawForce is a task orchestration engine that fans out physical-world operations to crowdsourced human agents at scale, then re-aggregates the results. Think Terraform, but instead of provisioning servers, you're provisioning *people*.

It gives AI agents like [OpenClaw](https://github.com/openclaw/openclaw) something they've never had: **human minions.** Your AI reasons about what needs to happen in the physical world. ClawForce makes it happen. Thousands of hands, thousands of eyes, one API call.

500 postcards to 500 doorsteps. 200 billboard photos for proof-of-play. 515 restaurant ad verifications during a 1-hour flight. 10,000 insurance property inspections overnight. One command.

```
clawforce campaign create \
  --name "Times Square Flash Mob" \
  --type verification \
  --provider auto \
  --targets locations.csv \
  --instructions "Show up. Dance. Film it."
```

---

## Why this matters

Every industry that dispatches humans to locations is paying for two things: **the person** and **the orchestration**. The person costs $8-80. The orchestration — the scheduling, the management layer, the QA, the reporting — costs 10x more. ClawForce makes the orchestration free. What's left is just the cost of a human showing up.

The other unlock is **speed**. An insurance company can't inspect 10,000 properties in a day. A retail brand can't audit 5,000 shelves before Monday. An ad agency can't verify 500 billboard placements during a single flight. With ClawForce, all of these are one command, executed in parallel, results aggregated automatically.

---

## Use cases that will make your CFO uncomfortable

### Out-of-Home Ad Verification
**What it costs now**: Verification companies charge $50-150/placement/month. Manual audits run $200-500/location.
**What ClawForce costs**: $7.75/photo via DoorDash. A 1,000-billboard audit drops from **$200K to $8K**.

```bash
clawforce campaign create \
  --name "Q2 Billboard Audit - Interstate Corridor" \
  --type photo_capture \
  --provider doordash \
  --targets billboards.csv \
  --instructions "Photograph the billboard face. Include surrounding street context. Capture any damage or obstruction."
```

### Insurance Property Inspections
**What it costs now**: $75-350 per drive-by inspection. Carriers spend billions annually on field inspections.
**What ClawForce costs**: $8-15/property. A 10,000-property book review drops from **$2M to $100K**.

```bash
clawforce campaign create \
  --name "FL Hurricane Portfolio Review" \
  --type photo_capture \
  --provider auto \
  --targets properties.csv \
  --instructions "Photograph front, left side, right side, and roof from street. Note visible damage, missing shingles, standing water, or debris."
```

### Retail Shelf Audits & Planogram Compliance
**What it costs now**: $30-100/store visit through companies like Trax or Repsly. CPG brands spend $50-100K/month.
**What ClawForce costs**: $8-20/store. A 5,000-store national audit: **$40K vs $300K**.

```bash
clawforce campaign create \
  --name "Walmart Endcap Verification - New Product Launch" \
  --type photo_capture \
  --provider auto \
  --targets walmart-locations.csv \
  --instructions "Go to aisle 7 endcap. Photograph the full display. Capture price tags. Note if product is present, out of stock, or incorrectly placed."
```

### Proof-of-Play for Restaurant/Bar Ad Campaigns
**What it costs now**: No scalable solution exists. Brands trust the network and hope.
**What ClawForce costs**: $8-15/location. 515 Texas Roadhouse and Buffalo Wild Wings locations verified during a 1-hour ad flight for **$4K-$8K**.

```bash
clawforce compare \
  --type photo_capture \
  --targets restaurant-locations.csv \
  --window 60

# Provider          | Per Task         | Total              | Status
# doordash          | $7.75 - $15.00   | $3,991 - $7,725    | Ready
# taskrabbit        | $20.00 - $80.00  | $10,300 - $41,200  | Stub
# field-nation      | $50.00 - $200.00 | $25,750 - $103,000 | Stub
```

### Political Canvassing & Voter Outreach
**What it costs now**: Professional canvassers cost $15-25/hour plus management overhead. A statewide petition campaign runs $1-5 per signature.
**What ClawForce costs**: $8-15/door. 10,000 doors knocked in a single Saturday. No hiring, no training, no payroll.

```bash
clawforce campaign create \
  --name "Voter Registration Drive - Swing Districts" \
  --type delivery \
  --provider auto \
  --targets voter-addresses.csv \
  --template registration-packet.json \
  --instructions "Deliver voter registration packet. Ring doorbell. If no answer, leave at door and photograph placement."
```

### Legal Process Serving
**What it costs now**: $50-150 per serve attempt. Specialized servers charge $200+.
**What ClawForce costs**: $8-15/attempt. A firm serving 500 defendants drops from **$50K to $6K**.

### Real Estate Portfolio Inspections
**What it costs now**: BPOs (Broker Price Opinions) run $50-150 each. Banks order millions annually.
**What ClawForce costs**: $8-15/property. A bank reviewing 50,000 properties in a distressed portfolio: **$400K vs $5M**.

### Mystery Shopping
**What it costs now**: $25-75 per shop visit. National programs run $500K+/year.
**What ClawForce costs**: $20-35/visit via TaskRabbit. A 2,000-location quarterly mystery shop: **$40K vs $150K**.

```bash
clawforce campaign create \
  --name "Q2 Mystery Shop - Drive-Thru Speed" \
  --type custom \
  --provider taskrabbit \
  --targets franchise-locations.csv \
  --instructions "Visit drive-thru. Order a #3 combo. Time from order to receipt. Photograph the receipt showing timestamp. Rate friendliness 1-5. Upload receipt photo and notes."
```

### Guerrilla Marketing / Street Teams
**What it costs now**: Agencies charge $25-50/hour per brand ambassador, 4-hour minimums. A 100-city activation runs $500K+.
**What ClawForce costs**: $15-30/person. Fan out 500 street team members in one API call.

### Environmental & Compliance Monitoring
**What it costs now**: Environmental consulting firms charge $150-500/site visit.
**What ClawForce costs**: $8-20/site. A developer with 200 active construction sites saves **$60K/quarter** on stormwater compliance photos alone.

### Disaster Response Documentation
**What it costs now**: Insurance adjusters fly in at $500-1,000/day. FEMA assessments take weeks.
**What ClawForce does**: Immediately after a disaster, fan out to every affected address. **Thousands of damage assessments in hours instead of weeks.** The speed alone is worth more than the cost savings.

```bash
# Hurricane makes landfall at 2am. By 8am:
clawforce campaign create \
  --name "Hurricane Milton - Immediate Damage Assessment" \
  --type photo_capture \
  --provider auto \
  --targets insured-properties-fl.csv \
  --concurrency 50 \
  --instructions "Photograph property from all accessible angles. Document roof damage, flooding, debris, broken windows. Include street-level context. Do NOT enter damaged structures."
```

---

## The math

| Industry | Traditional Cost | ClawForce Cost | Savings |
|----------|-----------------|----------------|---------|
| Billboard audit (1,000 locations) | $200,000 | $8,000 | **96%** |
| Property inspections (10,000) | $2,000,000 | $100,000 | **95%** |
| Retail shelf audit (5,000 stores) | $300,000 | $40,000 | **87%** |
| Proof-of-play verification (515) | N/A (didn't exist) | $4,000 | **New capability** |
| Process serving (500 defendants) | $50,000 | $6,000 | **88%** |
| Real estate BPOs (50,000) | $5,000,000 | $400,000 | **92%** |
| Mystery shopping (2,000/quarter) | $150,000 | $40,000 | **73%** |
| Disaster assessment (5,000 properties) | Weeks + $500K | Hours + $50K | **90% + 100x faster** |

---

## Install

```bash
# Clone it
git clone https://github.com/mikeangstadt/clawforce.git
cd clawforce

# Install dependencies
pnpm install

# Copy env template
cp .env.example .env

# Run it
pnpm dev --help
```

### Global install (after build)

```bash
pnpm build
pnpm link --global

# Now available everywhere
clawforce providers
clawforce campaign create ...
```

### As an MCP server (for Claude, OpenClaw, etc.)

Add to your MCP client config:

```json
{
  "mcpServers": {
    "clawforce": {
      "command": "npx",
      "args": ["tsx", "/path/to/clawforce/src/mcp/server.ts"],
      "env": {
        "CLAWFORCE_DB_PATH": "/path/to/clawforce.db"
      }
    }
  }
}
```

Now your AI agent has human minions. It can reason about what needs to happen in the physical world, compare providers and costs, dispatch thousands of people, and collect the results — all through tool calls. The AI plans. ClawForce executes. Humans deliver.

---

## How it works

```
You (or your AI agent) define a campaign
        |
        v
  Template + Targets (CSV/JSON)
        |
        v
  +-----------+
  |  FAN OUT  |  p-queue, concurrency-controlled, per-task error isolation
  +-----------+
        |
   +---------+---------+---------+
   |         |         |         |
   v         v         v         v
 Task 1    Task 2    Task 3    Task N
   |         |         |         |
   v         v         v         v
 Provider  Provider  Provider  Provider
(DoorDash) (TaskRabbit) (Uber) (any)
   |         |         |         |
   v         v         v         v
 Human     Human     Human     Human
 Agent     Agent     Agent     Agent
   |         |         |         |
   v         v         v         v
  +---------------------------+
  |       RE-AGGREGATE        |  poll, collect, milestone webhooks
  +---------------------------+
        |
        v
  Unified results: photos, costs, success rates, provider breakdown
```

---

## Providers

ClawForce doesn't care who does the work. Every gig platform is just a provider implementing one interface. The engine routes tasks to the cheapest capable provider automatically.

| Provider | Task Types | Coverage | Cost/Task | Status |
|----------|-----------|----------|-----------|--------|
| **mock** | everything | everywhere | $1-5 | Ready (dev/test) |
| **doordash** | delivery, photo* | US (excl. CA, NYC, SEA, CO) | $7.75-15 | Ready (Drive API) |
| **taskrabbit** | photo, verification, errands, custom | US, UK, CA, FR, DE, ES | $20-80 | Stub |
| **uber-direct** | delivery | US, CA, MX, BR, AU, JP, GB, FR, DE | $5-12 | Stub |
| **field-nation** | verification, survey, photo, custom | US | $50-200 | Stub |

*\*DoorDash photo capture works by dispatching a delivery with specific `dropoff_instructions` and collecting the verification photo. Creative? Yes. Does it work? Also yes.*

### Compare providers before you commit

```bash
clawforce compare --type photo_capture --targets locations.csv --window 60
```

Cross-provider cost comparison with time window analysis, coverage gap detection, and a recommendation. Available as CLI, MCP tool (`compare_estimates`), and REST endpoint.

### Auto-routing

Set `--provider auto` and ClawForce picks the best provider per-task based on task type, location, and cost:

```bash
clawforce campaign create \
  --name "Nationwide Billboard Audit" \
  --type photo_capture \
  --provider auto \
  --targets billboards.csv \
  --instructions "Photograph the billboard face. Include surrounding context."
```

NYC target? Routes to TaskRabbit (DoorDash excludes NYC). Rural Texas? Field Nation. Chicago? DoorDash (cheapest with photo support).

### Adding a provider

One file. That's it.

```typescript
// src/providers/my-platform.ts
export class MyPlatformProvider implements TaskProvider {
  name = 'my-platform';
  capabilities = {
    taskTypes: ['delivery', 'photo_capture'],
    features: ['real_time_tracking', 'custom_instructions'],
    coverage: { countries: ['US'] },
    maxConcurrency: 10,
    estimatedCostRange: { minCents: 500, maxCents: 1500 },
  };

  async dispatch(task, template) { /* hit your API */ }
  async getStatus(id) { /* check status */ }
  async cancel(id) { /* cancel it */ }
  extractResult(data) { /* pull photos, fees, etc. */ }
  validateTemplate(t) { /* check required fields */ }
}
```

Register it in `src/providers/registry.ts`. Done. The engine, CLI, MCP tools, and REST API all pick it up automatically.

---

## CLI Reference

### List providers

```bash
# All providers
clawforce providers

# Only providers that support photo capture
clawforce providers --type photo_capture
```

### Compare costs across providers

```bash
# Compare all providers for a task type
clawforce compare --type photo_capture --targets locations.csv

# With a time window constraint (e.g., 1-hour ad flight)
clawforce compare --type photo_capture --targets locations.csv --window 60
```

### Create a campaign

```bash
clawforce campaign create \
  --name "Postcard Drop Q2" \
  --type delivery \
  --provider doordash \
  --targets addresses.csv \
  --template template.json \
  --concurrency 10 \
  --delay 200 \
  --webhook https://your-server.com/hooks/clawforce

# Dry run (creates records, doesn't dispatch)
clawforce campaign create \
  --name "Test Run" \
  --type delivery \
  --provider mock \
  --targets addresses.csv \
  --dry-run
```

### Track progress

```bash
clawforce campaign status <campaign_id>
clawforce campaign list
clawforce campaign list --status active
```

### Get results

```bash
# Summary
clawforce campaign results <campaign_id>

# Per-task details
clawforce campaign results <campaign_id> --details

# CSV export
clawforce campaign results <campaign_id> --details --format csv > results.csv
```

### Estimate cost (single provider)

```bash
clawforce estimate \
  --type delivery \
  --provider doordash \
  --targets addresses.csv \
  --template template.json
```

### Cancel

```bash
clawforce campaign cancel <campaign_id>
```

### Inspect a single task

```bash
clawforce task <task_id>
```

---

## MCP Tools

When running as an MCP server, ClawForce exposes these tools:

| Tool | What it does |
|------|-------------|
| `list_providers` | Show available providers, capabilities, coverage, costs |
| `compare_estimates` | Compare costs across ALL providers for a task type with time window analysis |
| `create_campaign` | Create + fan out a task campaign |
| `get_campaign_status` | Progress metrics, provider breakdown |
| `get_results` | Aggregated results: photos, costs, per-task details |
| `cancel_campaign` | Kill it |
| `list_campaigns` | List campaigns by status |
| `estimate_campaign` | Cost estimate from a single provider |

Your AI agent can now say *"compare the cost of sending someone to photograph all 515 of these restaurant locations during a 1-hour window, then use the cheapest provider that covers all locations"* — and ClawForce will do exactly that.

---

## REST API

Start the server:

```bash
pnpm server
# ClawForce server running on http://localhost:3100
```

| Method | Endpoint | Maps to |
|--------|----------|---------|
| GET | `/api/providers` | `list_providers` |
| POST | `/api/compare` | `compare_estimates` |
| POST | `/api/campaigns` | `create_campaign` |
| GET | `/api/campaigns` | `list_campaigns` |
| GET | `/api/campaigns/:id/status` | `get_campaign_status` |
| GET | `/api/campaigns/:id/results` | `get_results` |
| POST | `/api/campaigns/:id/cancel` | `cancel_campaign` |
| POST | `/api/estimate` | `estimate_campaign` |
| GET | `/health` | Health check |

---

## Target files

### CSV

```csv
address,name,phone
"123 Main St, Springfield, IL 62701",John Smith,555-0101
"456 Oak Ave, Chicago, IL 60601",Jane Doe,555-0102
```

### JSON

```json
[
  { "address": "123 Main St, Springfield, IL 62701", "name": "John Smith", "phone": "555-0101" },
  { "address": "456 Oak Ave, Chicago, IL 60601", "name": "Jane Doe", "phone": "555-0102" }
]
```

Extra columns in CSV become `metadata` on the target — use them for campaign-specific data.

---

## Template files

```json
{
  "pickupAddress": "100 Print Shop Lane, Springfield, IL 62701",
  "pickupBusinessName": "FastPrint Co",
  "pickupPhoneNumber": "555-0000",
  "pickupInstructions": "Postcards are in the labeled bin by the front door",
  "dropoffPhoneNumber": "555-9999",
  "dropoffInstructions": "Place in mailbox. If no mailbox, leave at front door.",
  "customInstructions": "Handle with care — these are personalized postcards",
  "orderValue": 100,
  "tip": 200
}
```

---

## Configuration

All via environment variables (or `.env` file):

| Variable | Default | What it does |
|----------|---------|-------------|
| `CLAWFORCE_DB_PATH` | `./clawforce.db` | SQLite database location |
| `CLAWFORCE_PORT` | `3100` | HTTP server port |
| `CLAWFORCE_POLL_INTERVAL_MS` | `30000` | How often to poll provider status (ms) |
| `CLAWFORCE_DEFAULT_CONCURRENCY` | `5` | Default parallel dispatch limit |
| `CLAWFORCE_LOG_LEVEL` | `info` | Log level (debug, info, warn, error) |
| `DOORDASH_DEVELOPER_ID` | -- | DoorDash Drive API credentials |
| `DOORDASH_KEY_ID` | -- | |
| `DOORDASH_SIGNING_SECRET` | -- | |

---

## Architecture

```
src/
  providers/        # Provider interface + implementations
    interface.ts    # The contract: capabilities, dispatch, getStatus, cancel, extractResult
    registry.ts     # Capability-based routing + auto-resolution + compare
    mock.ts         # Dev/test (simulates full lifecycle)
    doordash.ts     # DoorDash Drive API
    taskrabbit.ts   # Stub (ready for API access)
    uber-direct.ts  # Stub
    field-nation.ts # Stub
  engine/           # Core orchestration
    fanout.ts       # Template x Targets -> dispatched tasks (p-queue)
    poller.ts       # Status polling loop
    aggregator.ts   # Result collection + milestone webhooks
  mcp/              # MCP server (8 tools)
  cli/              # CLI commands
  db/               # SQLite + Drizzle schema
  models/           # Campaign, Task, Result CRUD
```

Single process. SQLite. No Redis. No Kafka. No Kubernetes. Just a binary that dispatches humans.

---

## License

MIT

---

*Built with [Claude Code](https://claude.ai/code)*
