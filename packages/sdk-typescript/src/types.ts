/**
 * A2A Protocol Types
 * Based on Google's Agent-to-Agent Protocol specification
 */

// ============ Core Types ============

export interface AgentCard {
  name: string;
  description?: string;
  url: string;
  provider?: {
    organization: string;
    url?: string;
  };
  version: string;
  documentationUrl?: string;
  capabilities: AgentCapabilities;
  authentication?: AgentAuthentication;
  defaultInputModes?: InputMode[];
  defaultOutputModes?: OutputMode[];
  skills?: AgentSkill[];
}

export interface AgentCapabilities {
  streaming?: boolean;
  pushNotifications?: boolean;
  stateTransitionHistory?: boolean;
}

export interface AgentAuthentication {
  schemes: string[];
  credentials?: string;
}

export interface AgentSkill {
  id: string;
  name: string;
  description?: string;
  tags?: string[];
  examples?: string[];
  inputModes?: ContentMode[];
  outputModes?: ContentMode[];
}

/**
 * Content mode - MIME type string or legacy shorthand
 * Examples: 'text/plain', 'text/markdown', 'application/json', 'image/png'
 * Legacy: 'text', 'file', 'data' (still supported for backwards compat)
 */
export type ContentMode = string;

// Legacy type aliases for backwards compatibility
export type InputMode = ContentMode;
export type OutputMode = ContentMode;

// ============ Message Types ============

export interface A2AMessage {
  role: 'user' | 'agent';
  parts: Part[];
  metadata?: Record<string, unknown>;
}

export type Part = TextPart | FilePart | DataPart;

export interface TextPart {
  kind: 'text';
  text: string;
}

export interface FilePart {
  kind: 'file';
  file: FileContent;
}

export interface DataPart {
  kind: 'data';
  data: DataContent;
}

export interface FileContent {
  name?: string;
  mimeType?: string;
  bytes?: string; // base64
  uri?: string;
}

export interface DataContent {
  mimeType: string;
  data: string; // JSON string
}

// ============ Task Types ============

export interface A2ATask {
  id: string;
  contextId: string;
  status: A2ATaskStatus;
  history?: A2AMessage[];
  artifacts?: A2AArtifact[];
  metadata?: Record<string, unknown>;
}

export interface A2ATaskStatus {
  state: TaskState;
  timestamp: string;
  message?: A2AMessage;
}

export type TaskState =
  | 'submitted'
  | 'working'
  | 'input-required'
  | 'completed'
  | 'failed'
  | 'canceled'
  | 'rejected'
  | 'auth-required';

export interface A2AArtifact {
  name?: string;
  description?: string;
  parts: Part[];
  index?: number;
  append?: boolean;
  lastChunk?: boolean;
  metadata?: Record<string, unknown>;
}

// ============ JSON-RPC Types ============

export interface JsonRpcRequest {
  jsonrpc: '2.0';
  method: string;
  params?: Record<string, unknown>;
  id: string | number;
}

export interface JsonRpcResponse<T = unknown> {
  jsonrpc: '2.0';
  result?: T;
  error?: JsonRpcError;
  id: string | number;
}

export interface JsonRpcError {
  code: number;
  message: string;
  data?: unknown;
}

// Standard JSON-RPC error codes
export const JsonRpcErrorCodes = {
  ParseError: -32700,
  InvalidRequest: -32600,
  MethodNotFound: -32601,
  InvalidParams: -32602,
  InternalError: -32603,
  // A2A-specific errors
  TaskNotFound: -32001,
  TaskNotCancelable: -32002,
  PushNotificationNotSupported: -32003,
  UnsupportedOperation: -32004,
  ContentTypeNotSupported: -32005,
  InvalidAgentCard: -32006,
  // Queue errors (GopherHole extension)
  QueueFull: -32012,
  SenderThrottled: -32013,
  TenantQueueFull: -32014,
} as const;

// ============ Push Notification Types ============

export interface PushNotificationConfig {
  url: string;
  token?: string;
  authentication?: {
    scheme: string;
    credentials?: string;
  };
}

export interface TaskPushNotificationConfig {
  id: string;
  taskId: string;
  url: string;
  token?: string;
  authentication?: {
    scheme: string;
    credentials?: string;
  };
}

// ============ Configuration Types ============

export interface MessageSendConfiguration {
  agentId?: string;
  contextId?: string;
  historyLength?: number;
  pushNotificationConfig?: PushNotificationConfig;
  blocking?: boolean;
  acceptedOutputModes?: OutputMode[];
}

export interface TaskQueryConfiguration {
  id: string;
  historyLength?: number;
}

export interface TaskListConfiguration {
  contextId?: string;
  pageSize?: number;
  pageToken?: string;
  sortOrder?: 'asc' | 'desc';
  includeArtifacts?: boolean;
}

// ============ Event Types ============

export interface TaskStatusUpdateEvent {
  type: 'status';
  taskId: string;
  contextId: string;
  status: A2ATaskStatus;
  final: boolean;
}

export interface TaskArtifactUpdateEvent {
  type: 'artifact';
  taskId: string;
  contextId: string;
  artifact: A2AArtifact;
}

export type TaskEvent = TaskStatusUpdateEvent | TaskArtifactUpdateEvent;

// ============ Workspace Types (GopherHole Extension) ============

export const MEMORY_TYPES = ['fact', 'decision', 'preference', 'todo', 'context', 'reference'] as const;
export type MemoryType = typeof MEMORY_TYPES[number];

export interface Workspace {
  id: string;
  owner_agent_id: string;
  name: string;
  description: string | null;
  created_at: number;
  updated_at: number;
  member_count?: number;
  memory_count?: number;
  my_role?: 'read' | 'write' | 'admin';
}

export interface WorkspaceMember {
  agent_id: string;
  agent_name?: string;
  role: 'read' | 'write' | 'admin';
  added_at: number;
}

export interface WorkspaceMemory {
  id: string;
  workspace_id: string;
  content: string;
  type: MemoryType;
  tags: string[];
  links: string[];
  similarity?: number;
  confidence?: number;
  source_task_id?: string;
  created_at: number;
  created_by: string | null;
  updated_at?: number;
  updated_by?: string | null;
}

export interface MemoryTypeInfo {
  id: MemoryType;
  description: string;
}

export interface WorkspaceStoreParams {
  workspace_id: string;
  content: string;
  type: MemoryType;
  tags?: string[];
  links?: string[];
  source_task_id?: string;
  expires?: string;
  confidence?: number;
  metadata?: Record<string, unknown>;
}

export interface WorkspaceQueryParams {
  workspace_id: string;
  query: string;
  type?: MemoryType;
  limit?: number;
  threshold?: number;
  tags?: string[];
}

export interface WorkspaceUpdateParams {
  workspace_id: string;
  id: string;
  content?: string;
  type?: MemoryType;
  tags?: string[];
  links?: string[];
  confidence?: number;
  metadata?: Record<string, unknown>;
}

export interface WorkspaceForgetParams {
  workspace_id: string;
  id?: string;
  query?: string;
}

export interface WorkspaceListMemoriesParams {
  workspace_id: string;
  limit?: number;
  offset?: number;
  type?: MemoryType;
  tags?: string[];
}

export interface SecretInfo {
  key: string;
  created_at: number;
  updated_at?: number;
}
