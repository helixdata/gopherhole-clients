import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'eventemitter3';
import {
  GopherHole,
  getTaskResponseText,
  Task,
  MessagePayload,
  DiscoverOptions,
} from '../src/index';

// Mock WebSocket
class MockWebSocket {
  static OPEN = 1;
  static CLOSED = 3;
  
  readyState = MockWebSocket.OPEN;
  onopen: (() => void) | null = null;
  onclose: ((event: { reason: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  
  private listeners: Map<string, Function[]> = new Map();
  
  constructor(public url: string, public options?: { headers?: Record<string, string> }) {
    // Simulate async connection
    setTimeout(() => {
      if (this.onopen) this.onopen();
    }, 0);
  }
  
  send(data: string) {
    // Mock send - can be spied on
  }
  
  close() {
    this.readyState = MockWebSocket.CLOSED;
    if (this.onclose) this.onclose({ reason: 'Connection closed' });
  }
  
  // Helper for tests to simulate messages
  simulateMessage(data: object) {
    if (this.onmessage) {
      this.onmessage({ data: JSON.stringify(data) });
    }
  }
}

// Mock fetch
const mockFetch = vi.fn();

// Setup global mocks
vi.stubGlobal('WebSocket', MockWebSocket);
vi.stubGlobal('fetch', mockFetch);

describe('GopherHole', () => {
  let client: GopherHole;

  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockReset();
  });

  afterEach(() => {
    if (client) {
      client.disconnect();
    }
  });

  describe('constructor', () => {
    it('should accept API key as string', () => {
      client = new GopherHole('gph_test_key');
      expect(client).toBeInstanceOf(GopherHole);
      expect(client).toBeInstanceOf(EventEmitter);
    });

    it('should accept options object', () => {
      client = new GopherHole({
        apiKey: 'gph_test_key',
        hubUrl: 'wss://custom.hub.ai/ws',
        autoReconnect: false,
        reconnectDelay: 2000,
        maxReconnectAttempts: 5,
        requestTimeout: 60000,
        messageTimeout: 45000,
      });
      expect(client).toBeInstanceOf(GopherHole);
      expect(client.getMessageTimeout()).toBe(45000);
    });

    it('should use default values when not specified', () => {
      client = new GopherHole('gph_test_key');
      expect(client.getMessageTimeout()).toBe(30000);
    });

    it('should accept agent card in options', () => {
      client = new GopherHole({
        apiKey: 'gph_test_key',
        agentCard: {
          name: 'Test Agent',
          description: 'A test agent',
          skills: [{ id: 'skill1', name: 'Skill 1' }],
        },
      });
      expect(client).toBeInstanceOf(GopherHole);
    });
  });

  describe('connect', () => {
    it('should establish WebSocket connection', async () => {
      client = new GopherHole('gph_test_key');
      
      const connectPromise = client.connect();
      
      // Resolve the promise
      await connectPromise;
      
      expect(client.connected).toBe(true);
    });

    it('should emit connect event', async () => {
      client = new GopherHole('gph_test_key');
      const connectHandler = vi.fn();
      client.on('connect', connectHandler);
      
      await client.connect();
      
      expect(connectHandler).toHaveBeenCalled();
    });
  });

  describe('disconnect', () => {
    it('should close WebSocket connection', async () => {
      client = new GopherHole('gph_test_key');
      await client.connect();
      
      client.disconnect();
      
      expect(client.connected).toBe(false);
    });

    it('should emit disconnect event', async () => {
      client = new GopherHole({
        apiKey: 'gph_test_key',
        autoReconnect: false,
      });
      const disconnectHandler = vi.fn();
      client.on('disconnect', disconnectHandler);
      
      await client.connect();
      client.disconnect();
      
      expect(disconnectHandler).toHaveBeenCalledWith('Connection closed');
    });
  });

  describe('send', () => {
    beforeEach(() => {
      mockFetch.mockResolvedValue({
        json: () => Promise.resolve({
          jsonrpc: '2.0',
          result: {
            id: 'task-123',
            contextId: 'ctx-456',
            status: { state: 'submitted', timestamp: new Date().toISOString() },
          },
          id: 1,
        }),
      });
    });

    it('should send message via RPC', async () => {
      client = new GopherHole('gph_test_key');
      
      const payload: MessagePayload = {
        role: 'agent',
        parts: [{ kind: 'text', text: 'Hello' }],
      };
      
      const task = await client.send('agent-id', payload);
      
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/a2a'),
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
            'Authorization': 'Bearer gph_test_key',
          }),
        })
      );
      expect(task.id).toBe('task-123');
    });

    it('should include options in configuration', async () => {
      client = new GopherHole('gph_test_key');
      
      const payload: MessagePayload = {
        role: 'agent',
        parts: [{ kind: 'text', text: 'Hello' }],
      };
      
      await client.send('agent-id', payload, { contextId: 'ctx-existing' });
      
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.params.configuration.contextId).toBe('ctx-existing');
    });
  });

  describe('sendText', () => {
    beforeEach(() => {
      mockFetch.mockResolvedValue({
        json: () => Promise.resolve({
          jsonrpc: '2.0',
          result: {
            id: 'task-123',
            contextId: 'ctx-456',
            status: { state: 'submitted', timestamp: new Date().toISOString() },
          },
          id: 1,
        }),
      });
    });

    it('should send text message', async () => {
      client = new GopherHole('gph_test_key');
      
      const task = await client.sendText('agent-id', 'Hello world');
      
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.params.message.role).toBe('agent');
      expect(body.params.message.parts[0]).toEqual({
        kind: 'text',
        text: 'Hello world',
      });
      expect(task.id).toBe('task-123');
    });
  });

  describe('getTask', () => {
    it('should fetch task by ID', async () => {
      mockFetch.mockResolvedValue({
        json: () => Promise.resolve({
          jsonrpc: '2.0',
          result: {
            id: 'task-123',
            contextId: 'ctx-456',
            status: { state: 'completed', timestamp: new Date().toISOString() },
            artifacts: [{ parts: [{ kind: 'text', text: 'Response' }] }],
          },
          id: 1,
        }),
      });

      client = new GopherHole('gph_test_key');
      const task = await client.getTask('task-123');
      
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.method).toBe('tasks/get');
      expect(body.params.id).toBe('task-123');
      expect(task.id).toBe('task-123');
    });

    it('should include historyLength when provided', async () => {
      mockFetch.mockResolvedValue({
        json: () => Promise.resolve({
          jsonrpc: '2.0',
          result: {
            id: 'task-123',
            contextId: 'ctx-456',
            status: { state: 'completed', timestamp: new Date().toISOString() },
          },
          id: 1,
        }),
      });

      client = new GopherHole('gph_test_key');
      await client.getTask('task-123', 10);
      
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.params.historyLength).toBe(10);
    });
  });

  describe('cancelTask', () => {
    it('should cancel task by ID', async () => {
      mockFetch.mockResolvedValue({
        json: () => Promise.resolve({
          jsonrpc: '2.0',
          result: {
            id: 'task-123',
            contextId: 'ctx-456',
            status: { state: 'canceled', timestamp: new Date().toISOString() },
          },
          id: 1,
        }),
      });

      client = new GopherHole('gph_test_key');
      const task = await client.cancelTask('task-123');
      
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.method).toBe('tasks/cancel');
      expect(task.status.state).toBe('canceled');
    });
  });

  describe('listTasks', () => {
    it('should list tasks', async () => {
      mockFetch.mockResolvedValue({
        json: () => Promise.resolve({
          jsonrpc: '2.0',
          result: {
            tasks: [
              { id: 'task-1', contextId: 'ctx-1', status: { state: 'completed' } },
              { id: 'task-2', contextId: 'ctx-2', status: { state: 'working' } },
            ],
            totalSize: 2,
          },
          id: 1,
        }),
      });

      client = new GopherHole('gph_test_key');
      const result = await client.listTasks({ pageSize: 10 });
      
      expect(result.tasks).toHaveLength(2);
      expect(result.totalSize).toBe(2);
    });
  });

  describe('respond', () => {
    it('should send response via WebSocket', async () => {
      client = new GopherHole('gph_test_key');
      await client.connect();
      
      // Get the mock WebSocket instance
      const ws = (client as any).ws as MockWebSocket;
      const sendSpy = vi.spyOn(ws, 'send');
      
      client.respond('task-123', 'Response text');
      
      expect(sendSpy).toHaveBeenCalled();
      const sentData = JSON.parse(sendSpy.mock.calls[0][0] as string);
      expect(sentData.type).toBe('task_response');
      expect(sentData.taskId).toBe('task-123');
      expect(sentData.artifact.parts[0].text).toBe('Response text');
    });

    it('should throw if not connected', () => {
      client = new GopherHole('gph_test_key');
      
      expect(() => client.respond('task-123', 'Response')).toThrow('WebSocket not connected');
    });
  });

  describe('respondError', () => {
    it('should send error response', async () => {
      client = new GopherHole('gph_test_key');
      await client.connect();
      
      const ws = (client as any).ws as MockWebSocket;
      const sendSpy = vi.spyOn(ws, 'send');
      
      client.respondError('task-123', 'Something went wrong');
      
      const sentData = JSON.parse(sendSpy.mock.calls[0][0] as string);
      expect(sentData.status.state).toBe('failed');
      expect(sentData.status.message).toBe('Something went wrong');
    });
  });

  describe('updateCard', () => {
    it('should update agent card and send to hub', async () => {
      client = new GopherHole('gph_test_key');
      await client.connect();
      
      const ws = (client as any).ws as MockWebSocket;
      const sendSpy = vi.spyOn(ws, 'send');
      
      await client.updateCard({
        name: 'Updated Agent',
        description: 'New description',
      });
      
      const sentData = JSON.parse(sendSpy.mock.calls[0][0] as string);
      expect(sentData.type).toBe('update_card');
      expect(sentData.agentCard.name).toBe('Updated Agent');
    });
  });

  describe('event handling', () => {
    it('should emit message event on incoming message', async () => {
      client = new GopherHole('gph_test_key');
      const messageHandler = vi.fn();
      client.on('message', messageHandler);
      
      await client.connect();
      
      const ws = (client as any).ws as MockWebSocket;
      ws.simulateMessage({
        type: 'message',
        from: 'other-agent',
        taskId: 'task-123',
        payload: { role: 'user', parts: [{ kind: 'text', text: 'Hello' }] },
        timestamp: Date.now(),
      });
      
      expect(messageHandler).toHaveBeenCalledWith(expect.objectContaining({
        from: 'other-agent',
        taskId: 'task-123',
      }));
    });

    it('should emit taskUpdate event', async () => {
      client = new GopherHole('gph_test_key');
      const taskUpdateHandler = vi.fn();
      client.on('taskUpdate', taskUpdateHandler);
      
      await client.connect();
      
      const ws = (client as any).ws as MockWebSocket;
      ws.simulateMessage({
        type: 'task_update',
        task: {
          id: 'task-123',
          contextId: 'ctx-456',
          status: { state: 'completed', timestamp: new Date().toISOString() },
        },
      });
      
      expect(taskUpdateHandler).toHaveBeenCalledWith(expect.objectContaining({
        id: 'task-123',
        status: expect.objectContaining({ state: 'completed' }),
      }));
    });

    it('should emit error event on parse failure', async () => {
      client = new GopherHole('gph_test_key');
      const errorHandler = vi.fn();
      client.on('error', errorHandler);
      
      await client.connect();
      
      const ws = (client as any).ws as MockWebSocket;
      if (ws.onmessage) {
        ws.onmessage({ data: 'invalid json' });
      }
      
      expect(errorHandler).toHaveBeenCalledWith(expect.any(Error));
    });

    it('should set agentId on welcome message', async () => {
      client = new GopherHole('gph_test_key');
      await client.connect();
      
      const ws = (client as any).ws as MockWebSocket;
      ws.simulateMessage({
        type: 'welcome',
        agentId: 'my-agent-123',
      });
      
      expect(client.id).toBe('my-agent-123');
    });
  });

  describe('RPC error handling', () => {
    it('should throw on RPC error', async () => {
      mockFetch.mockResolvedValue({
        json: () => Promise.resolve({
          jsonrpc: '2.0',
          error: { code: -32001, message: 'Task not found' },
          id: 1,
        }),
      });

      client = new GopherHole('gph_test_key');
      
      await expect(client.getTask('nonexistent')).rejects.toThrow('Task not found');
    });

    it('should handle request timeout', async () => {
      mockFetch.mockImplementation(() => new Promise((_, reject) => {
        const error = new Error('Abort');
        error.name = 'AbortError';
        setTimeout(() => reject(error), 10);
      }));

      client = new GopherHole({
        apiKey: 'gph_test_key',
        requestTimeout: 5,
      });
      
      await expect(client.getTask('task-123')).rejects.toThrow();
    });
  });
});

describe('getTaskResponseText', () => {
  it('should extract text from artifacts', () => {
    const task: Task = {
      id: 'task-123',
      contextId: 'ctx-456',
      status: { state: 'completed', timestamp: new Date().toISOString() },
      artifacts: [
        {
          parts: [
            { kind: 'text', text: 'First response' },
            { kind: 'text', text: 'Second response' },
          ],
        },
      ],
    };
    
    expect(getTaskResponseText(task)).toBe('First response\nSecond response');
  });

  it('should fallback to history when no artifacts', () => {
    const task: Task = {
      id: 'task-123',
      contextId: 'ctx-456',
      status: { state: 'completed', timestamp: new Date().toISOString() },
      history: [
        { role: 'user', parts: [{ kind: 'text', text: 'Question' }] },
        { role: 'agent', parts: [{ kind: 'text', text: 'Answer from history' }] },
      ],
    };
    
    expect(getTaskResponseText(task)).toBe('Answer from history');
  });

  it('should return empty string when no text found', () => {
    const task: Task = {
      id: 'task-123',
      contextId: 'ctx-456',
      status: { state: 'completed', timestamp: new Date().toISOString() },
    };
    
    expect(getTaskResponseText(task)).toBe('');
  });

  it('should skip non-text parts', () => {
    const task: Task = {
      id: 'task-123',
      contextId: 'ctx-456',
      status: { state: 'completed', timestamp: new Date().toISOString() },
      artifacts: [
        {
          parts: [
            { kind: 'file', mimeType: 'image/png', data: 'base64...' },
            { kind: 'text', text: 'Actual text' },
          ],
        },
      ],
    };
    
    expect(getTaskResponseText(task)).toBe('Actual text');
  });
});

describe('Discovery methods', () => {
  let client: GopherHole;

  beforeEach(() => {
    vi.clearAllMocks();
    client = new GopherHole('gph_test_key');
  });

  afterEach(() => {
    client.disconnect();
  });

  describe('discover', () => {
    it('should call discover endpoint with params', async () => {
      mockFetch.mockResolvedValue({
        json: () => Promise.resolve({
          agents: [
            { id: 'agent-1', name: 'Agent 1', avgRating: 4.5, ratingCount: 10 },
          ],
          count: 1,
          offset: 0,
        }),
      });

      const result = await client.discover({
        query: 'weather',
        category: 'utility',
        limit: 10,
      });
      
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/discover/agents'),
        expect.any(Object)
      );
      const url = mockFetch.mock.calls[0][0] as string;
      expect(url).toContain('q=weather');
      expect(url).toContain('category=utility');
      expect(url).toContain('limit=10');
      expect(result.agents).toHaveLength(1);
    });
  });

  describe('searchAgents', () => {
    it('should search agents by query', async () => {
      mockFetch.mockResolvedValue({
        json: () => Promise.resolve({ agents: [], count: 0, offset: 0 }),
      });

      await client.searchAgents('code assistant');
      
      const url = mockFetch.mock.calls[0][0] as string;
      // URL encoding may use + or %20 for spaces
      expect(url).toMatch(/q=code(\+|%20)assistant/);
    });
  });

  describe('findByCategory', () => {
    it('should filter by category', async () => {
      mockFetch.mockResolvedValue({
        json: () => Promise.resolve({ agents: [], count: 0, offset: 0 }),
      });

      await client.findByCategory('productivity');
      
      const url = mockFetch.mock.calls[0][0] as string;
      expect(url).toContain('category=productivity');
    });
  });

  describe('findByTag', () => {
    it('should filter by tag', async () => {
      mockFetch.mockResolvedValue({
        json: () => Promise.resolve({ agents: [], count: 0, offset: 0 }),
      });

      await client.findByTag('ai');
      
      const url = mockFetch.mock.calls[0][0] as string;
      expect(url).toContain('tag=ai');
    });
  });

  describe('findBySkillTag', () => {
    it('should filter by skill tag', async () => {
      mockFetch.mockResolvedValue({
        json: () => Promise.resolve({ agents: [], count: 0, offset: 0 }),
      });

      await client.findBySkillTag('summarization');
      
      const url = mockFetch.mock.calls[0][0] as string;
      expect(url).toContain('skillTag=summarization');
    });
  });

  describe('findByContentMode', () => {
    it('should filter by content mode', async () => {
      mockFetch.mockResolvedValue({
        json: () => Promise.resolve({ agents: [], count: 0, offset: 0 }),
      });

      await client.findByContentMode('text/markdown');
      
      const url = mockFetch.mock.calls[0][0] as string;
      expect(url).toContain('contentMode=text%2Fmarkdown');
    });
  });

  describe('getTopRated', () => {
    it('should get top rated agents', async () => {
      mockFetch.mockResolvedValue({
        json: () => Promise.resolve({ agents: [], count: 0, offset: 0 }),
      });

      await client.getTopRated(5);
      
      const url = mockFetch.mock.calls[0][0] as string;
      expect(url).toContain('sort=rating');
      expect(url).toContain('limit=5');
    });
  });

  describe('getPopular', () => {
    it('should get popular agents', async () => {
      mockFetch.mockResolvedValue({
        json: () => Promise.resolve({ agents: [], count: 0, offset: 0 }),
      });

      await client.getPopular(5);
      
      const url = mockFetch.mock.calls[0][0] as string;
      expect(url).toContain('sort=popular');
    });
  });

  describe('getFeatured', () => {
    it('should get featured agents', async () => {
      mockFetch.mockResolvedValue({
        json: () => Promise.resolve({ featured: [{ id: 'featured-1' }] }),
      });

      const result = await client.getFeatured();
      
      const url = mockFetch.mock.calls[0][0] as string;
      expect(url).toContain('/api/discover/featured');
      expect(result.featured).toHaveLength(1);
    });
  });

  describe('getCategories', () => {
    it('should get available categories', async () => {
      mockFetch.mockResolvedValue({
        json: () => Promise.resolve({
          categories: [
            { name: 'productivity', count: 10 },
            { name: 'utility', count: 5 },
          ],
        }),
      });

      const result = await client.getCategories();
      
      expect(result.categories).toHaveLength(2);
      expect(result.categories[0].name).toBe('productivity');
    });
  });

  describe('getAgentInfo', () => {
    it('should get detailed agent info', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          agent: { id: 'agent-1', name: 'Agent 1' },
          reviews: [],
        }),
      });

      const result = await client.getAgentInfo('agent-1');
      
      const url = mockFetch.mock.calls[0][0] as string;
      expect(url).toContain('/api/discover/agents/agent-1');
      expect(result.agent.id).toBe('agent-1');
    });

    it('should throw on agent not found', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        json: () => Promise.resolve({ error: 'Not found' }),
      });

      await expect(client.getAgentInfo('nonexistent')).rejects.toThrow('Agent not found');
    });
  });

  describe('rateAgent', () => {
    it('should rate an agent', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          success: true,
          avgRating: 4.5,
          ratingCount: 11,
        }),
      });

      const result = await client.rateAgent('agent-1', 5, 'Great agent!');
      
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/discover/agents/agent-1/rate'),
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ rating: 5, review: 'Great agent!' }),
        })
      );
      expect(result.avgRating).toBe(4.5);
    });

    it('should throw on rating failure', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        json: () => Promise.resolve({ error: 'Already rated' }),
      });

      await expect(client.rateAgent('agent-1', 5)).rejects.toThrow('Already rated');
    });
  });

  describe('findBestAgent', () => {
    it('should find best matching agent', async () => {
      mockFetch.mockResolvedValue({
        json: () => Promise.resolve({
          agents: [
            { id: 'agent-1', avgRating: 4.8, pricing: 'free' },
            { id: 'agent-2', avgRating: 4.5, pricing: 'paid' },
          ],
          count: 2,
          offset: 0,
        }),
      });

      const agent = await client.findBestAgent('code help');
      
      expect(agent?.id).toBe('agent-1');
    });

    it('should filter by minRating', async () => {
      mockFetch.mockResolvedValue({
        json: () => Promise.resolve({
          agents: [
            { id: 'agent-1', avgRating: 3.5, pricing: 'free' },
            { id: 'agent-2', avgRating: 4.5, pricing: 'free' },
          ],
          count: 2,
          offset: 0,
        }),
      });

      const agent = await client.findBestAgent('code', { minRating: 4.0 });
      
      expect(agent?.id).toBe('agent-2');
    });

    it('should filter by pricing', async () => {
      mockFetch.mockResolvedValue({
        json: () => Promise.resolve({
          agents: [
            { id: 'agent-1', avgRating: 4.8, pricing: 'paid' },
            { id: 'agent-2', avgRating: 4.5, pricing: 'free' },
          ],
          count: 2,
          offset: 0,
        }),
      });

      const agent = await client.findBestAgent('code', { pricing: 'free' });
      
      expect(agent?.id).toBe('agent-2');
    });

    it('should return null when no match', async () => {
      mockFetch.mockResolvedValue({
        json: () => Promise.resolve({ agents: [], count: 0, offset: 0 }),
      });

      const agent = await client.findBestAgent('nonexistent');
      
      expect(agent).toBeNull();
    });
  });

  describe('findSimilar', () => {
    it('should find similar agents', async () => {
      // First call for getAgentInfo
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          agent: { id: 'agent-1', name: 'Agent 1', category: 'productivity' },
          reviews: [],
        }),
      });
      
      // Second call for discover
      mockFetch.mockResolvedValueOnce({
        json: () => Promise.resolve({
          agents: [
            { id: 'agent-1' },
            { id: 'agent-2' },
            { id: 'agent-3' },
          ],
          count: 3,
          offset: 0,
        }),
      });

      const result = await client.findSimilar('agent-1', 2);
      
      // Should filter out the original agent
      expect(result.agents.some(a => a.id === 'agent-1')).toBe(false);
      expect(result.agents).toHaveLength(2);
    });
  });
});
