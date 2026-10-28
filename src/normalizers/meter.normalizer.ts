import type {
  MeterSummary,
  MeterDetail,
  ConsumptionReading,
  NetworkPositionSchema,
} from '../types/api.types.js';
import type {
  PortalMetersResponse,
  PortalEnergyReading,
  PortalExportItem,
  PortalGeoResponse,
} from '../client/portal-client.js';
import { z } from 'zod';

/**
 * Converts Indian Standard Time string ("DD/MM/YYYY HH:mm") to ISO-8601 UTC string.
 * Urja operations are based in Rajasthan (IST = UTC+05:30).
 */
export function parseIstToUtcIso(istString: string): string {
  const [datePart, timePart] = istString.trim().split(' ');
  if (!datePart || !timePart) return new Date().toISOString();

  const [day, month, year] = datePart.split('/').map(Number);
  const [hour, minute] = timePart.split(':').map(Number);

  // Offset by -5 hours and -30 minutes to convert IST to UTC
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
    activeEnergyKwh: Number.parseFloat(raw.kwh) || 0,
    apparentEnergyKvah: Number.parseFloat(raw.kvah) || 0,
    voltageRPhaseVolts: raw.voltR ? Number.parseFloat(raw.voltR) : null,
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
