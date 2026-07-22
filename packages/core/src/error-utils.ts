/**
 * RFC 6749 Section 5.2: error_description allowed characters
 *
 *   error-description = 1*( %x20-21 / %x23-5B / %x5D-7E )
 *
 * - 0x20 (space), 0x21 (!)
 * - 0x23-0x5B (excludes 0x22 = ")
 * - 0x5D-0x7E (excludes 0x5C = \)
 *
 * Control characters, double-quote, backslash, and non-ASCII (>= 0x7F)
 * must be replaced because the value is echoed back in the JSON body and may
 * also be used in headers (e.g. WWW-Authenticate Bearer error_description).
 */
export function sanitizeErrorDescription(value: string): string {
  let result = '';
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    const allowed =
      code === 0x20 ||
      code === 0x21 ||
      (code >= 0x23 && code <= 0x5b) ||
      (code >= 0x5d && code <= 0x7e);
    result += allowed ? value[i] : '?';
  }
  return result;
}
