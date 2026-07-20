export interface ProbeResult {
  ready: boolean;
  status: number | null;
}

export async function probeHealth(url: string, timeoutMs: number): Promise<ProbeResult> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    return { ready: response.ok, status: response.status };
  } catch (error) {
    // Connection refused, DNS, TLS, AbortError from the timeout — all valid
    // "not ready yet" signals during boot. Re-throw anything that isn't a
    // standard Error so genuine bugs (URL constructor failures, non-Error
    // throws) don't get silently treated as "still booting forever".
    if (error instanceof Error) {
      return { ready: false, status: null };
    }
    throw error;
  }
}
