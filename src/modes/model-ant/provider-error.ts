export function modelErrorMessage(message: string): string {
  const status = /Model provider returned HTTP (\d{3})/.exec(message)?.[1];
  if (status && Number(status) >= 500) return `The model service failed while processing the request (HTTP ${status}). No move was applied. Use One step to retry; your experiment is preserved. This response does not establish a credit or quota problem.`;
  if (status === '429') return 'The model service hit a rate or quota limit (HTTP 429). No move was applied. Wait briefly, then use One step to retry.';
  return message;
}
