import fs from 'node:fs';
import path from 'node:path';
import { buildApp } from '../src/server.js';

async function generate() {
  const app = await buildApp(undefined, {
    PORT: 3000,
    PORTAL_BASE_URL: 'https://urja-ops.flockenergy.tech',
    PORTAL_USERNAME: 'spec-generator',
    PORTAL_PASSWORD: 'spec-password',
    NODE_ENV: 'test',
  });

  await app.ready();
  const spec = app.swagger();
  const outputPath = path.resolve(process.cwd(), 'openapi.json');
  fs.writeFileSync(outputPath, JSON.stringify(spec, null, 2), 'utf8');
  console.log(`✅ openapi.json generated at ${outputPath}`);
  await app.close();
}

generate().catch((err) => {
  console.error('Failed to generate openapi.json:', err);
  process.exit(1);
});
