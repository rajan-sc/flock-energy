import { z } from 'zod';

export const ErrorResponseSchema = z.object({
  error: z.object({
    code: z.string().describe('Machine-readable error code'),
    message: z.string().describe('Human-readable error description'),
  }),
});

export const HierarchyNodeSchema = z.object({
  name: z.string(),
  code: z.string(),
});

export const NetworkPositionSchema = z.object({
  zone: HierarchyNodeSchema.nullable(),
  circle: HierarchyNodeSchema.nullable(),
  division: HierarchyNodeSchema.nullable(),
  subdivision: HierarchyNodeSchema.nullable(),
  substation: HierarchyNodeSchema.nullable(),
  feeder: HierarchyNodeSchema.nullable(),
  dt: HierarchyNodeSchema.nullable(),
});

export const GeoLocationSchema = z.object({
  latitude: z.number().describe('Latitude in decimal degrees'),
  longitude: z.number().describe('Longitude in decimal degrees'),
});

export const MeterSummarySchema = z.object({
  id: z.string().describe('Unique meter identifier'),
  serialNumber: z.string().describe('Physical meter serial number'),
  make: z.string().describe('Manufacturer make'),
  phaseType: z.string().describe('Single or three phase'),
  status: z.string().describe('Installation status'),
  dtCode: z.string().describe('Associated Distribution Transformer code'),
});

export const PaginatedMetersResponseSchema = z.object({
  data: z.array(MeterSummarySchema),
  pagination: z.object({
    total: z.number(),
    page: z.number(),
    pageSize: z.number(),
    totalPages: z.number(),
  }),
});

export const MeterDetailSchema = MeterSummarySchema.extend({
  installationType: z.string().nullable().describe('Installation type specification'),
  location: GeoLocationSchema.nullable().describe('GPS coordinates'),
  networkPosition: NetworkPositionSchema.nullable().describe('Upstream distribution network hierarchy'),
});

export const ConsumptionReadingSchema = z.object({
  timestamp: z.string().describe('ISO-8601 UTC timestamp'),
  activeEnergyKwh: z.number().nullable().describe('Cumulative active energy in kilowatt-hours (kWh)'),
  apparentEnergyKvah: z.number().nullable().describe('Cumulative apparent energy in kilovolt-ampere-hours (kVAh)'),
  voltageRPhaseVolts: z.number().nullable().describe('R-Phase voltage in Volts (V)'),
});

export const MeterConsumptionResponseSchema = z.object({
  meterId: z.string(),
  unit: z.literal('kWh'),
  readingsCount: z.number(),
  readings: z.array(ConsumptionReadingSchema),
});

export type MeterSummary = z.infer<typeof MeterSummarySchema>;
export type PaginatedMetersResponse = z.infer<typeof PaginatedMetersResponseSchema>;
export type MeterDetail = z.infer<typeof MeterDetailSchema>;
export type ConsumptionReading = z.infer<typeof ConsumptionReadingSchema>;
export type MeterConsumptionResponse = z.infer<typeof MeterConsumptionResponseSchema>;
export type ErrorResponse = z.infer<typeof ErrorResponseSchema>;
