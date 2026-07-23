const request = require('supertest');
const { createApp } = require('../app/app');
const {
  PortalAuthenticationError,
  PortalNotFoundError,
  PortalParseError,
  PortalUnreachableError
} = require('../app/client');

const meters = [{
  meterId: 'MTR-001',
  serialNumber: 'SN-001',
  name: 'Main meter',
  status: 'active',
  installedAt: '2026-01-01T00:00:00.000Z',
  location: null
}];
const records = [{ meterId: 'MTR-001', period: '2026-01', unitsConsumed: 124.5 }];
const hierarchy = [{ id: 'substation-1', type: 'substation', name: 'North', children: [] }];

function makeClient() {
  return {
    getMeterList: jest.fn().mockResolvedValue(meters),
    getMeterDetail: jest.fn().mockResolvedValue(meters[0]),
    getConsumption: jest.fn().mockResolvedValue(records),
    getHierarchy: jest.fn().mockResolvedValue(hierarchy),
    login: jest.fn().mockResolvedValue({ authenticated: true })
  };
}

describe('API endpoints', () => {
  let client;
  let app;

  beforeEach(() => {
    client = makeClient();
    app = createApp({ client, config: { logLevel: 'silent' } });
  });

  test('GET /health returns service liveness', async () => {
    const response = await request(app).get('/health');
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'ok', service: 'flock-energy-api' });
  });

  test('GET /api/v1/meters returns the meter list and forwards query parameters', async () => {
    const response = await request(app).get('/api/v1/meters?page=2&limit=10&status=active');
    expect(response.status).toBe(200);
    expect(response.body.data).toEqual(meters);
    expect(response.body.meta).toEqual({ count: 1 });
    expect(client.getMeterList).toHaveBeenCalledWith({ page: 2, limit: 10, status: 'active' });
  });

  test('GET /api/v1/meters/:id returns meter detail', async () => {
    const response = await request(app).get('/api/v1/meters/MTR-001');
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ data: meters[0] });
    expect(client.getMeterDetail).toHaveBeenCalledWith('MTR-001');
  });

  test('GET /api/v1/meters/:id/consumption returns consumption history', async () => {
    const response = await request(app).get('/api/v1/meters/MTR-001/consumption?from=2026-01&to=2026-03');
    expect(response.status).toBe(200);
    expect(response.body.data).toEqual(records);
    expect(response.body.meta).toEqual({ count: 1, meterId: 'MTR-001' });
    expect(client.getConsumption).toHaveBeenCalledWith('MTR-001', { from: '2026-01', to: '2026-03' });
  });

  test('GET /api/v1/hierarchy returns the hierarchy tree', async () => {
    const response = await request(app).get('/api/v1/hierarchy');
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ data: hierarchy });
    expect(client.getHierarchy).toHaveBeenCalledTimes(1);
  });

  test('POST /api/v1/auth/login triggers internal portal login', async () => {
    const response = await request(app).post('/api/v1/auth/login').send({});
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ data: { authenticated: true } });
    expect(client.login).toHaveBeenCalledTimes(1);
  });

  test('maps portal network failures to 502 without exposing upstream HTML', async () => {
    client.getMeterList.mockRejectedValue(new PortalUnreachableError('The portal request failed.'));
    const response = await request(app).get('/api/v1/meters');
    expect(response.status).toBe(502);
    expect(response.body).toEqual({ error: 'portal_unreachable', message: 'The portal request failed.' });
  });

  test('maps failed portal authentication to 503', async () => {
    client.login.mockRejectedValue(new PortalAuthenticationError('The portal rejected the configured credentials.'));
    const response = await request(app).post('/api/v1/auth/login');
    expect(response.status).toBe(503);
    expect(response.body.error).toBe('portal_authentication_failed');
  });

  test('maps a missing meter to 404', async () => {
    client.getMeterDetail.mockRejectedValue(new PortalNotFoundError('Meter MTR-404 was not found.'));
    const response = await request(app).get('/api/v1/meters/MTR-404');
    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: 'meter_not_found', message: 'Meter MTR-404 was not found.' });
  });

  test('rejects invalid pagination before calling the portal client', async () => {
    const response = await request(app).get('/api/v1/meters?limit=0');
    expect(response.status).toBe(400);
    expect(response.body.error).toBe('validation_error');
    expect(client.getMeterList).not.toHaveBeenCalled();
  });
  // Scenario: the portal is healthy but currently has no meters to return.
  test('GET /api/v1/meters returns an empty list when no meters exist', async () => {
    client.getMeterList.mockResolvedValue([]);

    const response = await request(app).get('/api/v1/meters?search=inactive-site');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ data: [], meta: { count: 0 } });
    expect(client.getMeterList).toHaveBeenCalledWith({ search: 'inactive-site' });
  });

  // Scenario: a caller requests a meter whose identifier contains URL-reserved characters.
  test('GET /api/v1/meters/:id decodes an encoded meter identifier', async () => {
    const encodedId = encodeURIComponent('MTR/001');
    client.getMeterDetail.mockResolvedValue({ ...meters[0], meterId: 'MTR/001' });

    const response = await request(app).get(`/api/v1/meters/${encodedId}`);

    expect(response.status).toBe(200);
    expect(response.body.data.meterId).toBe('MTR/001');
    expect(client.getMeterDetail).toHaveBeenCalledWith('MTR/001');
  });

  // Scenario: a valid meter has no consumption records in the requested date range.
  test('GET /api/v1/meters/:id/consumption returns an empty history', async () => {
    client.getConsumption.mockResolvedValue([]);

    const response = await request(app).get('/api/v1/meters/MTR-001/consumption?from=2026-04&to=2026-04');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ data: [], meta: { count: 0, meterId: 'MTR-001' } });
    expect(client.getConsumption).toHaveBeenCalledWith('MTR-001', { from: '2026-04', to: '2026-04' });
  });

  // Scenario: the portal layout changes and the adapter cannot parse the hierarchy page.
  test('maps an unparseable hierarchy page to 502', async () => {
    client.getHierarchy.mockRejectedValue(new PortalParseError('Hierarchy markup was not recognized.'));

    const response = await request(app).get('/api/v1/hierarchy');

    expect(response.status).toBe(502);
    expect(response.body).toEqual({
      error: 'portal_parse_error',
      message: 'Hierarchy markup was not recognized.'
    });
  });

  // Scenario: invalid consumption pagination is rejected before any upstream request.
  test('rejects a consumption limit above the documented maximum', async () => {
    const response = await request(app).get('/api/v1/meters/MTR-001/consumption?limit=1001');

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('validation_error');
    expect(client.getConsumption).not.toHaveBeenCalled();
  });

  // Scenario: an unexpected programming error is converted into a safe generic response.
  test('maps unexpected route errors to 500 without exposing implementation details', async () => {
    client.getMeterDetail.mockRejectedValue(new Error('database password leaked here'));

    const response = await request(app).get('/api/v1/meters/MTR-001');

    expect(response.status).toBe(500);
    expect(response.body).toEqual({
      error: 'internal_error',
      message: 'The server could not complete the request.'
    });
    expect(JSON.stringify(response.body)).not.toContain('database password');
  });

});



