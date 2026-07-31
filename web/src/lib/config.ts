/** Single place for API base configuration. */
export function getApiBaseUrl(): string {
  const fromEnv =
    typeof import.meta !== "undefined" &&
    import.meta.env &&
    typeof import.meta.env.PUBLIC_API_BASE_URL === "string"
      ? import.meta.env.PUBLIC_API_BASE_URL.trim()
      : "";
  if (fromEnv) return fromEnv.replace(/\/$/, "");
  return "http://localhost:4021";
}

export const POLL_INTERVAL_MS = 1500;
