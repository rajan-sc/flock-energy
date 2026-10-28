import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { PortalClient } from '../client/portal-client.js';
import {
  PaginatedMetersResponseSchema,
  MeterDetailSchema,
  MeterConsumptionResponseSchema,
  ErrorResponseSchema,
} from '../types/api.types.js';
import {
  normalizeMeterSummary,
  normalizeConsumptionReading,
  normalizeExportItemToDetail,
} from '../normalizers/meter.normalizer.js';

export function createMeterRoutes(portalClient: PortalClient): FastifyPluginAsyncZod {
  return async function meterRoutes(fastify) {
    // 1. GET /v1/meters (Paginated search)
    fastify.get(
      '/v1/meters',
      {
        schema: {
          summary: 'List and search smart meters',
          description: 'Returns a paginated list of meters from the Urja Meter Ops system.',
          tags: ['Meters'],
          querystring: z.object({
            q: z.string().optional().describe('Filter by meter ID or serial number'),
            page: z.coerce.number().int().positive().default(1).describe('Page number (1-indexed)'),
          }),
          response: {
            200: PaginatedMetersResponseSchema,
            502: ErrorResponseSchema,
          },
        },
      },
      async (request, reply) => {
        const { q = '', page = 1 } = request.query;
        const raw = await portalClient.searchMeters(q, page);

        const data = raw.data.map(normalizeMeterSummary);
        const pageSize = raw.pageSize || 20;
        const totalPages = Math.max(1, Math.ceil(raw.total / pageSize));

        return reply.send({
          data,
          pagination: {
            total: raw.total,
            page: raw.page,
            pageSize,
            totalPages,
          },
        });
      }
    );

    // 2. GET /v1/meters/:id (Meter details, network position & coordinates)
    fastify.get(
      '/v1/meters/:id',
      {
        schema: {
          summary: 'Get meter details and network position',
          description: 'Retrieves complete nameplate details, GPS coordinates, and 7-tier network hierarchy.',
          tags: ['Meters'],
          params: z.object({
            id: z.string().describe('Unique meter ID (e.g. J100000)'),
          }),
          response: {
            200: MeterDetailSchema,
            404: ErrorResponseSchema,
            502: ErrorResponseSchema,
          },
        },
      },
      async (request, reply) => {
        const { id } = request.params;
        const bulk = await portalClient.getBulkExport(1);
        const item = bulk.data.find((m) => m.meterId.toLowerCase() === id.toLowerCase());

        if (!item) {
          return reply.status(404).send({
            error: {
              code: 'METER_NOT_FOUND',
              message: `Meter with ID "${id}" was not found in the distribution network.`,
            },
          });
        }

        const normalized = normalizeExportItemToDetail(item);
        return reply.send(normalized);
      }
    );

    // 3. GET /v1/meters/:id/consumption (Time-series energy readings)
    fastify.get(
      '/v1/meters/:id/consumption',
      {
        schema: {
          summary: 'Get recent meter energy consumption',
          description: 'Returns 30-minute interval readings including active energy (kWh), apparent energy (kVAh), and R-phase voltage.',
          tags: ['Meters'],
          params: z.object({
            id: z.string().describe('Unique meter ID (e.g. J100000)'),
          }),
          querystring: z.object({
            limit: z.coerce.number().int().positive().max(350).default(50).describe('Max number of readings to return (default: 50)'),
            since: z.string().optional().describe('Optional ISO date filter: only readings after this timestamp'),
            until: z.string().optional().describe('Optional ISO date filter: only readings before this timestamp'),
          }),
          response: {
            200: MeterConsumptionResponseSchema,
            404: ErrorResponseSchema,
            502: ErrorResponseSchema,
          },
        },
      },
      async (request, reply) => {
        const { id } = request.params;
        const { limit = 50, since, until } = request.query;

        let rawEnergy;
        try {
          rawEnergy = await portalClient.getMeterEnergy(id);
        } catch (err: any) {
          if (err.message?.includes('not found') || err.message?.includes('404')) {
            return reply.status(404).send({
              error: {
                code: 'METER_NOT_FOUND',
                message: `Meter with ID "${id}" does not exist or has no recorded energy data.`,
              },
            });
          }
          throw err;
        }

        let readings = rawEnergy.data.map(normalizeConsumptionReading);

        // Optional filtering by time range
        if (since) {
          const sinceDate = new Date(since).getTime();
          readings = readings.filter((r) => new Date(r.timestamp).getTime() >= sinceDate);
        }
        if (until) {
          const untilDate = new Date(until).getTime();
          readings = readings.filter((r) => new Date(r.timestamp).getTime() <= untilDate);
        }

        // Apply limit slicing (take latest readings)
        if (readings.length > limit) {
          readings = readings.slice(-limit);
        }

        return reply.send({
          meterId: id,
          unit: 'kWh',
          readingsCount: readings.length,
          readings,
        });
      }
    );
  };
}
