import crypto from 'node:crypto';
import { promisify } from 'node:util';

const randomBytesAsync = promisify(crypto.randomBytes);

async function generate() {
	// Simple auth token
	const timestamp = Math.floor(Date.now());

	const bufferWithRandomBytes = await randomBytesAsync(128);

	const randomString = bufferWithRandomBytes.toString('hex');

	const token = crypto
		.createHash('sha512')
		.update(`${timestamp}.${randomString}`)
		.digest('hex');

	console.log(token);
}

void generate();
