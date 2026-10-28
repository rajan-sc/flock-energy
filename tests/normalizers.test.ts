import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  parseIstToUtcIso,
  normalizeMeterSummary,
  normalizeConsumptionReading,
  normalizeExportItemToDetail,
} from '../src/normalizers/meter.normalizer.js';
import {
  MeterSummarySchema,
  MeterDetailSchema,
  ConsumptionReadingSchema,
} from '../src/types/api.types.js';

describe('Normalizer Unit Tests (with real fixtures)', () => {
  it('converts Indian local timestamp format to ISO-8601 UTC string', () => {
    // 23/06/2026 23:30 in IST (UTC+5:30) is 2026-06-23T18:00:00.000Z
    const iso = parseIstToUtcIso('23/06/2026 23:30');
    expect(iso).toBe('2026-06-23T18:00:00.000Z');
  });

  it('normalizes a raw meter search item and conforms to MeterSummarySchema', () => {
    const rawFixture = JSON.parse(
      fs.readFileSync(path.resolve(__dirname, '../fixtures/portal-meters-search.json'), 'utf8')
    );
    const rawItem = rawFixture.data[0];
    const normalized = normalizeMeterSummary(rawItem);

    expect(normalized).toEqual({
      id: 'J100000',
      serialNumber: 'SE33962',
      make: 'HPL',
      phaseType: 'single',
      status: 'Decommissioned',
      dtCode: 'DT-001',
    });

    const parsed = MeterSummarySchema.safeParse(normalized);
    expect(parsed.success).toBe(true);
  });

  it('normalizes raw consumption energy readings and casts numeric strings to numbers', () => {
    const rawFixture = JSON.parse(
      fs.readFileSync(path.resolve(__dirname, '../fixtures/portal-meter-energy.json'), 'utf8')
    );
    const rawReading = rawFixture.data[0];
    const normalized = normalizeConsumptionReading(rawReading);

    expect(normalized.timestamp).toBe('2026-06-23T18:00:00.000Z');
    expect(normalized.activeEnergyKwh).toBe(48438.74);
    expect(normalized.apparentEnergyKvah).toBe(52313.84);
    expect(normalized.voltageRPhaseVolts).toBe(226);

    const parsed = ConsumptionReadingSchema.safeParse(normalized);
    expect(parsed.success).toBe(true);
  });

  it('normalizes raw export item with complete hierarchy and geo coordinates', () => {
    const rawFixture = JSON.parse(
      fs.readFileSync(path.resolve(__dirname, '../fixtures/portal-export.json'), 'utf8')
    );
    const rawItem = rawFixture.data[0];
    const normalized = normalizeExportItemToDetail(rawItem);

    expect(normalized.id).toBe('J100000');
    expect(normalized.serialNumber).toBe('SE33962');
    expect(normalized.location).toEqual({
      latitude: 26.938961002479868,
      longitude: 75.83095696146852,
    });
    expect(normalized.networkPosition?.zone).toEqual({ name: 'Jaipur Zone 1', code: 'Z-01' });
    expect(normalized.networkPosition?.dt).toEqual({ name: 'Malviya Nagar DT 1', code: 'DT-001' });

    const parsed = MeterDetailSchema.safeParse(normalized);
    expect(parsed.success).toBe(true);
  });
});
