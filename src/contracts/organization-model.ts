import { z } from "zod";

export const organizationModelValueSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.array(z.string())
]);

export const schemaKeySchema = z.string().regex(/^[a-z][a-z0-9_-]*$/);
export const typePropertySchema = z
  .object({
    key: schemaKeySchema,
    name: z.string().min(1),
    kind: z.enum([
      "text",
      "number",
      "boolean",
      "date",
      "select",
      "multi_select"
    ]),
    options: z.array(z.string().min(1)).min(1).optional(),
    default: organizationModelValueSchema.optional(),
    required: z.boolean().optional(),
    advisory: z.string().min(1).optional()
  })
  .superRefine((property, context) => {
    const expectsOptions =
      property.kind === "select" || property.kind === "multi_select";
    if (expectsOptions !== (property.options !== undefined)) {
      context.addIssue({
        code: "custom",
        message: `${property.kind} properties ${expectsOptions ? "require" : "cannot define"} options`
      });
    }
    if (
      property.default !== undefined &&
      !organizationModelValueMatches(
        property.kind,
        property.default,
        property.options
      )
    ) {
      context.addIssue({
        code: "custom",
        message: `default does not match property kind '${property.kind}'`
      });
    }
  });

export const typeDefinitionSchema = z.object({
  key: schemaKeySchema,
  name: z.string().min(1),
  defaultState: z.string().min(1).optional(),
  properties: z.array(typePropertySchema)
});

export const relationshipDefinitionSchema = z.object({
  key: schemaKeySchema,
  name: z.string().min(1),
  cardinality: z.enum(["one", "many"]),
  inverse: schemaKeySchema,
  targetTypes: z.array(schemaKeySchema)
});

export const queryPredicateSchema = z
  .object({
    field: z.string().regex(/^[a-z_][a-z0-9_-]*$/),
    operator: z.enum([
      "equals",
      "not_equals",
      "in",
      "not_in",
      "contains",
      "exists",
      "greater_than",
      "greater_than_or_equal",
      "less_than",
      "less_than_or_equal"
    ]),
    value: organizationModelValueSchema.optional()
  })
  .superRefine((predicate, context) => {
    if (predicate.operator !== "exists" && predicate.value === undefined) {
      context.addIssue({
        code: "custom",
        message: `operator '${predicate.operator}' requires a value`
      });
    }
  });

export type QueryFilter =
  | z.infer<typeof queryPredicateSchema>
  | { all: QueryFilter[] }
  | { any: QueryFilter[] }
  | { not: QueryFilter };

export const queryFilterSchema: z.ZodType<QueryFilter> = z.lazy(() =>
  z.union([
    queryPredicateSchema,
    z.object({ all: z.array(queryFilterSchema).min(1) }),
    z.object({ any: z.array(queryFilterSchema).min(1) }),
    z.object({ not: queryFilterSchema })
  ])
);

export const querySpecSchema = z.object({
  filter: queryFilterSchema.optional(),
  order: z
    .array(
      z.object({
        field: z.string().regex(/^[a-z_][a-z0-9_-]*$/),
        direction: z.enum(["ascending", "descending"])
      })
    )
    .optional(),
  groupBy: z.string().regex(/^[a-z_][a-z0-9_-]*$/).optional(),
  layout: z.enum(["list", "table", "board"]).optional(),
  visibleColumns: z
    .array(z.string().regex(/^[a-z_][a-z0-9_-]*$/))
    .optional()
});

export const savedViewSchema = z.object({
  key: schemaKeySchema,
  name: z.string().min(1),
  query: querySpecSchema
});

export const typeDefinitionListResponseSchema = z.array(typeDefinitionSchema);
export const savedViewListResponseSchema = z.array(savedViewSchema);
export const organizationModelResponseSchema = z.object({
  states: z.array(z.string().min(1)),
  types: z.array(typeDefinitionSchema),
  relationships: z.array(relationshipDefinitionSchema),
  views: z.array(savedViewSchema)
});

export const structuredNoteItemSchema = z.object({
  kind: z.enum(["standalone", "daily"]),
  id: z.uuid(),
  title: z.string().min(1),
  canonicalPath: z
    .string()
    .regex(/^human\/(?:notes\/[^/]+|daily\/\d{4}-\d{2}-\d{2})\.md$/),
  revision: z.string().regex(/^[0-9a-f]{64}$/),
  type: z.string().min(1).nullable(),
  state: z.string().min(1),
  tags: z.array(z.string()),
  aliases: z.array(z.string()),
  properties: z.record(z.string(), organizationModelValueSchema),
  url: z
    .string()
    .regex(/^\/(?:notes\/[0-9a-f-]{36}|daily\/\d{4}-\d{2}-\d{2})$/),
  fields: z.record(z.string(), organizationModelValueSchema.nullable())
});
export const typeResultResponseSchema = typeDefinitionSchema.extend({
  items: z.array(structuredNoteItemSchema)
});
export const savedViewResultResponseSchema = savedViewSchema.extend({
  groups: z.array(
    z.object({
      key: z.string(),
      items: z.array(structuredNoteItemSchema)
    })
  ),
  items: z.array(structuredNoteItemSchema)
});

export type OrganizationModelValue = z.infer<
  typeof organizationModelValueSchema
>;
export type TypeProperty = z.infer<typeof typePropertySchema>;
export type TypeDefinition = z.infer<typeof typeDefinitionSchema>;
export type RelationshipDefinition = z.infer<
  typeof relationshipDefinitionSchema
>;
export type QueryPredicate = z.infer<typeof queryPredicateSchema>;
export type QuerySpec = z.infer<typeof querySpecSchema>;
export type SavedView = z.infer<typeof savedViewSchema>;
export type StructuredNoteItem = z.infer<typeof structuredNoteItemSchema>;
export type OrganizationModelResponse = z.infer<
  typeof organizationModelResponseSchema
>;
export type TypeResultResponse = z.infer<typeof typeResultResponseSchema>;
export type SavedViewResultResponse = z.infer<
  typeof savedViewResultResponseSchema
>;

export function organizationModelValueMatches(
  kind: TypeProperty["kind"],
  value: unknown,
  options: readonly string[] | undefined
): boolean {
  switch (kind) {
    case "text":
      return typeof value === "string";
    case "number":
      return typeof value === "number" && Number.isFinite(value);
    case "boolean":
      return typeof value === "boolean";
    case "date":
      return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
    case "select":
      return typeof value === "string" && (options?.includes(value) ?? false);
    case "multi_select":
      return (
        Array.isArray(value) &&
        value.every(
          (entry) => typeof entry === "string" && options?.includes(entry)
        )
      );
  }
}
