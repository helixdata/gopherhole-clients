/**
 * Unit tests for OpenClaw plugin discovery methods
 * Tests the new discovery params: tag, skillTag, contentMode, sort, offset, scope
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { A2AConnectionManager } from './connection';

// Mock fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

// Mock @gopherhole/sdk
vi.mock('@gopherhole/sdk', () => ({
  GopherHole: vi.fn().mockImplementation(() => ({
    connect: vi.fn(),
    disconnect: vi.fn(),
    on: vi.fn(),
    connected: false,
    id: null,
  })),
  getTaskResponseText: vi.fn(),
}));

describe('A2AConnectionManager Discovery', () => {
  let manager: A2AConnectionManager;
  const mockApiKey = 'gph_test_key';

  beforeEach(() => {
    manager = new A2AConnectionManager({
      enabled: true,
      apiKey: mockApiKey,
      bridgeUrl: 'wss://test.gopherhole.ai/ws',
    });
    mockFetch.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  const mockDiscoverResponse = {
    agents: [
      {
        id: 'agent-1',
        name: 'Test Agent',
        description: 'A test agent',
        verified: true,
        tenantName: 'TestTenant',
        avgRating: 4.5,
      },
    ],
  };

  const setupMockRpcResponse = (result: any) => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ result }),
    });
  };

  describe('discoverAgents() with new params', () => {
    it('should call discover with tag param', async () => {
      setupMockRpcResponse(mockDiscoverResponse);

      await manager.discoverAgents({ tag: 'ai' });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('"tag":"ai"'),
        })
      );
    });

    it('should call discover with skillTag param', async () => {
      setupMockRpcResponse(mockDiscoverResponse);

      await manager.discoverAgents({ skillTag: 'nlp' });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: expect.stringContaining('"skillTag":"nlp"'),
        })
      );
    });

    it('should call discover with contentMode param', async () => {
      setupMockRpcResponse(mockDiscoverResponse);

      await manager.discoverAgents({ contentMode: 'text/markdown' });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: expect.stringContaining('"contentMode":"text/markdown"'),
        })
      );
    });

    it('should call discover with sort param', async () => {
      setupMockRpcResponse(mockDiscoverResponse);

      await manager.discoverAgents({ sort: 'rating' });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: expect.stringContaining('"sort":"rating"'),
        })
      );
    });

    it('should call discover with offset param', async () => {
      setupMockRpcResponse(mockDiscoverResponse);

      await manager.discoverAgents({ offset: 20 });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: expect.stringContaining('"offset":20'),
        })
      );
    });

    it('should call discover with scope=tenant', async () => {
      setupMockRpcResponse(mockDiscoverResponse);

      await manager.discoverAgents({ scope: 'tenant' });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: expect.stringContaining('"scope":"tenant"'),
        })
      );
    });
  });

  describe('discoverAgents() with combined params', () => {
    it('should combine multiple new params', async () => {
      setupMockRpcResponse(mockDiscoverResponse);

      await manager.discoverAgents({
        tag: 'ai',
        skillTag: 'nlp',
        sort: 'popular',
        offset: 10,
      });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.params.tag).toBe('ai');
      expect(body.params.skillTag).toBe('nlp');
      expect(body.params.sort).toBe('popular');
      expect(body.params.offset).toBe(10);
    });

    it('should combine query with new params', async () => {
      setupMockRpcResponse(mockDiscoverResponse);

      await manager.discoverAgents({
        query: 'weather',
        tag: 'api',
        contentMode: 'application/json',
        sort: 'recent',
        limit: 25,
      });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.params.query).toBe('weather');
      expect(body.params.tag).toBe('api');
      expect(body.params.contentMode).toBe('application/json');
      expect(body.params.sort).toBe('recent');
      expect(body.params.limit).toBe(25);
    });
  });

  describe('discoverAgents() edge cases', () => {
    it('should handle empty results', async () => {
      setupMockRpcResponse({ agents: [] });

      const result = await manager.discoverAgents({ tag: 'nonexistent' });

      expect(result).toHaveLength(0);
    });

    it('should handle RPC errors gracefully', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ error: { message: 'Not found' } }),
      });

      const result = await manager.discoverAgents({ tag: 'test' });

      expect(result).toEqual([]);
    });

    it('should handle network errors', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      const result = await manager.discoverAgents({ tag: 'test' });

      expect(result).toEqual([]);
    });

    it('should return empty array when apiKey not configured', async () => {
      const managerNoKey = new A2AConnectionManager({
        enabled: true,
        // No apiKey
      });

      const result = await managerNoKey.discoverAgents({ tag: 'test' });

      expect(result).toEqual([]);
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  describe('discoverAgents() sort values', () => {
    it('should accept rating sort', async () => {
      setupMockRpcResponse(mockDiscoverResponse);
      await manager.discoverAgents({ sort: 'rating' });
      
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.params.sort).toBe('rating');
    });

    it('should accept popular sort', async () => {
      setupMockRpcResponse(mockDiscoverResponse);
      await manager.discoverAgents({ sort: 'popular' });
      
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.params.sort).toBe('popular');
    });

    it('should accept recent sort', async () => {
      setupMockRpcResponse(mockDiscoverResponse);
      await manager.discoverAgents({ sort: 'recent' });
      
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.params.sort).toBe('recent');
    });
  });

  describe('discoverAgents() response mapping', () => {
    it('should map response correctly', async () => {
      setupMockRpcResponse({
        agents: [
          {
            id: 'agent-1',
            name: 'Test Agent',
            description: 'A test agent',
            verified: true,
            tenantName: 'TestTenant',
            avgRating: 4.5,
          },
        ],
      });

      const result = await manager.discoverAgents({ query: 'test' });

      expect(result).toEqual([
        {
          id: 'agent-1',
          name: 'Test Agent',
          description: 'A test agent',
          verified: true,
          tenantName: 'TestTenant',
          avgRating: 4.5,
        },
      ]);
    });
  });

  describe('listAvailableAgents()', () => {
    it('should list available agents', async () => {
      setupMockRpcResponse({
        agents: [
          {
            id: 'agent-1',
            name: 'Test Agent',
            description: 'A test agent',
            verified: true,
            accessType: 'same-tenant',
          },
        ],
      });

      const result = await manager.listAvailableAgents();

      expect(result).toHaveLength(1);
      expect(result[0].accessType).toBe('same-tenant');
    });
  });
});
