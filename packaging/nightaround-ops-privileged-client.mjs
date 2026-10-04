#!/opt/nightaround-node22/bin/node
import net from 'node:net';

const socketPath = '/run/nightaround-ops-privileged.sock';
const args = process.argv.slice(2);
if (args.length < 1 || args.length > 3 || args.some(value => /[\t\r\n]/.test(value))) {
  console.error('invalid privileged broker request');
  process.exit(64);
}

const socket = net.createConnection({ path: socketPath });
let output = '';
socket.setEncoding('utf8');
socket.setTimeout(65000, () => socket.destroy(new Error('privileged broker timeout')));
socket.on('connect', () => socket.end(args.join('\t') + '\n'));
socket.on('data', chunk => { output += chunk; });
socket.on('error', error => {
  console.error(`privileged broker unavailable: ${error.message}`);
  process.exitCode = 69;
});
socket.on('close', () => {
  const marker = output.match(/(?:^|\n)__NIGHTAROUND_BROKER_EXIT__=(\d+)\s*$/);
  if (!marker) {
    if (output) process.stdout.write(output);
    if (!process.exitCode) process.exitCode = 70;
    return;
  }
  const body = output.slice(0, marker.index).replace(/\n?$/, '');
  if (body) process.stdout.write(body + '\n');
  process.exitCode = Number(marker[1]);
});