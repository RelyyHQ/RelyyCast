export const MP3_HEALTH_DEV_PROXY_PATH = "/__relyy/mp3-health";
export const RUNTIME_HEALTH_PATH = "/health";

export function normalizeMountPath(pathname: string | undefined): string {
  if (!pathname || pathname === "/") return "/live.mp3";
  return pathname.startsWith("/") ? pathname : `/${pathname}`;
}

export function buildHlsUrl(relayPath: string): string {
  const normalized = relayPath.trim().replace(/^\/+|\/+$/g, "") || "live";
  return `http://127.0.0.1:8888/${normalized}/index.m3u8`;
}

/** Returns null for non-HTTP/HTTPS inputs rather than throwing. */
export function parseHttpInputUrl(value: string): URL | null {
  const source = value.trim();
  if (!source) return null;
  try {
    const parsed = new URL(source);
    if (parsed.protocol === "http:" || parsed.protocol === "https:") return parsed;
  } catch {
    // ignore invalid URLs
  }
  return null;
}

export function buildMp3HealthUrl(input: URL | null): string | null {
  if (!input) return null;
  return `${input.origin}${RUNTIME_HEALTH_PATH}`;
}

/** Dev-mode proxy path avoids CORS when the MP3 server is on a different port. */
export function buildMp3HealthDevProxyUrl(input: URL | null): string | null {
  if (!input) return null;
  return `${MP3_HEALTH_DEV_PROXY_PATH}?origin=${encodeURIComponent(input.origin)}`;
}
