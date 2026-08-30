const WebSocket = require('ws');
const fs = require('fs');
const pcm = fs.readFileSync('C:/tmp/speech_test.pcm');
console.log('pcm 大小:', pcm.length, '字节');
const ws = new WebSocket('ws://127.0.0.1:3721/voice/cloud');
let sent = 0, got = 0, t0 = Date.now();
ws.on('open', () => {
  ws.send(JSON.stringify({ type: 'config', provider: 'aliyun', lang: 'zh' }));
  const chunk = 2048;
  for (let i = 0; i < pcm.length; i += chunk) { ws.send(pcm.subarray(i, i + chunk)); sent++; }
  console.log('已发送', sent, '块');
  setTimeout(() => ws.send(JSON.stringify({ type: 'flush' })), 1500);
});
ws.on('message', d => {
  const msg = JSON.parse(d.toString());
  got++;
  console.log('[' + (Date.now()-t0) + 'ms] 收到:', msg.type, msg.type === 'transcript' ? JSON.stringify(msg.text) : (msg.message || msg.event || ''));
});
ws.on('close', () => { console.log('连接关闭。共收到', got, '条'); process.exit(0) });
ws.on('error', e => console.log('错误:', e.message));
setTimeout(() => { console.log('超时。收到', got, '条'); process.exit(1) }, 15000);
