// @vitest-environment jsdom
import { expect, it } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { useState } from 'react';
import { TabView, TabPanel } from './tabs';

it('removes conditional tabs immediately when display mode changes', () => {
  function Settings() {
    const [simple, setSimple] = useState(false);
    return (
      <>
        <button type="button" onClick={() => setSimple(!simple)}>
          Change display mode
        </button>
        <TabView activeIndex={0}>
          <TabPanel header="General">General</TabPanel>
          {!simple && <TabPanel header="Data & Storage">Storage</TabPanel>}
          <TabPanel header="Account">Profile</TabPanel>
        </TabView>
      </>
    );
  }
  render(<Settings />);
  expect(
    screen.getByRole('tab', { name: 'Data & Storage' }),
  ).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Change display mode' }));
  expect(
    screen.queryByRole('tab', { name: 'Data & Storage' }),
  ).not.toBeInTheDocument();
});
