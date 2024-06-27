import 'dotenv/config';

import crypto from 'node:crypto';

import { Hono } from 'hono';
import { cors } from 'hono/cors';

import { secureHeaders } from 'hono/secure-headers';
import { logger } from 'hono/logger';

import { createMiddleware } from 'hono/factory';
import { env } from 'hono/adapter'; //  Environment variables

import { bearerAuth } from 'hono/bearer-auth';
import { HTTPException } from 'hono/http-exception';

import { getReasonPhrase, StatusCodes } from 'http-status-codes';

import { serve } from '@hono/node-server';

import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';

import { v2 as cloudinary } from 'cloudinary';
`
`;
import { Queue, Worker } from 'bullmq';
import Redis from 'ioredis';

import pkg from '../package.json';

type Environment = {
	REDIS_URI: string;

	CLOUDINARY_BUCKET: string;
	CLOUDINARY_FOLDER: string;
	CLOUDINARY_KEY: string;
	CLOUDINARY_SECRET: string;

	BEARER_TOKEN: string;
};

cloudinary.config({
	api_key: process.env.CLOUDINARY_KEY,
	api_secret: process.env.CLOUDINARY_SECRET,
	cloud_name: process.env.CLOUDINARY_BUCKET,
	secure: true,
});

const redisConnection = new Redis(process.env.REDIS_URI as string, {
	maxRetriesPerRequest: null,
});

const QUEUE_NAME = 'cloudinary-remove-queue';

const ALLOWERD_FORMATS = ['image/png', 'image/jpg', 'image/jpeg'];

const UUUD_MAX_LENGTH = 36;

const cloudinaryRemoveQueue = new Queue<{ publicId: string }>(QUEUE_NAME, {
	connection: redisConnection,
	defaultJobOptions: {
		removeOnFail: true,
		delay: 3 * 1000, // 3 Seconds (ms)
	},
});

const cloudinaryRemoveQueueWorker = new Worker<{ publicId: string }>(
	QUEUE_NAME,
	async (job) => {
		const { publicId } = job.data;

		// Remove asset from Cloudinary
		await cloudinary.uploader.destroy(publicId, {
			invalidate: true,
		});
	},
	{
		connection: redisConnection,
		limiter: {
			max: 2,
			duration: 3 * 1000, // 3 seconds
		},
		autorun: true,
	},
);

cloudinaryRemoveQueueWorker
	.on('completed', (job) =>
		process.stdout.write(`\n[${job.name}-${job.id}]: OK ${job.data.publicId}`),
	)
	.on('ready', () => process.stdout.write('\nWorker active'));

const replacer = (value: string = '') => {
	return (char: string, args: any[]) => {
		return value;
	};
};

const formatFilename = (filename: string): string => {
	const REGEX_EXTENSION = /\.[^.]*$/gi;
	const REGEX_SPECIAL_CHARS = /[`~!@#$%^&*()_|+=?;:'",.<>\{\}\[\]\\\/]/gi;
	const REGEX_DUBLE_SPACES = /\s\s+/gi;

	return filename
		.replace(REGEX_EXTENSION, replacer())
		.replace(REGEX_SPECIAL_CHARS, replacer())
		.replace(REGEX_DUBLE_SPACES, replacer(' '))
		.replace(/\s/gi, '-');
};

type CloudinaryURLParams = {
	folder: string;
	api_key: string;
	public_id: string;
	allowed_formats: string;
	signature: string;
	timestamp: string;
};

const cloudinaryRequestURL = (bucket: string, params: CloudinaryURLParams) => {
	const BASE_URL = `https://api.cloudinary.com/v1_1/${bucket}/image/upload/`;

	const cloudinaryParams = new URLSearchParams(params);

	return `${BASE_URL}?${cloudinaryParams.toString()}`;
};

const app = new Hono({
	strict: false, // cloudinary?id=1 --> cloudinary/?id=1
});

const auth = createMiddleware(async (ctx, next) => {
	const { BEARER_TOKEN, CLOUDINARY_FOLDER } = env<Environment>(ctx, 'node');

	console.log({ BEARER_TOKEN, CLOUDINARY_FOLDER });

	return bearerAuth({ token: BEARER_TOKEN })(ctx, next);
});

app.use(cors());
app.use(secureHeaders());

app.use(logger());

app.get('/', (ctx) => ctx.json({ version: pkg.version }));

app.post(
	'/cloudinary',
	auth,
	zValidator(
		'json',
		z.object({
			filename: z.string().trim().toLowerCase(),
			format: z.string().min(3).max(3).trim().toLowerCase(),
		}),
	),
	async (ctx) => {
		const { filename, format } = ctx.req.valid('json');

		if (!ALLOWERD_FORMATS.includes(format)) {
			throw new HTTPException(StatusCodes.BAD_REQUEST, {
				message: `Invalid file format! allow: ${ALLOWERD_FORMATS.toString()}`,
			});
		}

		const {
			CLOUDINARY_BUCKET,
			CLOUDINARY_FOLDER,
			CLOUDINARY_KEY,
			CLOUDINARY_SECRET,
		} = env<Environment>(ctx);

		const timestamp = Math.floor(Date.now() / 1000); // Unix

		const publicId = `${formatFilename(filename)}-${crypto.randomUUID()}`;

		const signature = cloudinary.utils.api_sign_request(
			{
				folder: CLOUDINARY_FOLDER,
				public_id: publicId,
				allowed_formats: ALLOWERD_FORMATS,
				timestamp,
			},
			CLOUDINARY_SECRET,
		);

		const cloudinaryURL = cloudinaryRequestURL(CLOUDINARY_BUCKET, {
			folder: CLOUDINARY_FOLDER,
			api_key: CLOUDINARY_KEY,
			public_id: publicId,
			signature,
			allowed_formats: ALLOWERD_FORMATS.toString(),
			timestamp: timestamp.toString(),
		});

		return ctx.json({ cloudinary: cloudinaryURL }, StatusCodes.OK);
	},
);

app.delete(
	'/cloudinary',
	auth,
	zValidator('query', z.object({ publicId: z.string().min(UUUD_MAX_LENGTH) })),
	async (ctx) => {
		const { publicId } = ctx.req.valid('query');

		await cloudinaryRemoveQueue.add('destroy', {
			publicId,
		});

		return ctx.json({ publicId }, StatusCodes.OK);
	},
);

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

export default serve(app);
