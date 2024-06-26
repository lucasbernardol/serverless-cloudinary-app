import { Hono } from 'hono';
import { cors } from 'hono/cors';

import { secureHeaders } from 'hono/secure-headers';
import { logger } from 'hono/logger';

import { env } from 'hono/adapter'; // Environment variables
import { createMiddleware } from 'hono/factory';

import { bearerAuth } from 'hono/bearer-auth';
import { HTTPException } from 'hono/http-exception';

import { getReasonPhrase, StatusCodes } from 'http-status-codes';

import { handle } from '@hono/node-server/vercel';

import { v2 as cloudinary } from 'cloudinary';

type Environment = {
	CLOUDINARY_BUCKET: string;
	CLOUDINARY_FOLDER: string;
	CLOUDINARY_KEY: string;
	CLOUDINARY_SECRET: string;

	BEARER_TOKEN: string;
};

const app = new Hono();

const auth = createMiddleware(async (ctx, next) => {
	const { BEARER_TOKEN } = env<Environment>(ctx);

	return bearerAuth({ token: BEARER_TOKEN })(ctx, next);
});

app.use(cors());
app.use(secureHeaders());

app.use(logger());

app.get('/', auth, async (ctx) => {
	return ctx.json({ ok: true });
});

app.onError((error, ctx) => {
	if (error instanceof HTTPException) {
		return ctx.json(
			{
				error: {
					name: 'HttpException',
					message: error.message || getReasonPhrase(error.status),
					status: error.status,
				},
			},
			error.status,
		);
	}

	return ctx.json(
		{
			error: {
				name: 'HttpException',
				message: 'Internal Server Error',
				status: StatusCodes.INTERNAL_SERVER_ERROR,
			},
		},
		StatusCodes.INTERNAL_SERVER_ERROR,
	);
});

export default handle(app);
