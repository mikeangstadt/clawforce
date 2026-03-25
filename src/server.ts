import express from 'express';
import { createMcpServer } from './mcp/server.js';
import { startPoller } from './engine/poller.js';
import { initDb } from './db/index.js';
import { config } from './config.js';
import { logger } from './util/logger.js';
import {
  handleListProviders,
  handleCreateCampaign,
  handleGetCampaignStatus,
  handleGetResults,
  handleCancelCampaign,
  handleListCampaigns,
  handleEstimateCampaign,
} from './mcp/tools.js';

initDb();

const app = express();
app.use(express.json());

// REST API routes that mirror MCP tools
app.get('/api/providers', async (req, res) => {
  const result = await handleListProviders({ task_type: req.query.task_type as string | undefined });
  res.json(JSON.parse(result.content[0].text));
});

app.post('/api/campaigns', async (req, res) => {
  const result = await handleCreateCampaign(req.body);
  res.json(JSON.parse(result.content[0].text));
});

app.get('/api/campaigns', async (req, res) => {
  const result = await handleListCampaigns({
    status: req.query.status as string | undefined,
    limit: parseInt(req.query.limit as string || '20'),
  });
  res.json(JSON.parse(result.content[0].text));
});

app.get('/api/campaigns/:id/status', async (req, res) => {
  const result = await handleGetCampaignStatus({ campaign_id: req.params.id });
  res.json(JSON.parse(result.content[0].text));
});

app.get('/api/campaigns/:id/results', async (req, res) => {
  const result = await handleGetResults({
    campaign_id: req.params.id,
    include_details: req.query.details === 'true',
  });
  res.json(JSON.parse(result.content[0].text));
});

app.post('/api/campaigns/:id/cancel', async (req, res) => {
  const result = await handleCancelCampaign({ campaign_id: req.params.id });
  res.json(JSON.parse(result.content[0].text));
});

app.post('/api/estimate', async (req, res) => {
  const result = await handleEstimateCampaign(req.body);
  res.json(JSON.parse(result.content[0].text));
});

// Health check
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', version: '0.1.0' });
});

// Start
startPoller();

app.listen(config.port, () => {
  logger.info({ port: config.port }, `ClawForce server running on port ${config.port}`);
  console.log(`ClawForce server running on http://localhost:${config.port}`);
  console.log(`REST API: http://localhost:${config.port}/api/`);
});
