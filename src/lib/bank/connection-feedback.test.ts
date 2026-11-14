import { describe, expect, it } from 'vitest';
import { bankCallbackError, bankConnectionFeedback } from './connection-feedback';

describe('bank connection feedback', () => {
  it('treats only access_denied as cancellation', () => {
    expect(bankCallbackError('access_denied')).toBe('cancelled');
    expect(bankCallbackError('server_error')).toBe('provider_failed');
  });
  it('never includes provider or unknown query text in feedback', () => {
    expect(bankConnectionFeedback('cancelled').severity).toBe('info');
    for (const error of ['sca_declined', 'provider_failed', 'sensitive-provider-detail']) {
      const result = bankConnectionFeedback(error);
      expect(result.severity).toBe('error');
      expect(result.message).not.toContain(error);
    }
  });
});
