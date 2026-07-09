import { isInsecureGatewayUrl, MAX_USAGE_BYTES } from './litellmUsageSource';

describe('isInsecureGatewayUrl', () => {
  it('allows https anywhere', () => {
    expect(isInsecureGatewayUrl('https://litellm.internal:4000')).toBe(false);
    expect(isInsecureGatewayUrl('https://gateway.example.com')).toBe(false);
  });

  it('allows http only for loopback (local dev / demo ledger)', () => {
    expect(isInsecureGatewayUrl('http://localhost:4400')).toBe(false);
    expect(isInsecureGatewayUrl('http://127.0.0.1:4400')).toBe(false);
    expect(isInsecureGatewayUrl('http://127.0.0.5:4400')).toBe(false);
    expect(isInsecureGatewayUrl('http://[::1]:4400')).toBe(false);
  });

  it('refuses http to a non-loopback host (would leak the key in plaintext)', () => {
    expect(isInsecureGatewayUrl('http://litellm.internal:4000')).toBe(true);
    expect(isInsecureGatewayUrl('http://10.0.0.5:4000')).toBe(true);
  });

  it('treats non-http(s) and unparseable URLs as unsafe', () => {
    expect(isInsecureGatewayUrl('ftp://host/x')).toBe(true);
    expect(isInsecureGatewayUrl('not a url')).toBe(true);
    expect(isInsecureGatewayUrl('')).toBe(true);
  });

  it('exposes a positive response size cap', () => {
    expect(MAX_USAGE_BYTES).toBeGreaterThan(0);
  });
});
