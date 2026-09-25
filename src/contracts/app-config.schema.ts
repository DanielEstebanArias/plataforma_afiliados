import { z } from 'zod';
export const Id = z.string().uuid();
export const Name = z.string().regex(/^[a-z][a-z0-9_]{0,47}$/);
export const HttpsUrl = z
  .string()
  .url()
  .refine((v) => new URL(v).protocol === 'https:', 'HTTPS required');
export const Provider = z.enum(['stripe', 'wompi', 'mercadopago', 'payu', 'paypal']);
export const FieldSchema = z
  .object({
    name: Name,
    type: z.enum([
      'text',
      'number',
      'boolean',
      'date',
      'email',
      'file',
      'signature',
      'location',
      'json',
    ]),
    required: z.boolean().default(false),
    min: z.number().optional(),
    max: z.number().optional(),
    options: z.array(z.string().max(200)).max(100).optional(),
  })
  .strict()
  .refine((v) => v.min === undefined || v.max === undefined || v.min <= v.max, 'Invalid range');
export const TableSchema = z
  .object({ name: Name, fields: z.array(FieldSchema).min(1).max(100) })
  .strict()
  .refine((v) => new Set(v.fields.map((f) => f.name)).size === v.fields.length, 'Duplicate fields');
export const HardwareSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('camera'),
      mode: z.enum(['photo', 'video']),
      quality: z.literal('hd'),
      exif: z.boolean(),
      gps: z.boolean(),
      timestamp: z.literal(true),
    })
    .strict(),
  z
    .object({
      kind: z.literal('signature'),
      formats: z.array(z.enum(['png', 'svg'])).min(1),
      hash: z.literal('sha256'),
    })
    .strict(),
  z
    .object({
      kind: z.literal('audio'),
      codec: z.literal('aac'),
      container: z.literal('m4a'),
      waveform: z.boolean(),
      maxSeconds: z.number().int().min(1).max(600),
    })
    .strict(),
  z
    .object({
      kind: z.literal('gis'),
      background: z.boolean(),
      intervalSeconds: z.number().int().min(5).max(3600),
      transport: z.enum(['websocket', 'mqtt']),
      endpoint: z
        .string()
        .url()
        .refine((v) => new URL(v).protocol === 'mqtts:', 'MQTT TLS required')
        .optional(),
      geofences: z
        .array(
          z
            .object({
              id: Name,
              latitude: z.number().min(-90).max(90),
              longitude: z.number().min(-180).max(180),
              radiusMeters: z.number().min(10).max(100000),
            })
            .strict(),
        )
        .max(100),
    })
    .strict(),
  z
    .object({
      kind: z.literal('scanner'),
      formats: z.array(z.enum(['qr', 'ean13', 'code128', 'pdf417'])).min(1),
    })
    .strict(),
  z
    .object({ kind: z.literal('nfc'), technology: z.enum(['ndef', 'iso14443', 'iso15693']) })
    .strict(),
]);
export const ActionSchema = z.discriminatedUnion('type', [
  z
    .object({ type: z.literal('NAVIGATE'), route: z.string().regex(/^\/[a-zA-Z0-9/_-]*$/) })
    .strict(),
  z.object({ type: z.literal('SUBMIT'), schemaId: Id }).strict(),
  z.object({ type: z.literal('HARDWARE'), handler: HardwareSchema, field: Name }).strict(),
  z.object({ type: z.literal('PAY'), offerId: Id }).strict(),
]);
const common = { id: Name };
const leaf = z.discriminatedUnion('type', [
  z.object({ ...common, type: z.literal('TEXT'), text: z.string().max(4000) }).strict(),
  z
    .object({
      ...common,
      type: z.literal('INPUT_TEXT'),
      field: Name,
      label: z.string().max(100),
      inputType: z.enum(['text', 'number', 'email', 'date']),
      required: z.boolean(),
    })
    .strict(),
  z
    .object({
      ...common,
      type: z.literal('BUTTON'),
      label: z.string().max(100),
      action: ActionSchema,
    })
    .strict(),
  z
    .object({
      ...common,
      type: z.literal('PAYMENT_BUTTON'),
      label: z.string().max(100),
      action: z.object({ type: z.literal('PAY'), offerId: Id }).strict(),
    })
    .strict(),
  z
    .object({
      ...common,
      type: z.literal('SIGNATURE_CANVAS'),
      field: Name,
      handler: HardwareSchema.refine((v) => v.kind === 'signature'),
    })
    .strict(),
  z
    .object({
      ...common,
      type: z.literal('GIS_MAP'),
      handler: HardwareSchema.refine((v) => v.kind === 'gis'),
    })
    .strict(),
  z
    .object({
      ...common,
      type: z.literal('HARDWARE_BUTTON'),
      label: z.string().max(100),
      field: Name,
      handler: HardwareSchema,
    })
    .strict(),
]);
export type UIComponent =
  | z.infer<typeof leaf>
  | {
      id: string;
      type: 'FLEX' | 'GRID' | 'FORM' | 'TABS' | 'MODAL' | 'INFINITE_LIST';
      children: UIComponent[];
      direction?: 'row' | 'column';
      columns?: number;
      schemaId?: string;
      label?: string;
    };
const rawComponent: z.ZodType<UIComponent, z.ZodTypeDef, unknown> = z.lazy(() =>
  z.union([
    leaf,
    z
      .object({
        ...common,
        type: z.enum(['FLEX', 'GRID', 'FORM', 'TABS', 'MODAL', 'INFINITE_LIST']),
        children: z.array(rawComponent).max(100),
        direction: z.enum(['row', 'column']).optional(),
        columns: z.number().int().min(1).max(12).optional(),
        schemaId: Id.optional(),
        label: z.string().max(100).optional(),
      })
      .strict()
      .superRefine((v, c) => {
        if (['FORM', 'INFINITE_LIST'].includes(v.type) && !v.schemaId)
          c.addIssue({ code: 'custom', message: 'schemaId required' });
      }),
  ]),
);
export const ComponentSchema = z
  .unknown()
  .superRefine((value, ctx) => {
    let count = 0;
    const ids = new Set<string>();
    function check(node: unknown, depth: number) {
      if (++count > 500 || depth > 20) {
        ctx.addIssue({ code: 'custom', message: 'UI tree budget exceeded' });
        return;
      }
      if (node && typeof node === 'object') {
        const n = node as Record<string, unknown>;
        if (typeof n.id === 'string') {
          if (ids.has(n.id)) ctx.addIssue({ code: 'custom', message: 'Duplicate component id' });
          ids.add(n.id);
        }
        if (Array.isArray(n.children)) for (const child of n.children) check(child, depth + 1);
      }
    }
    check(value, 0);
  })
  .pipe(rawComponent);
export const ScreenSchema = z
  .object({
    route: z
      .string()
      .regex(/^\/[a-zA-Z0-9/_-]*$/)
      .max(160),
    title: z.string().min(1).max(100),
    tree: ComponentSchema,
  })
  .strict();
export const ThemeSchema = z
  .object({
    primary: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    background: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    fontFamily: z.string().max(80),
    radius: z.number().min(0).max(48),
  })
  .strict();
export const AppConfigSchema = z
  .object({
    schemaVersion: z.literal('1.0'),
    appId: Id,
    revision: z.number().int().positive(),
    version: z.string().regex(/^\d+\.\d+\.\d+$/),
    theme: ThemeSchema,
    screens: z.array(ScreenSchema).max(100),
    gateways: z.array(
      z.object({ provider: Provider, publicConfig: z.record(z.string()) }).strict(),
    ),
  })
  .strict();
export const WorkflowActionSchema = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('WEBHOOK'),
      url: HttpsUrl,
      secretRef: z.string().regex(/^[A-Z][A-Z0-9_]{2,80}$/),
    })
    .strict(),
  z
    .object({
      type: z.literal('PUSH'),
      token: z.string().min(1).max(4096),
      title: z.string().max(100),
      body: z.string().max(1000),
    })
    .strict(),
  z
    .object({ type: z.literal('PDF'), title: z.string().max(200), text: z.string().max(50000) })
    .strict(),
]);
export const Trigger = z.enum(['ON_FORM_SUBMIT', 'ON_GEOFENCE_ENTER', 'ON_PAYMENT_SUCCESS']);
export function validateRecord(fields: z.infer<typeof FieldSchema>[], data: unknown) {
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const f of fields) {
    let validator: z.ZodTypeAny;
    if (f.type === 'json')
      validator = z
        .record(z.unknown())
        .refine((value) => JSON.stringify(value).length <= 100000, 'JSON payload too large');
    else if (f.type === 'file')
      validator = z
        .object({
          assetId: Id,
          sha256: z.string().regex(/^[a-f0-9]{64}$/),
          timestamp: z.string().datetime(),
          latitude: z.number().min(-90).max(90).optional(),
          longitude: z.number().min(-180).max(180).optional(),
        })
        .strict();
    else if (f.type === 'signature')
      validator = z
        .object({
          svg: z.string().max(500000),
          png: z.string().max(1000000),
          sha256: z.string().regex(/^[a-f0-9]{64}$/),
          timestamp: z.string().datetime(),
        })
        .strict();
    else if (f.type === 'location')
      validator = z
        .object({ latitude: z.number().min(-90).max(90), longitude: z.number().min(-180).max(180) })
        .strict();
    else if (f.type === 'number') {
      let n = z.number().finite();
      if (f.min !== undefined) n = n.min(f.min);
      if (f.max !== undefined) n = n.max(f.max);
      validator = n;
    } else if (f.type === 'boolean') validator = z.boolean();
    else {
      let s = z.string().max(f.max ?? 10000);
      if (f.min !== undefined) s = s.min(f.min);
      if (f.type === 'email') s = s.email();
      if (f.type === 'date') s = s.datetime({ offset: true });
      validator = s;
    }
    if (f.options)
      validator = validator.refine((v) => f.options!.includes(String(v)), 'Invalid option');
    shape[f.name] = f.required ? validator : validator.optional();
  }
  return z.object(shape).strict().parse(data);
}
export type AppConfig = z.infer<typeof AppConfigSchema>;
