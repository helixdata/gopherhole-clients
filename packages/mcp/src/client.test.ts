/**
 * Unit tests for MCP client discovery methods
 * Tests the new discovery params: tag, skillTag, contentMode, sort, offset, scope
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GopherHoleClient, DiscoverResult } from './client';

// Mock fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('GopherHoleClient Discovery', () => {
  let client: GopherHoleClient;
  const mockApiKey = 'gph_test_key';

  beforeEach(() => {
    client = new GopherHoleClient({
      apiKey: mockApiKey,
      apiUrl: 'https://test.gopherhole.ai',
    });
    mockFetch.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  const mockDiscoverResponse: DiscoverResult = {
    agents: [
      {
        id: 'agent-1',
        name: 'Test Agent',
        description: 'A test agent',
        category: 'test',
        tags: ['testing', 'demo'],
        pricing: 'free',
        avgRating: 4.5,
        ratingCount: 10,
        tenantName: 'TestTenant',
      },
    ],
    count: 1,
  };

  const setupMockResponse = (response: DiscoverResult = mockDiscoverResponse) => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(response),
    });
  };

  describe('discover() with new params', () => {
    it('should call discover with tag param', async () => {
      setupMockResponse();

      await client.discover({ tag: 'ai' });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('tag=ai'),
        expect.objectContaining({
          headers: { Authorization: `Bearer ${mockApiKey}` },
        })
      );
    });

    it('should call discover with skillTag param', async () => {
      setupMockResponse();

      await client.discover({ skillTag: 'nlp' });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('skillTag=nlp'),
        expect.any(Object)
      );
    });

    it('should call discover with contentMode param', async () => {
      setupMockResponse();

      await client.discover({ contentMode: 'text/markdown' });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('contentMode=text%2Fmarkdown'),
        expect.any(Object)
      );
    });

    it('should call discover with sort param', async () => {
      setupMockResponse();

      await client.discover({ sort: 'rating' });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('sort=rating'),
        expect.any(Object)
      );
    });

    it('should call discover with offset param', async () => {
      setupMockResponse();

      await client.discover({ offset: 20 });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('offset=20'),
        expect.any(Object)
      );
    });

    it('should call discover with scope=tenant', async () => {
      setupMockResponse();

      await client.discover({ scope: 'tenant' });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('scope=tenant'),
        expect.any(Object)
      );
    });
  });

  describe('discover() with combined params', () => {
    it('should combine multiple new params', async () => {
      setupMockResponse();

      await client.discover({
        tag: 'ai',
        skillTag: 'nlp',
        sort: 'popular',
        offset: 10,
      });

      const url = mockFetch.mock.calls[0][0] as string;
      expect(url).toContain('tag=ai');
      expect(url).toContain('skillTag=nlp');
      expect(url).toContain('sort=popular');
      expect(url).toContain('offset=10');
    });

    it('should combine query with new params', async () => {
      setupMockResponse();

      await client.discover({
        query: 'weather',
        tag: 'api',
        contentMode: 'application/json',
        sort: 'recent',
        limit: 25,
      });

      const url = mockFetch.mock.calls[0][0] as string;
      expect(url).toContain('q=weather');
      expect(url).toContain('tag=api');
      expect(url).toContain('contentMode=application%2Fjson');
      expect(url).toContain('sort=recent');
      expect(url).toContain('limit=25');
    });
  });

  describe('discover() edge cases', () => {
    it('should handle empty results', async () => {
      setupMockResponse({ agents: [], count: 0 });

      const result = await client.discover({ tag: 'nonexistent' });

      expect(result.agents).toHaveLength(0);
      expect(result.count).toBe(0);
    });

    it('should handle fetch errors', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        statusText: 'Internal Server Error',
      });

      await expect(client.discover({ tag: 'test' })).rejects.toThrow('Discovery failed');
    });

    it('should not include undefined params in URL', async () => {
      setupMockResponse();

      await client.discover({ query: 'test' });

      const url = mockFetch.mock.calls[0][0] as string;
      expect(url).not.toContain('tag=');
      expect(url).not.toContain('skillTag=');
      expect(url).not.toContain('contentMode=');
      expect(url).not.toContain('sort=');
      expect(url).not.toContain('offset=');
      expect(url).not.toContain('scope=');
    });

    it('should handle special characters in params', async () => {
      setupMockResponse();

      await client.discover({ contentMode: 'application/ld+json' });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('contentMode=application%2Fld%2Bjson'),
        expect.any(Object)
      );
    });
  });

  describe('discover() sort values', () => {
    it('should accept rating sort', async () => {
      setupMockResponse();
      await client.discover({ sort: 'rating' });
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('sort=rating'),
        expect.any(Object)
      );
    });

    it('should accept popular sort', async () => {
      setupMockResponse();
      await client.discover({ sort: 'popular' });
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('sort=popular'),
        expect.any(Object)
      );
    });

    it('should accept recent sort', async () => {
      setupMockResponse();
      await client.discover({ sort: 'recent' });
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('sort=recent'),
        expect.any(Object)
      );
    });
  });

  describe('discover() pagination', () => {
    it('should handle limit and offset together', async () => {
      setupMockResponse();

      await client.discover({ limit: 10, offset: 30 });

      const url = mockFetch.mock.calls[0][0] as string;
      expect(url).toContain('limit=10');
      expect(url).toContain('offset=30');
    });

    it('should handle max limit (50)', async () => {
      setupMockResponse();

      await client.discover({ limit: 50 });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('limit=50'),
        expect.any(Object)
      );
    });
  });

  describe('discover() tenant scope', () => {
    it('should request tenant-scoped agents', async () => {
      const tenantAgents = {
        agents: Array(75).fill(mockDiscoverResponse.agents[0]),
        count: 75,
      };
      setupMockResponse(tenantAgents);

      const result = await client.discover({ scope: 'tenant' });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('scope=tenant'),
        expect.any(Object)
      );
      expect(result.agents).toHaveLength(75);
    });
  });

  describe('fromEnv()', () => {
    it('should create client from env', () => {
      process.env.GOPHERHOLE_API_KEY = 'gph_env_key';
      
      const envClient = GopherHoleClient.fromEnv();
      
      expect(envClient).toBeInstanceOf(GopherHoleClient);
      
      delete process.env.GOPHERHOLE_API_KEY;
    });

    it('should throw if env not set', () => {
      delete process.env.GOPHERHOLE_API_KEY;
      
      expect(() => GopherHoleClient.fromEnv()).toThrow('GOPHERHOLE_API_KEY');
    });
  });
});
