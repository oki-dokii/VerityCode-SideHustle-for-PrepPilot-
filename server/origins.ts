/** Development aliases are exact origins on the configured port, never wildcards. */
export function allowedOrigins(configured: string, production: boolean) {
  const url = new URL(configured);
  const origins = new Set([url.origin]);
  if (
    !production &&
    ["http:", "https:"].includes(url.protocol) &&
    ["localhost", "127.0.0.1"].includes(url.hostname)
  ) {
    url.hostname = url.hostname === "localhost" ? "127.0.0.1" : "localhost";
    origins.add(url.origin);
  }
  return origins;
}
