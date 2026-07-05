const http = require('node:http');

const port = Number(process.env.PORT || 4000);

const dailyActivity = {
  results: [
    {
      date: '2026-07-04',
      breakdown: {
        api_keys: {
          key_release_notes: {
            metadata: {
              key_alias: 'agent-catalog-demo/release-notes-agent',
              team_id: 'team-platform',
            },
            metrics: {
              api_requests: 42,
              total_tokens: 123456,
              spend: 1.23,
            },
          },
          key_shadow_batch: {
            metadata: {
              key_alias: 'agent-catalog-demo/sentiment-batch',
              team_id: 'team-data',
            },
            metrics: {
              api_requests: 317,
              total_tokens: 904221,
              spend: 7.84,
            },
          },
          key_hackathon: {
            metadata: {
              key_alias: 'hackathon-bot',
              team_id: null,
            },
            metrics: {
              api_requests: 19,
              total_tokens: 54000,
              spend: 0.42,
            },
          },
        },
      },
    },
  ],
  metadata: {
    has_more: false,
    page: 1,
  },
};

const teams = [
  { team_id: 'team-platform', team_alias: 'platform-team' },
  { team_id: 'team-data', team_alias: 'data-platform' },
];

const server = http.createServer((req, res) => {
  if (!req.headers.authorization) {
    res.writeHead(401, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'missing bearer token' }));
    return;
  }

  const url = new URL(req.url, `http://${req.headers.host}`);

  if (url.pathname === '/user/daily/activity') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(dailyActivity, null, 2));
    return;
  }

  if (url.pathname === '/team/list') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(teams, null, 2));
    return;
  }

  if (url.pathname === '/healthz') {
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end('ok');
    return;
  }

  res.writeHead(404, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ error: 'not found' }));
});

server.listen(port, '0.0.0.0', () => {
  process.stdout.write(`mock LiteLLM ledger listening on ${port}\n`);
});
