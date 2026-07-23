const express = require('express');
const morgan = require('morgan');
const pino = require('pino');
const swaggerUi = require('swagger-ui-express');
const { loadConfig } = require('./config');
const {
  PortalAuthenticationError,
  PortalClient,
  PortalNotFoundError,
  PortalParseError,
  PortalUnreachableError
} = require('./client');
const { ConsumptionQuerySchema, ListQuerySchema } = require('./models');
const openapi = require('../openapi.json');

function createApp(options = {}) {
  const config = options.config || loadConfig();
  const logger = options.logger || pino({ level: config.logLevel });
  const client = options.client || new PortalClient(config);
  const app = express();

  app.disable('x-powered-by');
  app.use(express.json());
  app.use(morgan('combined', { stream: { write: (message) => logger.info(message.trim()) } }));
  app.use('/docs', swaggerUi.serve, swaggerUi.setup(openapi, { explorer: true }));

  // Liveness check for this service; specification section 7, recommended endpoint.
  app.get('/health', (req, res) => res.status(200).json({ status: 'ok', service: 'flock-energy-api' }));

  // Lists smart meters from the portal; specification section 7, required GET /api/v1/meters.
  app.get('/api/v1/meters', async (req, res, next) => {
    try {
      const query = ListQuerySchema.parse(req.query);
      const meters = await client.getMeterList(query);
      res.json({ data: meters, meta: { count: meters.length } });
    } catch (error) {
      next(error);
    }
  });

  // Returns one meter's detail; specification section 7, required GET /api/v1/meters/:id.
  app.get('/api/v1/meters/:id', async (req, res, next) => {
    try {
      const meter = await client.getMeterDetail(req.params.id);
      res.json({ data: meter });
    } catch (error) {
      next(error);
    }
  });

  // Returns consumption history for a meter; specification section 7, required GET /api/v1/meters/:id/consumption.
  app.get('/api/v1/meters/:id/consumption', async (req, res, next) => {
    try {
      const query = ConsumptionQuerySchema.parse(req.query);
      const records = await client.getConsumption(req.params.id, query);
      res.json({ data: records, meta: { count: records.length, meterId: req.params.id } });
    } catch (error) {
      next(error);
    }
  });

  // Returns the portal's network hierarchy; specification section 7, optional GET /api/v1/hierarchy.
  app.get('/api/v1/hierarchy', async (req, res, next) => {
    try {
      res.json({ data: await client.getHierarchy() });
    } catch (error) {
      next(error);
    }
  });

  // Triggers an internal portal login; specification section 4.3 and section 7, optional POST /api/v1/auth/login.
  app.post('/api/v1/auth/login', async (req, res, next) => {
    try {
      res.json({ data: await client.login() });
    } catch (error) {
      next(error);
    }
  });

  app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    if (error.name === 'ZodError') {
      return res.status(400).json({ error: 'validation_error', message: 'The request parameters are invalid.', detail: error.issues });
    }
    if (error instanceof PortalNotFoundError || error.status === 404) {
      return res.status(404).json({ error: error.code || 'not_found', message: error.message });
    }
    if (error instanceof PortalAuthenticationError) {
      return res.status(503).json({ error: error.code, message: error.message });
    }
    if (error instanceof PortalParseError) {
      return res.status(502).json({ error: error.code, message: error.message });
    }
    if (error instanceof PortalUnreachableError) {
      return res.status(502).json({ error: error.code, message: error.message });
    }
    logger.error({ err: error }, 'Unhandled application error');
    return res.status(500).json({ error: 'internal_error', message: 'The server could not complete the request.' });
  });

  return app;
}

if (require.main === module) {
  const config = loadConfig();
  createApp({ config }).listen(config.port, () => {
    console.log(`flock-energy-api listening on port ${config.port}`);
  });
}

module.exports = { createApp };
