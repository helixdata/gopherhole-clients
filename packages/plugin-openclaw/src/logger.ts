/**
 * A2A Plugin Logger
 * Writes to both console and a dedicated log file for dashboard viewing
 */

import { appendFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const LOG_DIR = join(homedir(), '.openclaw', 'logs');
const A2A_LOG_FILE = join(LOG_DIR, 'a2a.log');

// Ensure log directory exists
try {
  if (!existsSync(LOG_DIR)) {
    mkdirSync(LOG_DIR, { recursive: true });
  }
} catch {
  // Ignore if we can't create the directory
}

export interface A2ALogEntry {
  timestamp: string;
  level: 'info' | 'warn' | 'error' | 'debug';
  event: string;
  taskId?: string;
  from?: string;
  to?: string;
  message?: string;
  data?: Record<string, unknown>;
}

function writeLog(entry: A2ALogEntry): void {
  const line = JSON.stringify(entry) + '\n';
  
  // Console output (colored)
  const prefix = `[a2a:${entry.event}]`;
  const msg = entry.message || '';
  
  switch (entry.level) {
    case 'error':
      console.error(prefix, msg, entry.data || '');
      break;
    case 'warn':
      console.warn(prefix, msg, entry.data || '');
      break;
    default:
      console.log(prefix, msg, entry.data || '');
  }
  
  // File output (JSON lines)
  try {
    appendFileSync(A2A_LOG_FILE, line);
  } catch {
    // Ignore file write errors
  }
}

export const a2aLog = {
  info(event: string, message: string, data?: Record<string, unknown>): void {
    writeLog({ timestamp: new Date().toISOString(), level: 'info', event, message, data });
  },
  
  warn(event: string, message: string, data?: Record<string, unknown>): void {
    writeLog({ timestamp: new Date().toISOString(), level: 'warn', event, message, data });
  },
  
  error(event: string, message: string, data?: Record<string, unknown>): void {
    writeLog({ timestamp: new Date().toISOString(), level: 'error', event, message, data });
  },
  
  // Structured event logging for dashboard
  messageReceived(from: string, taskId: string | undefined, text: string): void {
    writeLog({
      timestamp: new Date().toISOString(),
      level: 'info',
      event: 'message_received',
      from,
      taskId,
      message: text.slice(0, 200),
      data: { textLength: text.length },
    });
  },
  
  messageProcessing(taskId: string | undefined, sessionKey: string): void {
    writeLog({
      timestamp: new Date().toISOString(),
      level: 'info',
      event: 'message_processing',
      taskId,
      data: { sessionKey },
    });
  },
  
  responseCaptured(taskId: string | undefined, text: string): void {
    writeLog({
      timestamp: new Date().toISOString(),
      level: 'info',
      event: 'response_captured',
      taskId,
      message: text.slice(0, 200),
      data: { textLength: text.length },
    });
  },
  
  responseSent(taskId: string, to: string, success: boolean): void {
    writeLog({
      timestamp: new Date().toISOString(),
      level: success ? 'info' : 'error',
      event: 'response_sent',
      taskId,
      to,
      data: { success },
    });
  },
};

export const A2A_LOG_FILE_PATH = A2A_LOG_FILE;
