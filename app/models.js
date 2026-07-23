const { z } = require('zod');

const LocationSchema = z.object({
  address: z.string().nullable().default(null),
  latitude: z.number().nullable().default(null),
  longitude: z.number().nullable().default(null)
});

const MeterSchema = z.object({
  meterId: z.string().min(1),
  serialNumber: z.string().nullable().default(null),
  name: z.string().nullable().default(null),
  status: z.string().nullable().default(null),
  installedAt: z.string().nullable().default(null),
  location: LocationSchema.nullable().default(null)
});

const ConsumptionRecordSchema = z.object({
  meterId: z.string().min(1),
  period: z.string().min(1),
  unitsConsumed: z.number().finite()
});

const HierarchyNodeSchema = z.object({
  id: z.string().min(1),
  type: z.string().min(1),
  name: z.string().nullable().default(null),
  children: z.array(z.lazy(() => HierarchyNodeSchema)).default([])
});

const ListQuerySchema = z.object({
  page: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().max(1000).optional(),
  status: z.string().trim().min(1).optional(),
  search: z.string().trim().min(1).optional()
}).passthrough();

const ConsumptionQuerySchema = z.object({
  page: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().max(1000).optional(),
  from: z.string().trim().min(1).optional(),
  to: z.string().trim().min(1).optional()
}).passthrough();

module.exports = {
  ConsumptionRecordSchema,
  ConsumptionQuerySchema,
  HierarchyNodeSchema,
  ListQuerySchema,
  MeterSchema
};
