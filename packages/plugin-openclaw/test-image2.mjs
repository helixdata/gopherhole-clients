import { GopherHole } from '@gopherhole/sdk';
import { readFileSync } from 'fs';

const gph = new GopherHole({
  apiKey: 'gph_a3ed7c3f30e5415e9dc92b72c1c05b78',
  hubUrl: 'wss://gopherhole.ai/ws',
});

await gph.connect();
console.log('Connected as:', gph.id);

const imagePath = '/Users/brettwaterson/.marketclaw/images/1771822365256-A3kAAzoE.jpg';
const imageData = readFileSync(imagePath).toString('base64');
console.log('Image size:', imageData.length, 'chars (base64)');

const payload = {
  role: 'agent',
  parts: [
    { kind: 'text', text: 'Describe this image please.' },
    { kind: 'data', mimeType: 'image/jpeg', data: imageData },
  ],
};

console.log('Sending payload with', payload.parts.length, 'parts');
console.log('Part 0:', { kind: payload.parts[0].kind, hasText: !!payload.parts[0].text });
console.log('Part 1:', { kind: payload.parts[1].kind, mimeType: payload.parts[1].mimeType, dataLen: payload.parts[1].data?.length });

const task = await gph.send('agent-70153299', payload);
console.log('Task:', task.id, 'Status:', task.status?.state);

const completed = await gph.waitForTask(task.id, { maxWaitMs: 60000 });
console.log('Final status:', completed.status?.state);

const response = completed.artifacts?.[0]?.parts?.[0]?.text;
console.log('Response:', response?.slice(0, 300) || 'No text in response');

gph.disconnect();
