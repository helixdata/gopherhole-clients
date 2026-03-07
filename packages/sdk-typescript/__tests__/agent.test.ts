import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  GopherHoleAgent,
  GopherHoleAgentOptions,
  IncomingMessage,
  AgentTaskResult,
  MessageContext,
} from '../src/agent';
import { AgentCard } from '../src/types';

describe('GopherHoleAgent', () => {
  const mockCard: AgentCard = {
    name: 'Test Agent',
    description: 'A test agent for unit tests',
    url: 'https://test.agent.ai',
    version: '1.0.0',
    capabilities: {
      streaming: false,
      pushNotifications: false,
    },
    skills: [
      {
        id: 'echo',
        name: 'Echo',
        description: 'Echoes back messages',
        tags: ['utility'],
      },
    ],
  };

  let agent: GopherHoleAgent;
  let messageHandler: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    messageHandler = vi.fn().mockResolvedValue('Response');
    agent = new GopherHoleAgent({
      card: mockCard,
      apiKey: 'gph_test_key',
      onMessage: messageHandler,
    });
  });

  describe('constructor', () => {
    it('should create agent with options', () => {
      expect(agent).toBeInstanceOf(GopherHoleAgent);
    });
  });

  describe('getCard', () => {
    it('should return the agent card', () => {
      expect(agent.getCard()).toEqual(mockCard);
    });
  });

  describe('verifyAuth', () => {
    it('should verify valid auth header', () => {
      expect(agent.verifyAuth('Bearer gph_test_key')).toBe(true);
    });

    it('should reject invalid auth header', () => {
      expect(agent.verifyAuth('Bearer wrong_key')).toBe(false);
      expect(agent.verifyAuth(null)).toBe(false);
    });

    it('should pass any auth when no apiKey configured', () => {
      const noAuthAgent = new GopherHoleAgent({
        card: mockCard,
        onMessage: messageHandler,
      });
      expect(noAuthAgent.verifyAuth(null)).toBe(true);
      expect(noAuthAgent.verifyAuth('any')).toBe(true);
    });
  });

  describe('handleRequest', () => {
    it('should handle CORS preflight', async () => {
      const request = new Request('https://test.agent.ai/', {
        method: 'OPTIONS',
      });

      const response = await agent.handleRequest(request);
      
      expect(response.status).toBe(200);
      expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
      expect(response.headers.get('Access-Control-Allow-Methods')).toContain('POST');
    });

    it('should serve agent card at /.well-known/agent.json', async () => {
      const request = new Request('https://test.agent.ai/.well-known/agent.json');

      const response = await agent.handleRequest(request);
      const data = await response.json();
      
      expect(data.name).toBe('Test Agent');
      expect(data.version).toBe('1.0.0');
    });

    it('should serve agent card at /agent.json', async () => {
      const request = new Request('https://test.agent.ai/agent.json');

      const response = await agent.handleRequest(request);
      const data = await response.json();
      
      expect(data.name).toBe('Test Agent');
    });

    it('should serve health check at /health', async () => {
      const request = new Request('https://test.agent.ai/health');

      const response = await agent.handleRequest(request);
      const data = await response.json();
      
      expect(data.status).toBe('ok');
      expect(data.agent).toBe('Test Agent');
    });

    it('should return 404 for unknown paths', async () => {
      const request = new Request('https://test.agent.ai/unknown');

      const response = await agent.handleRequest(request);
      
      expect(response.status).toBe(404);
    });

    it('should reject unauthorized POST requests', async () => {
      const request = new Request('https://test.agent.ai/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          method: 'message/send',
          params: {},
          id: 1,
        }),
      });

      const response = await agent.handleRequest(request);
      
      expect(response.status).toBe(401);
    });

    it('should handle message/send method', async () => {
      const request = new Request('https://test.agent.ai/', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer gph_test_key',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          method: 'message/send',
          params: {
            message: {
              role: 'user',
              parts: [{ kind: 'text', text: 'Hello agent!' }],
            },
          },
          id: 1,
        }),
      });

      const response = await agent.handleRequest(request);
      const data = await response.json();
      
      expect(data.jsonrpc).toBe('2.0');
      expect(data.result).toBeDefined();
      expect(data.result.status.state).toBe('completed');
      expect(messageHandler).toHaveBeenCalledWith(expect.objectContaining({
        text: 'Hello agent!',
      }));
    });

    it('should handle /a2a path', async () => {
      const request = new Request('https://test.agent.ai/a2a', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer gph_test_key',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          method: 'message/send',
          params: {
            message: {
              role: 'user',
              parts: [{ kind: 'text', text: 'Test' }],
            },
          },
          id: 1,
        }),
      });

      const response = await agent.handleRequest(request);
      const data = await response.json();
      
      expect(data.result).toBeDefined();
    });

    it('should return parse error for invalid JSON', async () => {
      const request = new Request('https://test.agent.ai/', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer gph_test_key',
        },
        body: 'invalid json',
      });

      const response = await agent.handleRequest(request);
      const data = await response.json();
      
      expect(response.status).toBe(400);
      expect(data.error.code).toBe(-32700);
    });
  });

  describe('handleJsonRpc', () => {
    it('should handle message/send', async () => {
      const response = await agent.handleJsonRpc({
        jsonrpc: '2.0',
        method: 'message/send',
        params: {
          message: {
            role: 'user',
            parts: [{ kind: 'text', text: 'Hello' }],
          },
        },
        id: 1,
      });

      expect(response.result).toBeDefined();
      expect(response.id).toBe(1);
    });

    it('should return error for tasks/get', async () => {
      const response = await agent.handleJsonRpc({
        jsonrpc: '2.0',
        method: 'tasks/get',
        params: { id: 'task-123' },
        id: 1,
      });

      expect(response.error).toBeDefined();
      expect(response.error?.code).toBe(-32601);
    });

    it('should return error for tasks/cancel', async () => {
      const response = await agent.handleJsonRpc({
        jsonrpc: '2.0',
        method: 'tasks/cancel',
        params: { id: 'task-123' },
        id: 1,
      });

      expect(response.error).toBeDefined();
      expect(response.error?.code).toBe(-32601);
    });

    it('should return method not found for unknown methods', async () => {
      const response = await agent.handleJsonRpc({
        jsonrpc: '2.0',
        method: 'unknown/method',
        params: {},
        id: 1,
      });

      expect(response.error).toBeDefined();
      expect(response.error?.code).toBe(-32601);
      expect(response.error?.message).toContain('unknown/method');
    });

    it('should return error for invalid message params', async () => {
      const response = await agent.handleJsonRpc({
        jsonrpc: '2.0',
        method: 'message/send',
        params: {
          // Missing message or parts
        },
        id: 1,
      });

      expect(response.error).toBeDefined();
      expect(response.error?.code).toBe(-32602);
    });

    it('should handle handler returning AgentTaskResult', async () => {
      const customResult: AgentTaskResult = {
        id: 'custom-task-123',
        contextId: 'custom-ctx',
        status: { state: 'completed', timestamp: new Date().toISOString() },
        messages: [],
      };
      
      messageHandler.mockResolvedValueOnce(customResult);

      const response = await agent.handleJsonRpc({
        jsonrpc: '2.0',
        method: 'message/send',
        params: {
          message: {
            role: 'user',
            parts: [{ kind: 'text', text: 'Hello' }],
          },
        },
        id: 1,
      });

      expect(response.result).toEqual(customResult);
    });

    it('should handle handler errors', async () => {
      messageHandler.mockRejectedValueOnce(new Error('Handler failed'));

      const response = await agent.handleJsonRpc({
        jsonrpc: '2.0',
        method: 'message/send',
        params: {
          message: {
            role: 'user',
            parts: [{ kind: 'text', text: 'Hello' }],
          },
        },
        id: 1,
      });

      expect(response.error).toBeDefined();
      expect(response.error?.code).toBe(-32000);
      expect(response.error?.message).toBe('Handler failed');
    });

    it('should extract text from multiple parts', async () => {
      let capturedCtx: MessageContext | null = null;
      messageHandler.mockImplementation((ctx) => {
        capturedCtx = ctx;
        return 'Response';
      });

      await agent.handleJsonRpc({
        jsonrpc: '2.0',
        method: 'message/send',
        params: {
          message: {
            role: 'user',
            parts: [
              { kind: 'text', text: 'First line' },
              { kind: 'text', text: 'Second line' },
            ],
          },
        },
        id: 1,
      });

      expect(capturedCtx?.text).toBe('First line\nSecond line');
    });

    it('should pass contextId from configuration', async () => {
      let capturedCtx: MessageContext | null = null;
      messageHandler.mockImplementation((ctx) => {
        capturedCtx = ctx;
        return 'Response';
      });

      await agent.handleJsonRpc({
        jsonrpc: '2.0',
        method: 'message/send',
        params: {
          message: {
            role: 'user',
            parts: [{ kind: 'text', text: 'Hello' }],
          },
          configuration: {
            contextId: 'ctx-123',
          },
        },
        id: 1,
      });

      expect(capturedCtx?.contextId).toBe('ctx-123');
    });
  });

  describe('createTaskResult', () => {
    it('should create a complete task result', () => {
      const message: IncomingMessage = {
        role: 'user',
        parts: [{ kind: 'text', text: 'Hello' }],
      };

      const result = agent.createTaskResult(message, 'Response text', 'ctx-123');
      
      expect(result.id).toMatch(/^task-/);
      expect(result.contextId).toBe('ctx-123');
      expect(result.status.state).toBe('completed');
      expect(result.messages).toHaveLength(2);
      expect(result.messages[0]).toEqual(message);
      expect(result.messages[1].role).toBe('agent');
      expect(result.messages[1].parts[0]).toEqual({
        kind: 'text',
        text: 'Response text',
      });
    });

    it('should generate contextId when not provided', () => {
      const message: IncomingMessage = {
        role: 'user',
        parts: [{ kind: 'text', text: 'Hello' }],
      };

      const result = agent.createTaskResult(message, 'Response');
      
      expect(result.contextId).toMatch(/^ctx-/);
    });
  });

  describe('static helpers', () => {
    it('textPart should create text part', () => {
      const part = GopherHoleAgent.textPart('Hello');
      expect(part).toEqual({ kind: 'text', text: 'Hello' });
    });

    it('filePart should create file part', () => {
      const part = GopherHoleAgent.filePart('https://example.com/file.pdf', 'application/pdf');
      expect(part).toEqual({
        kind: 'file',
        uri: 'https://example.com/file.pdf',
        mimeType: 'application/pdf',
      });
    });

    it('dataPart should create data part', () => {
      const part = GopherHoleAgent.dataPart('base64data', 'image/png');
      expect(part).toEqual({
        kind: 'data',
        data: 'base64data',
        mimeType: 'image/png',
      });
    });
  });

  describe('synchronous handlers', () => {
    it('should handle sync string response', async () => {
      const syncAgent = new GopherHoleAgent({
        card: mockCard,
        apiKey: 'gph_test_key',
        onMessage: () => 'Sync response', // Not async
      });

      const response = await syncAgent.handleJsonRpc({
        jsonrpc: '2.0',
        method: 'message/send',
        params: {
          message: {
            role: 'user',
            parts: [{ kind: 'text', text: 'Hello' }],
          },
        },
        id: 1,
      });

      expect(response.result).toBeDefined();
      expect((response.result as AgentTaskResult).messages[1].parts[0]).toEqual({
        kind: 'text',
        text: 'Sync response',
      });
    });
  });
});
