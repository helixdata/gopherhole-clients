import { describe, expect, it } from 'vitest';
import { CHAT_INACTIVITY_TIMEOUT_MS, GATEWAY_PROTOCOL_VERSION } from './gateway-client';

describe('OpenClaw gateway compatibility', () => {
  it('uses the gateway protocol required by OpenClaw 2026.7+', () => {
    expect(GATEWAY_PROTOCOL_VERSION).toBe(4);
  });

  it('allows long-running agent tasks while progress keepalives are emitted', () => {
    expect(CHAT_INACTIVITY_TIMEOUT_MS).toBe(30 * 60 * 1000);
  });
});
