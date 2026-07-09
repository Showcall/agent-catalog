import { sanitizeCardPath, MAX_CARD_BYTES } from './cardFetcher';

describe('sanitizeCardPath', () => {
  it('accepts well-known card paths and strips leading slashes', () => {
    expect(sanitizeCardPath('/.well-known/agent-card.json')).toBe(
      '.well-known/agent-card.json',
    );
    expect(sanitizeCardPath('.well-known/agent.json')).toBe(
      '.well-known/agent.json',
    );
    expect(sanitizeCardPath('///a/b')).toBe('a/b');
    expect(sanitizeCardPath('card.json')).toBe('card.json');
  });

  it('rejects `..` traversal segments', () => {
    expect(sanitizeCardPath('../secrets')).toBeNull();
    expect(sanitizeCardPath('a/../../b')).toBeNull();
    expect(sanitizeCardPath('a/..')).toBeNull();
    expect(sanitizeCardPath('/..')).toBeNull();
  });

  it('rejects schemes, queries, fragments, encoding, and whitespace', () => {
    expect(sanitizeCardPath('http://evil/x')).toBeNull(); // ':' disallowed
    expect(sanitizeCardPath('/x?redirect=1')).toBeNull();
    expect(sanitizeCardPath('/x#frag')).toBeNull();
    expect(sanitizeCardPath('/%2e%2e/x')).toBeNull(); // '%' disallowed
    expect(sanitizeCardPath('/a b')).toBeNull();
    expect(sanitizeCardPath('/a\\b')).toBeNull();
  });

  it('rejects empty, blank, and over-long paths', () => {
    expect(sanitizeCardPath('')).toBeNull();
    expect(sanitizeCardPath('   ')).toBeNull();
    expect(sanitizeCardPath('/')).toBeNull();
    expect(sanitizeCardPath('/a'.repeat(200))).toBeNull(); // > 256 chars
    expect(sanitizeCardPath(undefined as unknown as string)).toBeNull();
  });

  it('exposes a positive size cap', () => {
    expect(MAX_CARD_BYTES).toBeGreaterThan(0);
  });
});
