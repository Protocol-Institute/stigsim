export function isAllowedWebSocketOrigin(
  origin: string | undefined,
  allowedOrigins: string[],
  requireOrigin: boolean,
): boolean {
  if (!origin) return !requireOrigin;
  return allowedOrigins.includes(origin);
}
