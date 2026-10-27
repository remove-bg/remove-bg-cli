const fs = require('fs');
const os = require('os');
const path = require('path');
const nock = require('nock').default; // nock 15 is ESM-only; needs --experimental-vm-modules under Jest
const { loadImage, createCanvas } = require('canvas');
const { removebg, zip2png } = require('../lib/functions');
const { userAgent } = require('../lib/client');
const { createRemovebgZipBuffer } = require('./helpers/fixtures');

const API = 'https://api.remove.bg';

function fakeBar() {
	return { update: jest.fn(), stop: jest.fn() };
}

function run(inputPath, params, bar) {
	return new Promise(resolve => removebg(inputPath, params, bar, resolve));
}

async function waitFor(predicate, timeout = 3000) {
	const start = Date.now();
	while (!predicate()) {
		if (Date.now() - start > timeout) throw new Error('waitFor timed out');
		await new Promise(resolve => setTimeout(resolve, 10));
	}
}

function barMessages(bar) {
	return bar.update.mock.calls.map(call => call[1] && call[1].message).filter(Boolean);
}

async function alphaAt(imagePath, x, y) {
	const image = await loadImage(imagePath);
	const ctx = createCanvas(image.width, image.height).getContext('2d');
	ctx.drawImage(image, 0, 0);
	return ctx.getImageData(x, y, 1, 1).data[3];
}

let tmpDir, inputPath, baseParams;

beforeAll(() => {
	nock.disableNetConnect();
});

afterAll(() => {
	nock.enableNetConnect();
});

beforeEach(() => {
	tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'removebg-functions-'));
	inputPath = path.join(tmpDir, 'photo.jpg');
	fs.writeFileSync(inputPath, 'input image bytes');
	baseParams = { 'api-key': 'test-key', size: 'auto', type: 'auto', channels: 'rgba', format: 'png', transferFormat: 'png' };
});

afterEach(() => {
	nock.cleanAll();
	fs.rmSync(tmpDir, { recursive: true, force: true });
	jest.restoreAllMocks();
});

describe('removebg request', () => {
	test('sends auth headers and all options as multipart fields', async () => {
		let body;
		const scope = nock(API, {
			reqheaders: {
				'X-Api-Key': 'test-key',
				'User-Agent': userAgent(),
			},
		})
			.post('/v1.0/removebg', b => { body = b; return true; })
			.reply(200, Buffer.from('png'), { 'Content-Type': 'image/png' });

		const bgPath = path.join(tmpDir, 'bg.jpg');
		fs.writeFileSync(bgPath, 'background bytes');

		await run(inputPath, {
			...baseParams,
			size: 'full',
			type: 'person',
			channels: 'alpha',
			'bg-color': 'ff0000',
			'bg-image-file': bgPath,
			'extra-api-option': [
				'type_level=2', 'roi=0 0 10 10', 'crop=true', 'crop_margin=5px', 'scale=50%',
				'position=center', 'add_shadow=true', 'semitransparency=false',
			],
		});

		expect(scope.isDone()).toBe(true);
		const field = name => new RegExp(`name="${name}"\\r\\n\\r\\n([^\\r]*)\\r\\n`).exec(body)[1];
		expect(field('size')).toBe('full');
		expect(field('type')).toBe('person');
		expect(field('channels')).toBe('alpha');
		expect(field('format')).toBe('png');
		expect(field('bg_color')).toBe('ff0000');
		expect(field('type_level')).toBe('2');
		expect(field('roi')).toBe('0 0 10 10');
		expect(field('crop')).toBe('true');
		expect(field('crop_margin')).toBe('5px');
		expect(field('scale')).toBe('50%');
		expect(field('position')).toBe('center');
		expect(field('add_shadow')).toBe('true');
		expect(field('semitransparency')).toBe('false');
		expect(body).toContain('name="image_file"; filename="photo.jpg"');
		expect(body).toContain('input image bytes');
		expect(body).toContain('name="bg_image_file"; filename="bg.jpg"');
		expect(body).toContain('background bytes');
	});

	test('sends empty strings for unset options', async () => {
		let body;
		nock(API)
			.post('/v1.0/removebg', b => { body = b; return true; })
			.reply(200, Buffer.from('png'), { 'Content-Type': 'image/png' });

		await run(inputPath, { 'api-key': 'k', transferFormat: 'png' });

		['size', 'type', 'type_level', 'roi', 'crop', 'channels', 'bg_color'].forEach(name => {
			expect(body).toMatch(new RegExp(`name="${name}"\\r\\n\\r\\n\\r\\n`));
		});
		expect(body).not.toContain('name="bg_image_file"');
	});

	test('reports upload progress between 10% and 60%', async () => {
		nock(API).post('/v1.0/removebg').reply(200, Buffer.from('png'), { 'Content-Type': 'image/png' });
		const bar = fakeBar();

		await run(inputPath, baseParams, bar);

		const values = bar.update.mock.calls.map(call => call[0]);
		expect(values.slice(0, 2)).toEqual([5, 10]);
		const uploadValues = values.filter(v => v > 10 && v <= 60);
		expect(uploadValues.length).toBeGreaterThan(0);
	});
});

describe('removebg output', () => {
	test('writes non-zip responses next to the input with a -removebg suffix', async () => {
		nock(API).post('/v1.0/removebg').reply(200, Buffer.from('png result'), { 'Content-Type': 'image/png' });
		const bar = fakeBar();

		await run(inputPath, baseParams, bar);

		const outPath = path.join(tmpDir, 'photo-removebg.png');
		expect(fs.readFileSync(outPath, 'utf8')).toBe('png result');
		expect(bar.update).toHaveBeenCalledWith(70, { file: `${inputPath} -> ${outPath}` });
		expect(bar.update).toHaveBeenLastCalledWith(100, { message: 'Processed:' });
	});

	test.each([
		['jpg', 'photo-removebg.jpg', 'image/jpeg'],
		['zip', 'photo-removebg.zip', 'application/zip'],
	])('uses the right extension for format %s', async (format, expectedName, contentType) => {
		nock(API).post('/v1.0/removebg').reply(200, Buffer.from('result'), { 'Content-Type': contentType });

		await run(inputPath, { ...baseParams, format, transferFormat: format });

		expect(fs.readFileSync(path.join(tmpDir, expectedName), 'utf8')).toBe('result');
	});

	test('writes into --output-directory without the suffix', async () => {
		nock(API).post('/v1.0/removebg').reply(200, Buffer.from('result'), { 'Content-Type': 'image/png' });
		const outDir = path.join(tmpDir, 'out');
		fs.mkdirSync(outDir);

		await run(inputPath, { ...baseParams, 'output-directory': outDir });

		expect(fs.readFileSync(path.join(outDir, 'photo.png'), 'utf8')).toBe('result');
	});

	test('converts zip transfers to a transparent png', async () => {
		nock(API).post('/v1.0/removebg').reply(200, await createRemovebgZipBuffer(4, 2), { 'Content-Type': 'application/zip' });
		const bar = fakeBar();

		await run(inputPath, { ...baseParams, transferFormat: 'zip' }, bar);
		await waitFor(() => barMessages(bar).includes('Processed:'));

		const outPath = path.join(tmpDir, 'photo-removebg.png');
		expect(await alphaAt(outPath, 0, 0)).toBe(255);
		expect(await alphaAt(outPath, 3, 0)).toBe(0);
		const conversionProgress = bar.update.mock.calls.map(call => call[0]).filter(v => v >= 80 && v < 100);
		expect(conversionProgress.length).toBeGreaterThan(0);
	});

	test('converts zip transfers without a progress bar', async () => {
		nock(API).post('/v1.0/removebg').reply(200, await createRemovebgZipBuffer(2, 2), { 'Content-Type': 'application/zip' });
		const outPath = path.join(tmpDir, 'photo-removebg.png');

		await run(inputPath, { ...baseParams, transferFormat: 'zip' });
		await waitFor(() => fs.existsSync(outPath) && fs.statSync(outPath).size > 0);
	});

	test('logs zip conversion failures', async () => {
		nock(API).post('/v1.0/removebg').reply(200, Buffer.from('not a zip'), { 'Content-Type': 'application/zip' });
		const log = jest.spyOn(console, 'log').mockImplementation(() => {});
		const bar = fakeBar();

		await run(inputPath, { ...baseParams, transferFormat: 'zip' }, bar);
		await waitFor(() => log.mock.calls.length > 0);

		expect(log.mock.calls[0][0]).toMatchObject({ code: 'save_error' });
		expect(barMessages(bar)).not.toContain('Processed:');
	});
});

describe('removebg skipping and missing files', () => {
	test('skips inputs whose output already exists', async () => {
		fs.writeFileSync(path.join(tmpDir, 'photo-removebg.png'), 'old');
		const bar = fakeBar();

		await run(inputPath, baseParams, bar);

		expect(bar.update).toHaveBeenLastCalledWith(0, { message: 'Skipped:' });
		expect(bar.stop).toHaveBeenCalled();
		expect(fs.readFileSync(path.join(tmpDir, 'photo-removebg.png'), 'utf8')).toBe('old');
	});

	test('skips without a progress bar', async () => {
		fs.writeFileSync(path.join(tmpDir, 'photo-removebg.png'), 'old');
		await run(inputPath, baseParams);
		expect(fs.readFileSync(path.join(tmpDir, 'photo-removebg.png'), 'utf8')).toBe('old');
	});

	test('reprocesses existing outputs with --reprocess-existing', async () => {
		fs.writeFileSync(path.join(tmpDir, 'photo-removebg.png'), 'old');
		nock(API).post('/v1.0/removebg').reply(200, Buffer.from('new'), { 'Content-Type': 'image/png' });

		await run(inputPath, { ...baseParams, 'reprocess-existing': true });

		expect(fs.readFileSync(path.join(tmpDir, 'photo-removebg.png'), 'utf8')).toBe('new');
	});

	test.each([true, false])('reports a missing input file (with bar: %s)', async withBar => {
		const error = jest.spyOn(console, 'error').mockImplementation(() => {});
		const bar = withBar ? fakeBar() : undefined;
		const missing = path.join(tmpDir, 'missing.jpg');

		await run(missing, baseParams, bar);

		expect(error).toHaveBeenCalledWith(`input file ${missing} doesn't exist`);
		if (bar) {
			expect(bar.update).toHaveBeenLastCalledWith(0, { message: 'File not found:' });
			expect(bar.stop).toHaveBeenCalled();
		}
	});

	test.each([true, false])('reports a missing background file (with bar: %s)', async withBar => {
		const error = jest.spyOn(console, 'error').mockImplementation(() => {});
		const bar = withBar ? fakeBar() : undefined;
		const missing = path.join(tmpDir, 'missing-bg.jpg');

		await run(inputPath, { ...baseParams, 'bg-image-file': missing }, bar);

		expect(error).toHaveBeenCalledWith(`bg_image_file ${missing} doesn't exist`);
		if (bar) {
			expect(bar.update).toHaveBeenLastCalledWith(0, { message: 'Background file not found:' });
			expect(bar.stop).toHaveBeenCalled();
		}
	});
});

describe('removebg errors', () => {
	test('shows the API error code, title and detail', async () => {
		nock(API).post('/v1.0/removebg').reply(400, {
			errors: [{ code: 'unknown_foreground', title: 'Could not identify foreground in image', detail: 'For details see docs' }],
		});
		const bar = fakeBar();

		await run(inputPath, baseParams, bar);

		expect(bar.update).toHaveBeenCalledWith(100, {
			message: `Processing Error 'unknown_foreground': "Could not identify foreground in image - For details see docs"`,
		});
		expect(bar.stop).toHaveBeenCalled();
		expect(fs.existsSync(path.join(tmpDir, 'photo-removebg.png'))).toBe(false);
	});

	test('falls back to the error string for unexpected error bodies', async () => {
		nock(API).post('/v1.0/removebg').reply(500, 'Internal Server Error');
		const bar = fakeBar();

		await run(inputPath, baseParams, bar);

		expect(bar.update).toHaveBeenCalledWith(100, { message: 'Processing Error Error: Internal Server Error' });
	});

	test('reports network errors', async () => {
		nock(API).post('/v1.0/removebg').replyWithError('socket hang up');
		const bar = fakeBar();

		await run(inputPath, baseParams, bar);

		expect(bar.update).toHaveBeenCalledWith(100, { message: 'Processing Error Error: socket hang up' });
	});

	test('reports errors without a progress bar', async () => {
		nock(API).post('/v1.0/removebg').reply(403, { errors: [{ code: 'auth_failed', title: 'Forbidden', detail: 'bad key' }] });
		await expect(run(inputPath, baseParams)).resolves.toBeUndefined();
	});

	// Documents current behavior: the non-200 branch references an undefined `response`
	// variable, so a 2xx other than 200 ends up in the generic error handler.
	test('treats non-200 success responses as errors', async () => {
		nock(API).post('/v1.0/removebg').reply(201, Buffer.from('png'), { 'Content-Type': 'image/png' });
		const bar = fakeBar();

		await run(inputPath, baseParams, bar);

		expect(bar.update).toHaveBeenCalledWith(100, { message: 'Processing Error ReferenceError: response is not defined' });
		expect(fs.existsSync(path.join(tmpDir, 'photo-removebg.png'))).toBe(false);
	});

	test.each([true, false])('retries after Retry-After on 429 (with bar: %s)', async withBar => {
		const scope = nock(API)
			.post('/v1.0/removebg').reply(429, { errors: [{ title: 'Rate limit exceeded' }] }, { 'Retry-After': '0' })
			.post('/v1.0/removebg').reply(200, Buffer.from('after retry'), { 'Content-Type': 'image/png' });
		const bar = withBar ? fakeBar() : undefined;

		await run(inputPath, baseParams, bar);

		expect(scope.isDone()).toBe(true);
		expect(fs.readFileSync(path.join(tmpDir, 'photo-removebg.png'), 'utf8')).toBe('after retry');
		if (bar) expect(bar.update).toHaveBeenCalledWith(0, { message: 'Retrying in 0ms: ' });
	});
});

describe('zip2png', () => {
	test('composites color and alpha into a png and reports progress', async () => {
		const resultPath = path.join(tmpDir, 'result.png');
		const progress = jest.fn();

		await zip2png(await createRemovebgZipBuffer(4, 2), { resultPath, progressCallback: progress });

		const image = await loadImage(resultPath);
		expect([image.width, image.height]).toEqual([4, 2]);
		expect(await alphaAt(resultPath, 1, 1)).toBe(255);
		expect(await alphaAt(resultPath, 2, 1)).toBe(0);
		const percents = progress.mock.calls.map(call => call[0]);
		expect(percents).toEqual([...percents].sort((a, b) => a - b));
		expect(percents[percents.length - 1]).toBe(100);
	});

	test('rejects invalid zips', async () => {
		await expect(zip2png(Buffer.from('nope'), { resultPath: path.join(tmpDir, 'x.png'), progressCallback: () => {} }))
			.rejects.toMatchObject({ code: 'save_error' });
	});

	test('rejects when the result cannot be written', async () => {
		const resultPath = path.join(tmpDir, 'no-such-dir', 'x.png');
		await expect(zip2png(await createRemovebgZipBuffer(2, 2), { resultPath, progressCallback: () => {} }))
			.rejects.toMatchObject({ code: 'save_error', message: expect.objectContaining({ code: 'ENOENT' }) });
	});
});
