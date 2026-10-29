import type {
  MeterSummary,
  MeterDetail,
  ConsumptionReading,
} from '../types/api.types.js';
import type {
  PortalMetersResponse,
  PortalEnergyReading,
  PortalExportItem,
} from '../client/portal-client.js';

/**
 * Strictly parses a numeric value.
 * Preserves legitimate numbers (including 0), but rejects non-numeric or malformed
 * inputs (e.g. "bad", "12junk", NaN, Infinity) returning null to prevent silent data corruption.
 */
export function parseStrictNumber(val: unknown): number | null {
  if (val === null || val === undefined) return null;
  const s = String(val).trim();
  if (s === '') return null;
  // Strictly allow valid integers or decimals with optional negative sign
  if (!/^-?\d+(\.\d+)?$/.test(s)) return null;
  const num = Number(s);
  return Number.isFinite(num) ? num : null;
}

/**
 * Converts Indian Standard Time string ("DD/MM/YYYY HH:mm") to ISO-8601 UTC string.
 * Strictly validates calendar dates (including leap years) and clock ranges.
 * Rejects invalid/malformed dates rather than fabricating timestamps or rolling over.
 */
export function parseIstToUtcIso(istString: string): string {
  if (!istString || typeof istString !== 'string') {
    throw new Error('Invalid timestamp: input must be a non-empty string');
  }

  const trimmed = istString.trim();
  const match = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})$/);
  if (!match) {
    throw new Error(`Malformed IST timestamp format: expected "DD/MM/YYYY HH:mm", got "${istString}"`);
  }

  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);

  if (month < 1 || month > 12 || hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    throw new Error(`Invalid date/time range in timestamp: "${istString}"`);
  }

  // Gregorian calendar day-of-month validation (including leap year)
  const isLeap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  const daysInMonths = [31, isLeap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (day < 1 || day > daysInMonths[month - 1]) {
    throw new Error(`Invalid calendar day ${day} for month ${month} in year ${year} ("${istString}")`);
  }

  // Convert IST (UTC+05:30) to UTC
  const utcMillis = Date.UTC(year, month - 1, day, hour - 5, minute - 30);
  return new Date(utcMillis).toISOString();
}

export function normalizeMeterSummary(raw: PortalMetersResponse['data'][number]): MeterSummary {
  return {
    id: raw.meterId,
    serialNumber: raw.serialNo,
    make: raw.make,
    phaseType: raw.phaseType,
    status: raw.installStatus,
    dtCode: raw.dtCode,
  };
}

export function normalizeConsumptionReading(raw: PortalEnergyReading): ConsumptionReading {
  return {
    timestamp: parseIstToUtcIso(raw.timestamp),
    activeEnergyKwh: parseStrictNumber(raw.kwh),
    apparentEnergyKvah: parseStrictNumber(raw.kvah),
    voltageRPhaseVolts: parseStrictNumber(raw.voltR),
  };
}

export function normalizeExportItemToDetail(item: PortalExportItem): MeterDetail {
  return {
    id: item.meterId,
    serialNumber: item.serialNo,
    make: item.make,
    phaseType: item.phaseType,
    status: item.installStatus,
    dtCode: item.dtCode || '',
    installationType: item.installType || null,
    location: item.geo ? { latitude: item.geo.lat, longitude: item.geo.lng } : null,
    networkPosition: item.hierarchy
      ? {
          zone: item.hierarchy.zone || null,
          circle: item.hierarchy.circle || null,
          division: item.hierarchy.division || null,
          subdivision: item.hierarchy.subdivision || null,
          substation: item.hierarchy.substation || null,
          feeder: item.hierarchy.feeder || null,
          dt: item.hierarchy.dt || null,
        }
      : null,
  };
}
