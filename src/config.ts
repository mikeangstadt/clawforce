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
    auth0Domain: string;
    clientId: string;
    clientSecret: string;
    audience: string;
    clientEntityId: string; // Your sub-entity ID for Dolly
    storeId: string;        // Your default store/origin reference
    baseUrl: string;        // Sandbox or production
  };
  uberDirect: {
    customerId: string;
    clientId: string;
    clientSecret: string;
  };
  fieldNation: {
    clientId: string;
    clientSecret: string;
    username: string;
    password: string;
    baseUrl: string; // Sandbox or production
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
    auth0Domain: env('TASKRABBIT_AUTH0_DOMAIN'),
    clientId: env('TASKRABBIT_CLIENT_ID'),
    clientSecret: env('TASKRABBIT_CLIENT_SECRET'),
    audience: env('TASKRABBIT_AUDIENCE'),
    clientEntityId: env('TASKRABBIT_CLIENT_ENTITY_ID', 'clawforce'),
    storeId: env('TASKRABBIT_STORE_ID', 'clawforce-default'),
    baseUrl: env('TASKRABBIT_BASE_URL', 'https://papi.sandbox.dolly.com'),
  },
  uberDirect: {
    customerId: env('UBER_DIRECT_CUSTOMER_ID'),
    clientId: env('UBER_DIRECT_CLIENT_ID'),
    clientSecret: env('UBER_DIRECT_CLIENT_SECRET'),
  },
  fieldNation: {
    clientId: env('FIELD_NATION_CLIENT_ID'),
    clientSecret: env('FIELD_NATION_CLIENT_SECRET'),
    username: env('FIELD_NATION_USERNAME'),
    password: env('FIELD_NATION_PASSWORD'),
    baseUrl: env('FIELD_NATION_BASE_URL', 'https://api-sandbox.fndev.net'),
  },
};
