/** UUID v4-style check used by audit logging (no DB imports). */

const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value?: string | null): value is string {
  if (!value) return false;
  return uuidRegex.test(value);
}
