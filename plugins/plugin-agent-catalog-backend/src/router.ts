/**
 * The agent-catalog plugin's HTTP surface. Serves neutral core values as JSON:
 * these are the endpoints the frontend consumes, and the same endpoints an
 * external system can scrape (ADR 0011). Exposure lives here, in the adapter —
 * swapping or adding a serialization is a local change.
 */

import type { HttpAuthService, LoggerService } from '@backstage/backend-plugin-api';
import type { CatalogService } from '@backstage/plugin-catalog-node';
import express from 'express';
import Router from 'express-promise-router';
import { readAgents, readFindings } from './fleetReader';

export function createRouter(opts: {
  catalog: CatalogService;
  httpAuth: HttpAuthService;
  logger: LoggerService;
}): express.Router {
  const { catalog, httpAuth } = opts;
  const router = Router();
  router.use(express.json());

  // GET /agents → AgentSnapshot[]
  router.get('/agents', async (req, res) => {
    const credentials = await httpAuth.credentials(req);
    res.json(await readAgents(catalog, credentials));
  });

  // GET /findings → Finding[]
  router.get('/findings', async (req, res) => {
    const credentials = await httpAuth.credentials(req);
    res.json(await readFindings(catalog, credentials));
  });

  return router;
}
