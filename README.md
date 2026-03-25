# ClawForce

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-blue.svg)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-22+-green.svg)](https://nodejs.org/)
[![MCP](https://img.shields.io/badge/MCP-Compatible-purple.svg)](https://modelcontextprotocol.io/)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](http://makeapullrequest.com)
[![Built with Claude Code](https://img.shields.io/badge/Built%20with-Claude%20Code-orange.svg)](https://claude.ai/code)

**Dispatch a mob. Collect the proof.**

ClawForce is a task orchestration engine that fans out physical-world operations to crowdsourced human agents at scale, then re-aggregates the results. Think Terraform, but instead of provisioning servers, you're provisioning *people*.

500 postcards to 500 doorsteps. 200 billboard photos for proof-of-play. 50 store openings verified with timestamps. One command.

```
clawforce campaign create \
  --name "Times Square Flash Mob" \
  --type verification \
  --provider mock \
  --targets locations.csv \
  --instructions "Show up. Dance. Film it."
```

---

## Install

```bash
# Clone it
git clone https://github.com/your-org/clawforce.git
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

Now your AI agent can dispatch human agents. Let that sink in.

---

## How it works

```
You define a campaign
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

ClawForce doesn't care who does the work. Every gig platform is just a provider implementing one interface.

| Provider | Task Types | Coverage | Cost/Task | Status |
|----------|-----------|----------|-----------|--------|
| **mock** | everything | everywhere | $1-5 | Ready (dev/test) |
| **doordash** | delivery, photo* | US (excl. CA, NYC, SEA, CO) | $7.75-15 | Ready (Drive API) |
| **taskrabbit** | photo, verification, errands, custom | US, UK, CA, FR, DE, ES | $20-80 | Stub |
| **uber-direct** | delivery | US, CA, MX, BR, AU, JP, GB, FR, DE | $5-12 | Stub |
| **field-nation** | verification, survey, photo, custom | US | $50-200 | Stub |

*\*DoorDash photo capture works by dispatching a delivery with specific `dropoff_instructions` and collecting the verification photo. Creative? Yes. Does it work? Also yes.*

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

Register it in `src/providers/registry.ts`. Done.

---

## CLI Reference

### List providers

```bash
# All providers
clawforce providers

# Only providers that support photo capture
clawforce providers --type photo_capture
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

### Estimate cost

```bash
clawforce estimate \
  --type delivery \
  --provider doordash \
  --targets addresses.csv \
  --template template.json
```

Samples up to 5 targets, gets real quotes from the provider, extrapolates to the full list. Know what you're spending before you spend it.

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
| `create_campaign` | Create + fan out a task campaign |
| `get_campaign_status` | Progress metrics, provider breakdown |
| `get_results` | Aggregated results: photos, costs, per-task details |
| `cancel_campaign` | Kill it |
| `list_campaigns` | List campaigns by status |
| `estimate_campaign` | Cost estimate before committing |

Your AI agent can now say *"take these 300 addresses, estimate the cost of delivering a postcard to each, and if it's under $3000, execute it"* — and ClawForce will do exactly that.

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
| `DOORDASH_DEVELOPER_ID` | — | DoorDash Drive API credentials |
| `DOORDASH_KEY_ID` | — | |
| `DOORDASH_SIGNING_SECRET` | — | |

---

## Architecture

```
src/
  providers/        # Provider interface + implementations
    interface.ts    # The contract: dispatch, getStatus, cancel, extractResult
    registry.ts     # Capability-based routing + auto-resolution
    mock.ts         # Dev/test (simulates full lifecycle)
    doordash.ts     # DoorDash Drive API
    taskrabbit.ts   # Stub (ready for API access)
    uber-direct.ts  # Stub
    field-nation.ts # Stub
  engine/           # Core orchestration
    fanout.ts       # Template × Targets → dispatched tasks (p-queue)
    poller.ts       # Status polling loop
    aggregator.ts   # Result collection + milestone webhooks
  mcp/              # MCP server
  cli/              # CLI commands
  api/              # REST API (planned)
  db/               # SQLite + Drizzle schema
  models/           # Campaign, Task, Result CRUD
```

Single process. SQLite. No Redis. No Kafka. No Kubernetes. Just a binary that dispatches humans.

---

## License

MIT

---

*Built with [Claude Code](https://claude.ai/code)*
