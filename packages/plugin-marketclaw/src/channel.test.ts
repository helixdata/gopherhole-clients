/**
 * Unit tests for MarketClaw plugin discovery methods
 * Tests the new discovery params: tag, skillTag, contentMode, sort, offset, scope
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { A2AChannel } from './channel';

// Mock @gopherhole/sdk
const mockDiscover = vi.fn();
vi.mock('@gopherhole/sdk', () => ({
  GopherHole: vi.fn().mockImplementation(() => ({
    connect: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn(),
    on: vi.fn(),
    connected: true,
    id: 'test-agent',
    discover: mockDiscover,
  })),
  getTaskResponseText: vi.fn(),
}));

// Mock WebSocket
vi.mock('ws', () => ({
  default: vi.fn(),
}));

describe('A2AChannel Discovery', () => {
  let channel: A2AChannel;
  const mockApiKey = 'gph_test_key';

  beforeEach(async () => {
    channel = new A2AChannel();
    mockDiscover.mockReset();
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
        tags: ['testing', 'demo'],
      },
    ],
    count: 1,
    offset: 0,
  };

  describe('discoverAgents() with new params', () => {
    it('should call discover with tag param', async () => {
      mockDiscover.mockResolvedValueOnce(mockDiscoverResponse);
      
      // Initialize with GopherHole config
      await channel.initialize({
        enabled: true,
        gopherhole: {
          enabled: true,
          apiKey: mockApiKey,
        },
      });
      await channel.start();

      await channel.discoverAgents({ tag: 'ai' });

      expect(mockDiscover).toHaveBeenCalledWith(
        expect.objectContaining({ tag: 'ai', limit: 50 })
      );
    });

    it('should call discover with skillTag param', async () => {
      mockDiscover.mockResolvedValueOnce(mockDiscoverResponse);
      
      await channel.initialize({
        enabled: true,
        gopherhole: { enabled: true, apiKey: mockApiKey },
      });
      await channel.start();

      await channel.discoverAgents({ skillTag: 'nlp' });

      expect(mockDiscover).toHaveBeenCalledWith(
        expect.objectContaining({ skillTag: 'nlp' })
      );
    });

    it('should call discover with contentMode param', async () => {
      mockDiscover.mockResolvedValueOnce(mockDiscoverResponse);
      
      await channel.initialize({
        enabled: true,
        gopherhole: { enabled: true, apiKey: mockApiKey },
      });
      await channel.start();

      await channel.discoverAgents({ contentMode: 'text/markdown' });

      expect(mockDiscover).toHaveBeenCalledWith(
        expect.objectContaining({ contentMode: 'text/markdown' })
      );
    });

    it('should call discover with sort param', async () => {
      mockDiscover.mockResolvedValueOnce(mockDiscoverResponse);
      
      await channel.initialize({
        enabled: true,
        gopherhole: { enabled: true, apiKey: mockApiKey },
      });
      await channel.start();

      await channel.discoverAgents({ sort: 'rating' });

      expect(mockDiscover).toHaveBeenCalledWith(
        expect.objectContaining({ sort: 'rating' })
      );
    });

    it('should call discover with offset param', async () => {
      mockDiscover.mockResolvedValueOnce(mockDiscoverResponse);
      
      await channel.initialize({
        enabled: true,
        gopherhole: { enabled: true, apiKey: mockApiKey },
      });
      await channel.start();

      await channel.discoverAgents({ offset: 20 });

      expect(mockDiscover).toHaveBeenCalledWith(
        expect.objectContaining({ offset: 20 })
      );
    });

    it('should call discover with scope=tenant', async () => {
      mockDiscover.mockResolvedValueOnce(mockDiscoverResponse);
      
      await channel.initialize({
        enabled: true,
        gopherhole: { enabled: true, apiKey: mockApiKey },
      });
      await channel.start();

      await channel.discoverAgents({ scope: 'tenant' });

      expect(mockDiscover).toHaveBeenCalledWith(
        expect.objectContaining({ scope: 'tenant' })
      );
    });
  });

  describe('discoverAgents() with combined params', () => {
    it('should combine multiple params', async () => {
      mockDiscover.mockResolvedValueOnce(mockDiscoverResponse);
      
      await channel.initialize({
        enabled: true,
        gopherhole: { enabled: true, apiKey: mockApiKey },
      });
      await channel.start();

      await channel.discoverAgents({
        query: 'marketing',
        tag: 'ai',
        skillTag: 'content',
        sort: 'popular',
        offset: 10,
      });

      expect(mockDiscover).toHaveBeenCalledWith(
        expect.objectContaining({
          query: 'marketing',
          tag: 'ai',
          skillTag: 'content',
          sort: 'popular',
          offset: 10,
          limit: 50,
        })
      );
    });
  });

  describe('discoverAgents() edge cases', () => {
    it('should return empty array when not connected', async () => {
      // Don't initialize - gopherhole client will be null
      const result = await channel.discoverAgents({ tag: 'test' });
      expect(result).toEqual([]);
    });

    it('should handle discover errors gracefully', async () => {
      mockDiscover.mockRejectedValueOnce(new Error('Network error'));
      
      await channel.initialize({
        enabled: true,
        gopherhole: { enabled: true, apiKey: mockApiKey },
      });
      await channel.start();

      const result = await channel.discoverAgents({ tag: 'test' });
      expect(result).toEqual([]);
    });

    it('should map response to expected format', async () => {
      mockDiscover.mockResolvedValueOnce({
        agents: [
          {
            id: 'agent-1',
            name: 'Test Agent',
            description: 'A test agent',
            tags: ['marketing', 'ai'],
          },
        ],
        count: 1,
        offset: 0,
      });
      
      await channel.initialize({
        enabled: true,
        gopherhole: { enabled: true, apiKey: mockApiKey },
      });
      await channel.start();

      const result = await channel.discoverAgents({ query: 'marketing' });

      expect(result).toEqual([
        {
          id: 'agent-1',
          name: 'Test Agent',
          description: 'A test agent',
          skills: ['marketing', 'ai'],
        },
      ]);
    });
  });

  describe('discoverAgents() sort values', () => {
    beforeEach(async () => {
      await channel.initialize({
        enabled: true,
        gopherhole: { enabled: true, apiKey: mockApiKey },
      });
      await channel.start();
    });

    it('should accept rating sort', async () => {
      mockDiscover.mockResolvedValueOnce(mockDiscoverResponse);
      await channel.discoverAgents({ sort: 'rating' });
      expect(mockDiscover).toHaveBeenCalledWith(
        expect.objectContaining({ sort: 'rating' })
      );
    });

    it('should accept popular sort', async () => {
      mockDiscover.mockResolvedValueOnce(mockDiscoverResponse);
      await channel.discoverAgents({ sort: 'popular' });
      expect(mockDiscover).toHaveBeenCalledWith(
        expect.objectContaining({ sort: 'popular' })
      );
    });

    it('should accept recent sort', async () => {
      mockDiscover.mockResolvedValueOnce(mockDiscoverResponse);
      await channel.discoverAgents({ sort: 'recent' });
      expect(mockDiscover).toHaveBeenCalledWith(
        expect.objectContaining({ sort: 'recent' })
      );
    });
  });

  describe('listAgents()', () => {
    it('should include gopherhole when connected', async () => {
      await channel.initialize({
        enabled: true,
        gopherhole: { enabled: true, apiKey: mockApiKey },
      });
      await channel.start();

      const agents = channel.listAgents();

      expect(agents).toContainEqual(
        expect.objectContaining({
          id: 'gopherhole',
          name: 'GopherHole Hub',
          connected: true,
        })
      );
    });
  });

  describe('isGopherHoleConnected()', () => {
    it('should return false when not initialized', () => {
      expect(channel.isGopherHoleConnected()).toBe(false);
    });

    it('should return true when connected', async () => {
      await channel.initialize({
        enabled: true,
        gopherhole: { enabled: true, apiKey: mockApiKey },
      });
      await channel.start();

      expect(channel.isGopherHoleConnected()).toBe(true);
    });
  });
});
