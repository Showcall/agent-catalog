/* eslint-disable no-console -- this file deliberately wraps console.error */
import '@testing-library/jest-dom';

// jsdom can't parse Backstage's modern UI CSS (@layer, container queries), so
// rendering in a test app floods the output with harmless "Could not parse CSS
// stylesheet" errors. Filter just those; let every other console.error through.
const original = console.error;
jest.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
  const text = args
    .map(a => (a instanceof Error ? a.message : String(a)))
    .join(' ');
  if (text.includes('Could not parse CSS stylesheet')) return;
  original(...(args as Parameters<typeof console.error>));
});
