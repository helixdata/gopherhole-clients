import { describe, expect, it } from 'vitest';
import { GATEWAY_PROTOCOL_VERSION } from './gateway-client';

describe('OpenClaw gateway compatibility', () => {
  it('uses the gateway protocol required by OpenClaw 2026.7+', () => {
    expect(GATEWAY_PROTOCOL_VERSION).toBe(4);
  });
});
