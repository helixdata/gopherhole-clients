import { GopherHole } from '@gopherhole/sdk';
import { readFileSync } from 'fs';

const gph = new GopherHole({
  apiKey: 'gph_a3ed7c3f30e5415e9dc92b72c1c05b78',
  hubUrl: 'wss://gopherhole.ai/ws',
});

await gph.connect();
console.log('Connected, sending image...');

const imagePath = '/Users/brettwaterson/.marketclaw/images/1771822365256-A3kAAzoE.jpg';
const imageData = readFileSync(imagePath).toString('base64');
console.log('Image size:', imageData.length, 'chars');

const task = await gph.send('agent-70153299', {
  role: 'agent',
  parts: [
    { kind: 'text', text: 'What do you see in this image? Please describe it.' },
    { kind: 'data', mimeType: 'image/jpeg', data: imageData },
  ],
});

console.log('Task created:', task.id);

const completed = await gph.waitForTask(task.id, { maxWaitMs: 60000 });
console.log('Response:', completed.artifacts?.[0]?.parts?.[0]?.text || JSON.stringify(completed));

gph.disconnect();
