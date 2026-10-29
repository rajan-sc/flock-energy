import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { buildApp } from '../src/server.js';
import type { FastifyInstance } from 'fastify';
import type { PortalClient } from '../src/client/portal-client.js';

describe('Fastify REST API Integration Tests (100% Offline with Fixtures)', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    const fixturePath = (name: string) => path.resolve(process.cwd(), 'fixtures', name);
    const searchData = JSON.parse(fs.readFileSync(fixturePath('portal-meters-search.json'), 'utf8'));
    const bulkData = JSON.parse(fs.readFileSync(fixturePath('portal-export.json'), 'utf8'));
    const energyData = JSON.parse(fs.readFileSync(fixturePath('portal-meter-energy.json'), 'utf8'));

    // Purely offline mock client using real saved portal fixtures
    const mockClient = {
      searchMeters: async (q = '', page = 1) => searchData,
      getBulkExport: async (page = 1) => bulkData,
      getMeterEnergy: async (id: string) => energyData,
      getMeterGeo: async (id: string) => ({
        data: {
          meterId: id,
          latitude: '26.9124',
          longitude: '75.7873',
          address: 'Station Road, Jaipur',
        },
      }),
    } as unknown as PortalClient;

    app = await buildApp(mockClient, {
      PORT: 3000,
      PORTAL_BASE_URL: 'https://urja-ops.flockenergy.tech',
      PORTAL_USERNAME: 'test-offline-operator',
      PORTAL_PASSWORD: 'test-offline-password',
      NODE_ENV: 'test',
    });

    await app.ready();
  });

  it('GET /health returns 200 with status ok and portalBaseUrl', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.status).toBe('ok');
    expect(body).toHaveProperty('timestamp');
    expect(body).toHaveProperty('portalBaseUrl');
  });

  it('GET /v1/meters returns 200 with paginated meters list', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/meters?page=1' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.data.length).toBeGreaterThan(0);
    expect(body.pagination.page).toBe(1);
    expect(body.pagination.total).toBeGreaterThan(0);

    const first = body.data[0];
    expect(first).toHaveProperty('id');
    expect(first).toHaveProperty('serialNumber');
    expect(first).toHaveProperty('make');
    expect(first).toHaveProperty('status');
  });

  it('GET /v1/meters with invalid query returns 400 validation error envelope', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/meters?page=-5' });
    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body).toHaveProperty('error');
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });

  it('GET /v1/meters/:id returns 200 with details, GPS location and hierarchy', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/meters/J100000' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.id).toBe('J100000');
    expect(body.location).toHaveProperty('latitude');
    expect(body.location).toHaveProperty('longitude');
    expect(body.networkPosition).toBeDefined();
    expect(body.networkPosition.zone.name).toBe('Jaipur Zone 1');
  });

  it('GET /v1/meters/:id with non-existent id returns 404 error envelope', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/meters/DOES_NOT_EXIST' });
    expect(res.statusCode).toBe(404);
    const body = res.json();
    expect(body.error.code).toBe('METER_NOT_FOUND');
  });

  it('GET /v1/meters/:id/consumption returns 200 with ISO timestamps and numeric readings', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/meters/J100000/consumption?limit=10' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.meterId).toBe('J100000');
    expect(body.unit).toBe('kWh');
    expect(body.readingsCount).toBe(10);
    expect(body.readings.length).toBe(10);

    const reading = body.readings[0];
    expect(reading).toHaveProperty('timestamp');
    expect(reading.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    expect(typeof reading.activeEnergyKwh).toBe('number');
    expect(typeof reading.apparentEnergyKvah).toBe('number');
  });

  it('GET /v1/meters/:id/consumption rejects invalid or inverted time filters with 400', async () => {
    const resGarbage = await app.inject({
      method: 'GET',
      url: '/v1/meters/J100000/consumption?since=garbage',
    });
    expect(resGarbage.statusCode).toBe(400);
    expect(resGarbage.json().error.code).toBe('VALIDATION_ERROR');

    const resInverted = await app.inject({
      method: 'GET',
      url: '/v1/meters/J100000/consumption?since=2026-07-01T00:00:00Z&until=2026-06-01T00:00:00Z',
    });
    expect(resInverted.statusCode).toBe(400);
    expect(resInverted.json().error.code).toBe('VALIDATION_ERROR');
  });

  it('unhandled routes return uniform 404 error envelope', async () => {
    const res = await app.inject({ method: 'GET', url: '/does-not-exist' });
    expect(res.statusCode).toBe(404);
    const body = res.json();
    expect(body).toHaveProperty('error');
    expect(body.error.code).toBe('NOT_FOUND');
    expect(typeof body.error.message).toBe('string');
  });
});
