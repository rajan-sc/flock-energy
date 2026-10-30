import Fastify from 'fastify';
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
  jsonSchemaTransform,
} from 'fastify-type-provider-zod';
import fastifySwagger from '@fastify/swagger';
import fastifySwaggerUi from '@fastify/swagger-ui';
import fs from 'node:fs';
import path from 'node:path';
import { config as defaultConfig, loadConfig, type Config } from './config.js';
import { PortalClient } from './client/portal-client.js';
import { createMeterRoutes } from './routes/meters.routes.js';
import { ErrorResponseSchema } from './types/api.types.js';
import { z } from 'zod';

export async function buildApp(client?: PortalClient, customConfig?: Config) {
  const appConfig = customConfig || loadConfig(process.env);
  const portalClient = client || new PortalClient({
    baseUrl: appConfig.PORTAL_BASE_URL,
    username: appConfig.PORTAL_USERNAME,
    password: appConfig.PORTAL_PASSWORD,
  });

  const app = Fastify({
    logger: appConfig.NODE_ENV !== 'test',
  }).withTypeProvider<ZodTypeProvider>();

  // Schema validator & serializer using Zod
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  // 1. Swagger & OpenAPI setup
  await app.register(fastifySwagger, {
    openapi: {
      info: {
        title: 'Urja Meter Ops API Service',
        description:
          'A resilient, typed REST API gateway and Anti-Corruption Layer over the legacy Urja Meter Ops utility portal. Exposes structured smart-meter inventory, 7-tier distribution network hierarchy, GPS coordinates, and 30-minute interval telemetry normalized to UTC ISO-8601.',
        version: '1.0.0',
      },
      servers: [
        {
          url: `http://localhost:${appConfig.PORT}`,
          description: 'Local development server',
        },
      ],
      tags: [
        { name: 'Meters', description: 'Smart meter discovery, details, and consumption' },
        { name: 'System', description: 'Service health and operational endpoints' },
      ],
    },
    transform: jsonSchemaTransform,
  });

  // 2. Swagger UI documentation viewer at /docs
  await app.register(fastifySwaggerUi, {
    routePrefix: '/docs',
    uiConfig: {
      docExpansion: 'list',
      deepLinking: false,
    },
  });

  // 3. Global Error Envelope Handler
  app.setErrorHandler((error: any, request, reply) => {
    // Schema validation errors from Zod
    if ('validation' in error && error.validation) {
      return reply.status(400).send({
        error: {
          code: 'VALIDATION_ERROR',
          message: error.message,
        },
      });
    }

    // Portal upstream errors (case-insensitive check across portal / gateway / fetch errors)
    if (/portal|upstream|gateway|fetch failed/i.test(error.message)) {
      return reply.status(502).send({
        error: {
          code: 'UPSTREAM_GATEWAY_ERROR',
          message: `Legacy portal communication failure: ${error.message}`,
        },
      });
    }

    const statusCode = error.statusCode || 500;
    return reply.status(statusCode).send({
      error: {
        code: statusCode === 404 ? 'NOT_FOUND' : 'INTERNAL_SERVER_ERROR',
        message: error.message || 'An unexpected error occurred',
      },
    });
  });

  // Standardize 404 handler to uniform error envelope
  app.setNotFoundHandler((request, reply) => {
    return reply.status(404).send({
      error: {
        code: 'NOT_FOUND',
        message: `Route ${request.method} ${request.url} not found`,
      },
    });
  });

  // 4. Health Check
  app.get(
    '/health',
    {
      schema: {
        summary: 'Service health check',
        tags: ['System'],
        response: {
          200: z.object({
            status: z.literal('ok'),
            timestamp: z.string(),
            portalBaseUrl: z.string(),
          }),
        },
      },
    },
    async () => {
      return {
        status: 'ok' as const,
        timestamp: new Date().toISOString(),
        portalBaseUrl: appConfig.PORTAL_BASE_URL,
      };
    }
  );

  // 5. Expose raw openapi.json
  app.get('/openapi.json', { schema: { hide: true } }, async () => {
    return app.swagger();
  });

  // 6. Register Core Meter Routes
  await app.register(createMeterRoutes(portalClient));

  return app;
}

// Start server when run directly
if (process.argv[1]?.endsWith('server.ts') || process.argv[1]?.endsWith('server.js')) {
  (async () => {
    try {
      const liveConfig = loadConfig(process.env);
      const server = await buildApp(undefined, liveConfig);
      await server.ready();

      await server.listen({ port: liveConfig.PORT, host: '0.0.0.0' });
      console.log(`🚀 Server listening at http://localhost:${liveConfig.PORT}`);
      console.log(`📖 Interactive API docs at http://localhost:${liveConfig.PORT}/docs`);
    } catch (err) {
      console.error(err);
      process.exit(1);
    }
  })();
}
