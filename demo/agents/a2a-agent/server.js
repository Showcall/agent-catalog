const http = require('node:http');

const port = Number(process.env.PORT || 8080);

const card = {
  name: 'release-notes-agent',
  description: 'Summarizes merged pull requests into release notes.',
  protocolVersion: '0.3',
  preferredTransport: 'jsonrpc',
  capabilities: {
    streaming: false,
    pushNotifications: false,
  },
  skills: [
    {
      id: 'draft-release-notes',
      name: 'Draft release notes',
      description: 'Turns merged pull requests into a concise release note draft.',
      tags: ['engineering', 'release'],
    },
  ],
};

const server = http.createServer((req, res) => {
  if (
    req.url === '/.well-known/agent-card.json' ||
    req.url === '/.well-known/agent.json'
  ) {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(card, null, 2));
    return;
  }

  if (req.url === '/healthz') {
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end('ok');
    return;
  }

  res.writeHead(404, { 'content-type': 'text/plain' });
  res.end('not found');
});

server.listen(port, '0.0.0.0', () => {
  process.stdout.write(`demo A2A agent listening on ${port}\n`);
});
