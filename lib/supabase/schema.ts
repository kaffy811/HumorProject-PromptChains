// Same switch as the member app: production data lives in public.
export function dataSchema(): "public" | "humor_preview" {
  const schema = process.env.HUMOR_DATA_SCHEMA;
  if (schema && !["public", "humor_preview"].includes(schema))
    throw new Error("Invalid data schema.");
  return schema === "humor_preview" ? "humor_preview" : "public";
}
export function storageBucket(name: string) {
  return dataSchema() === "humor_preview" ? name.replace(/^humor-/, "humor-preview-") : name;
}
