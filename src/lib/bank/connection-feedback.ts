/** Map provider callback errors to a small, safe set of app-owned outcomes. */
export function bankCallbackError(error: string): 'cancelled' | 'provider_failed' {
  return error === 'access_denied' ? 'cancelled' : 'provider_failed';
}

/** Never display untrusted provider or query-string error text. */
export function bankConnectionFeedback(error: string): { severity: 'info' | 'error'; message: string } {
  if (error === 'cancelled') {
    return { severity: 'info', message: 'Bank connection cancelled. You can try again whenever you are ready.' };
  }
  return { severity: 'error', message: 'Could not connect your bank. Please try again.' };
}
