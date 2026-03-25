import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  toolDefinitions,
  handleListProviders,
  handleCreateCampaign,
  handleGetCampaignStatus,
  handleGetResults,
  handleCancelCampaign,
  handleListCampaigns,
  handleEstimateCampaign,
  handleCompareEstimates,
} from './tools.js';
import { startPoller } from '../engine/poller.js';
import { logger } from '../util/logger.js';

export function createMcpServer(): McpServer {
  const server = new McpServer({
    name: 'clawforce',
    version: '0.1.0',
  });

  // Register tools
  server.tool(
    'list_providers',
    toolDefinitions.list_providers.description,
    toolDefinitions.list_providers.inputSchema,
    async (args) => handleListProviders(args),
  );

  server.tool(
    'create_campaign',
    toolDefinitions.create_campaign.description,
    toolDefinitions.create_campaign.inputSchema,
    async (args) => handleCreateCampaign(args as any),
  );

  server.tool(
    'get_campaign_status',
    toolDefinitions.get_campaign_status.description,
    toolDefinitions.get_campaign_status.inputSchema,
    async (args) => handleGetCampaignStatus(args),
  );

  server.tool(
    'get_results',
    toolDefinitions.get_results.description,
    toolDefinitions.get_results.inputSchema,
    async (args) => handleGetResults(args),
  );

  server.tool(
    'cancel_campaign',
    toolDefinitions.cancel_campaign.description,
    toolDefinitions.cancel_campaign.inputSchema,
    async (args) => handleCancelCampaign(args),
  );

  server.tool(
    'list_campaigns',
    toolDefinitions.list_campaigns.description,
    toolDefinitions.list_campaigns.inputSchema,
    async (args) => handleListCampaigns(args),
  );

  server.tool(
    'estimate_campaign',
    toolDefinitions.estimate_campaign.description,
    toolDefinitions.estimate_campaign.inputSchema,
    async (args) => handleEstimateCampaign(args as any),
  );

  server.tool(
    'compare_estimates',
    toolDefinitions.compare_estimates.description,
    toolDefinitions.compare_estimates.inputSchema,
    async (args) => handleCompareEstimates(args as any),
  );

  return server;
}

// Run as standalone MCP server via stdio
async function main() {
  const server = createMcpServer();
  const transport = new StdioServerTransport();

  // Start the poller for tracking active tasks
  startPoller();

  await server.connect(transport);
  logger.info('ClawForce MCP server running on stdio');
}

// Only run if this is the entry point
const isMainModule = process.argv[1]?.endsWith('mcp/server.ts') ||
  process.argv[1]?.endsWith('mcp/server.js');

if (isMainModule) {
  main().catch((err) => {
    logger.error({ error: err.message }, 'MCP server failed to start');
    process.exit(1);
  });
}
