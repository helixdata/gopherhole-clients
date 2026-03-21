/**
 * Unit tests for SDK discovery methods
 * Tests the new discovery params: tag, skillTag, contentMode, sort, offset, scope
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GopherHole, DiscoverOptions, DiscoverResult } from '../src/index';

// Mock fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('GopherHole Discovery', () => {
  let client: GopherHole;
  const mockApiKey = 'gph_test_key';

  beforeEach(() => {
    client = new GopherHole({
      apiKey: mockApiKey,
      hubUrl: 'wss://test.gopherhole.ai/ws',
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
        websiteUrl: null,
        docsUrl: null,
      },
    ],
    count: 1,
    offset: 0,
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

    it('should call discover with sort=rating', async () => {
      setupMockResponse();

      await client.discover({ sort: 'rating' });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('sort=rating'),
        expect.any(Object)
      );
    });

    it('should call discover with sort=popular', async () => {
      setupMockResponse();

      await client.discover({ sort: 'popular' });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('sort=popular'),
        expect.any(Object)
      );
    });

    it('should call discover with sort=recent', async () => {
      setupMockResponse();

      await client.discover({ sort: 'recent' });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('sort=recent'),
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
        sort: 'rating',
        offset: 10,
      });

      const url = mockFetch.mock.calls[0][0] as string;
      expect(url).toContain('tag=ai');
      expect(url).toContain('skillTag=nlp');
      expect(url).toContain('sort=rating');
      expect(url).toContain('offset=10');
    });

    it('should combine old and new params', async () => {
      setupMockResponse();

      await client.discover({
        query: 'weather',
        category: 'utilities',
        tag: 'api',
        sort: 'popular',
        limit: 20,
      });

      const url = mockFetch.mock.calls[0][0] as string;
      expect(url).toContain('q=weather');
      expect(url).toContain('category=utilities');
      expect(url).toContain('tag=api');
      expect(url).toContain('sort=popular');
      expect(url).toContain('limit=20');
    });

    it('should handle scope=tenant with all params', async () => {
      setupMockResponse({
        agents: Array(100).fill(mockDiscoverResponse.agents[0]),
        count: 100,
        offset: 0,
      });

      await client.discover({
        scope: 'tenant',
        tag: 'internal',
        sort: 'recent',
      });

      const url = mockFetch.mock.calls[0][0] as string;
      expect(url).toContain('scope=tenant');
      expect(url).toContain('tag=internal');
      expect(url).toContain('sort=recent');
    });
  });

  describe('discover() edge cases', () => {
    it('should handle empty results', async () => {
      setupMockResponse({ agents: [], count: 0, offset: 0 });

      const result = await client.discover({ tag: 'nonexistent' });

      expect(result.agents).toHaveLength(0);
      expect(result.count).toBe(0);
    });

    it('should handle special characters in contentMode', async () => {
      setupMockResponse();

      await client.discover({ contentMode: 'application/json+ld' });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('contentMode=application%2Fjson%2Bld'),
        expect.any(Object)
      );
    });

    it('should handle limit at max (50)', async () => {
      setupMockResponse();

      await client.discover({ limit: 50 });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('limit=50'),
        expect.any(Object)
      );
    });

    it('should handle pagination with offset', async () => {
      setupMockResponse({ agents: [], count: 100, offset: 50 });

      const result = await client.discover({ limit: 10, offset: 50 });

      expect(result.offset).toBe(50);
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('offset=50'),
        expect.any(Object)
      );
    });

    it('should not include undefined params', async () => {
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
  });

  describe('convenience methods with new params', () => {
    it('findByTag should use tag param', async () => {
      setupMockResponse();

      await client.findByTag('ai');

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('tag=ai'),
        expect.any(Object)
      );
    });

    it('findBySkillTag should use skillTag param', async () => {
      setupMockResponse();

      await client.findBySkillTag('nlp');

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('skillTag=nlp'),
        expect.any(Object)
      );
    });

    it('findByContentMode should use contentMode param', async () => {
      setupMockResponse();

      await client.findByContentMode('image/png');

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('contentMode=image%2Fpng'),
        expect.any(Object)
      );
    });

    it('getTopRated should use sort=rating', async () => {
      setupMockResponse();

      await client.getTopRated(5);

      const url = mockFetch.mock.calls[0][0] as string;
      expect(url).toContain('sort=rating');
      expect(url).toContain('limit=5');
    });

    it('getPopular should use sort=popular', async () => {
      setupMockResponse();

      await client.getPopular(10);

      const url = mockFetch.mock.calls[0][0] as string;
      expect(url).toContain('sort=popular');
      expect(url).toContain('limit=10');
    });

    it('discoverTenantAgents should use scope=tenant', async () => {
      setupMockResponse();

      await client.discoverTenantAgents();

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('scope=tenant'),
        expect.any(Object)
      );
    });

    it('findByTag should accept additional options', async () => {
      setupMockResponse();

      await client.findByTag('ai', { sort: 'rating', limit: 5 });

      const url = mockFetch.mock.calls[0][0] as string;
      expect(url).toContain('tag=ai');
      expect(url).toContain('sort=rating');
      expect(url).toContain('limit=5');
    });
  });

  describe('DiscoverOptions type validation', () => {
    it('should accept all valid sort values', async () => {
      const sortValues: Array<'rating' | 'popular' | 'recent'> = ['rating', 'popular', 'recent'];

      for (const sort of sortValues) {
        setupMockResponse();
        await client.discover({ sort });
        expect(mockFetch).toHaveBeenCalled();
        mockFetch.mockReset();
      }
    });

    it('should accept tenant scope', async () => {
      setupMockResponse();
      await client.discover({ scope: 'tenant' });
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('scope=tenant'),
        expect.any(Object)
      );
    });
  });
});
