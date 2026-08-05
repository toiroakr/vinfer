/**
 * Simple logger for vinfer with verbose mode support.
 */

let verboseEnabled = false;

/**
 * Enables or disables verbose logging.
 */
export function setVerbose(enabled: boolean): void {
  verboseEnabled = enabled;
}

/**
 * Logs a verbose message (only when verbose mode is enabled).
 */
export function logVerbose(message: string, ...args: unknown[]): void {
  if (verboseEnabled) {
    console.log(`[verbose] ${message}`, ...args);
  }
}

/**
 * Logs a debug message about a non-critical error (only when verbose mode is enabled).
 */
export function logDebugError(context: string, error: unknown): void {
  if (verboseEnabled) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.log(`[verbose] ${context}: ${errorMessage}`);
  }
}

/**
 * Logs progress information (only when verbose mode is enabled).
 */
export function logProgress(current: number, total: number, message: string): void {
  if (verboseEnabled) {
    console.log(`[${current}/${total}] ${message}`);
  }
}
