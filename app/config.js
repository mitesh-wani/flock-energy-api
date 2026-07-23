const path = require('node:path');

require('dotenv').config({ path: path.resolve(process.cwd(), '.env') });

function integerFromEnv(name, fallback) {
  const value = Number.parseInt(process.env[name] || '', 10);
  return Number.isFinite(value) ? value : fallback;
}

function loadConfig() {
  return {
    port: integerFromEnv('PORT', 3000),
    portal: {
      baseUrl: process.env.URJA_BASE_URL || 'https://urja-ops.flockenergy.tech',
      username: process.env.URJA_USERNAME || '',
      password: process.env.URJA_PASSWORD || '',
      timeoutMs: integerFromEnv('URJA_TIMEOUT_MS', 10000),
      retryCount: integerFromEnv('URJA_RETRY_COUNT', 1),
      paths: {
        login: process.env.URJA_LOGIN_PATH || '/login',
        meterList: process.env.URJA_METER_LIST_PATH || '/meters',
        meterDetail: process.env.URJA_METER_DETAIL_PATH || '/meters/:id',
        consumption: process.env.URJA_CONSUMPTION_PATH || '/meters/:id/consumption',
        hierarchy: process.env.URJA_HIERARCHY_PATH || '/hierarchy'
      },
      usernameField: process.env.URJA_USERNAME_FIELD || 'username',
      passwordField: process.env.URJA_PASSWORD_FIELD || 'password'
    },
    logLevel: process.env.LOG_LEVEL || 'info'
  };
}

module.exports = { loadConfig };
