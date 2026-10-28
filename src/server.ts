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
import { config } from './config.js';
import { PortalClient } from './client/portal-client.js';
import { createMeterRoutes } from './routes/meters.routes.js';
import { ErrorResponseSchema } from './types/api.types.js';
import { z } from 'zod';

export async function buildApp(client?: PortalClient) {
  const portalClient = client || new PortalClient({
    baseUrl: config.PORTAL_BASE_URL,
    username: config.PORTAL_USERNAME,
    password: config.PORTAL_PASSWORD,
  });

  const app = Fastify({
    logger: config.NODE_ENV !== 'test',
  }).withTypeProvider<ZodTypeProvider>();

  // Schema validator & serializer using Zod
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  // 1. Swagger & OpenAPI setup
  await app.register(fastifySwagger, {
    openapi: {
      info: {
        title: 'Urja Meter Ops API Service',
        description: 'Clean, production-ready REST API service over the legacy Urja Meter Ops utility portal.',
        version: '1.0.0',
      },
      servers: [
        {
          url: `http://localhost:${config.PORT}`,
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

    // Portal upstream errors
    if (error.message?.includes('Portal') || error.message?.includes('upstream') || error.message?.includes('fetch failed')) {
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
        portalBaseUrl: config.PORTAL_BASE_URL,
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
    const server = await buildApp();
    try {
      await server.ready();

      // Export openapi.json to repository root
      const openApiSpec = server.swagger();
      fs.writeFileSync(
        path.resolve(process.cwd(), 'openapi.json'),
        JSON.stringify(openApiSpec, null, 2),
        'utf8'
      );
      server.log.info('Generated openapi.json in repository root');

      await server.listen({ port: config.PORT, host: '0.0.0.0' });
      console.log(`🚀 Server listening at http://localhost:${config.PORT}`);
      console.log(`📖 Interactive API docs at http://localhost:${config.PORT}/docs`);
    } catch (err) {
      server.log.error(err);
      process.exit(1);
    }
  })();
}
