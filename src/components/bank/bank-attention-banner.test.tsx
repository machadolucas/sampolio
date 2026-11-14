// @vitest-environment jsdom
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { BankAttentionBanner } from './bank-attention-banner';

vi.mock('@/components/providers/theme-provider', () => ({ useTheme: () => ({ theme: 'dark' }) }));

describe('bank reference review attention', () => {
  it('offers review instead of reconnecting when a reference change is suspected', () => {
    const onAction = vi.fn();
    render(<BankAttentionBanner onAction={onAction} attention={[{
      connectionId: 'synthetic', aspspName: 'Example Bank', expired: false,
      expiringSoon: false, daysUntilExpiry: 100, syncFailing: true,
      lastError: 'TRANSACTION_REFERENCE_CHANGED',
    }]} />);
    expect(screen.getByRole('status')).toHaveTextContent('saved data was left unchanged');
    expect(screen.queryByRole('button', { name: 'Reconnect' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Review bank data' }));
    expect(onAction).toHaveBeenCalledOnce();
  });
});
