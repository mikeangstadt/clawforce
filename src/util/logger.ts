import pino from 'pino';
import { config } from '../config.js';

export const logger = pino({
  level: config.logLevel,
  transport: {
    target: 'pino/file',
    options: { destination: 2 }, // stderr so stdout stays clean for MCP
  },
});
