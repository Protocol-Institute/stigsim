const COMMIT_KEYS = new Set([
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "ArrowUp",
  "End",
  "Home",
  "PageDown",
  "PageUp",
]);

export function replayScrubCommitKey(key: string): boolean {
  return COMMIT_KEYS.has(key);
}
