/**
 * @deprecated These tests covered the now-removed GopherHoleClient class.
 * The MCP server now delegates all API calls to @gopherhole/sdk.
 * Discovery and workspace tests belong in the SDK package (packages/sdk-typescript).
 */

// Keep the retired suite visible without failing Vitest's empty-suite check.
import { it } from 'vitest';
it.todo('Legacy GopherHoleClient coverage belongs in the SDK package');
