import { Hono } from 'hono';
import { cors } from 'hono/cors';

import { secureHeaders } from 'hono/secure-headers';
import { logger } from 'hono/logger';

import { handle } from '@hono/node-server/vercel';

const app = new Hono();

app.use(cors());
app.use(secureHeaders());

app.use(logger());

app.get('/cloudinary', async (ctx) => {
	return ctx.json({ ok: true });
});

export default handle(app);
