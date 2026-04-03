/** Treat files.is_adult from Supabase/PostgREST without truthy-string bugs (e.g. Boolean("false") === true). */
export function isDbAdultFlag(value: unknown): boolean {
  if (value === true) return true;
  if (value === false || value == null) return false;
  if (typeof value === "number") return value === 1;
  if (typeof value === "string") {
    const s = value.trim().toLowerCase();
    if (s === "true" || s === "t" || s === "1" || s === "yes") return true;
    if (s === "false" || s === "f" || s === "0" || s === "no" || s === "") return false;
    return false;
  }
  return false;
}
