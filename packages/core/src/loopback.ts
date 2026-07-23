/**
 * Return whether a URL hostname identifies a loopback interface.
 *
 * `URL.hostname` normalizes IPv4 address forms before this check, so the
 * regular expression only needs to accept the canonical 127/8 representation.
 * RFC 8252 Section 7.3 permits any IPv4 loopback address, not only 127.0.0.1.
 */
export function isLoopbackHostname(hostname: string): boolean {
  return (
    hostname === 'localhost' ||
    hostname === '[::1]' ||
    /^127(?:\.\d{1,3}){3}$/.test(hostname)
  );
}
