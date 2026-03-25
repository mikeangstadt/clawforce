import dotenv from 'dotenv';

dotenv.config();

export interface Config {
  dbPath: string;
  port: number;
  pollIntervalMs: number;
  defaultConcurrency: number;
  logLevel: string;
  doordash: {
    developerId: string;
    keyId: string;
    signingSecret: string;
  };
  taskrabbit: {
    apiKey: string;
    apiSecret: string;
  };
  uberDirect: {
    clientId: string;
    clientSecret: string;
  };
  fieldNation: {
    apiKey: string;
  };
}

function env(key: string, fallback = ''): string {
  return process.env[key] || fallback;
}

function envInt(key: string, fallback: number): number {
  const val = process.env[key];
  return val ? parseInt(val, 10) : fallback;
}

export const config: Config = {
  dbPath: env('CLAWFORCE_DB_PATH', './clawforce.db'),
  port: envInt('CLAWFORCE_PORT', 3100),
  pollIntervalMs: envInt('CLAWFORCE_POLL_INTERVAL_MS', 30000),
  defaultConcurrency: envInt('CLAWFORCE_DEFAULT_CONCURRENCY', 5),
  logLevel: env('CLAWFORCE_LOG_LEVEL', 'info'),
  doordash: {
    developerId: env('DOORDASH_DEVELOPER_ID'),
    keyId: env('DOORDASH_KEY_ID'),
    signingSecret: env('DOORDASH_SIGNING_SECRET'),
  },
  taskrabbit: {
    apiKey: env('TASKRABBIT_API_KEY'),
    apiSecret: env('TASKRABBIT_API_SECRET'),
  },
  uberDirect: {
    clientId: env('UBER_DIRECT_CLIENT_ID'),
    clientSecret: env('UBER_DIRECT_CLIENT_SECRET'),
  },
  fieldNation: {
    apiKey: env('FIELD_NATION_API_KEY'),
  },
};
