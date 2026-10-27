const fs = require('fs');
const os = require('os');
const path = require('path');
const { version } = require('../package.json');

let tmpDir, log, error, bars;
const originalArgv = process.argv;
const originalKey = process.env.REMOVE_BG_API_KEY;

// Loads cli.js in-process with the given arguments and mocked collaborators
function runCli(args, { removebg, zip2png, confirm } = {}) {
	const mocks = {
		removebg: removebg || jest.fn((file, options, bar, cb) => setImmediate(cb)),
		zip2png: zip2png || jest.fn(() => Promise.resolve()),
		confirm: confirm || jest.fn(() => Promise.resolve(true)),
	};
	jest.isolateModules(() => {
		jest.doMock('../lib/functions', () => ({ removebg: mocks.removebg, zip2png: mocks.zip2png }));
		jest.doMock('prompts', () => ({ prompts: { confirm: mocks.confirm } }));
		jest.doMock('cli-progress', () => ({
			MultiBar: jest.fn(() => ({
				create: jest.fn((total, start, payload) => {
					const bar = { payload, update: jest.fn(), stop: jest.fn() };
					bars.push(bar);
					return bar;
				}),
			})),
		}));
		process.argv = ['node', 'cli.js', ...args];
		require('../cli');
	});
	return mocks;
}

async function waitFor(predicate, timeout = 2000) {
	const start = Date.now();
	while (!predicate()) {
		if (Date.now() - start > timeout) throw new Error('waitFor timed out');
		await new Promise(resolve => setTimeout(resolve, 5));
	}
}

const settle = () => new Promise(resolve => setTimeout(resolve, 20));

function touch(...names) {
	return names.map(name => {
		const file = path.join(tmpDir, name);
		fs.writeFileSync(file, name);
		return file;
	});
}

beforeEach(() => {
	tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'removebg-cli-'));
	delete process.env.REMOVE_BG_API_KEY;
	log = jest.spyOn(console, 'log').mockImplementation(() => {});
	error = jest.spyOn(console, 'error').mockImplementation(() => {});
	bars = [];
});

afterEach(() => {
	process.argv = originalArgv;
	if (originalKey === undefined) delete process.env.REMOVE_BG_API_KEY;
	else process.env.REMOVE_BG_API_KEY = originalKey;
	fs.rmSync(tmpDir, { recursive: true, force: true });
	jest.restoreAllMocks();
});

describe('help and version', () => {
	test.each([[[]], [['-h']], [['--help']], [['zip2png', '--help']]])('%j shows help', args => {
		const { removebg, zip2png } = runCli(args);
		expect(log).toHaveBeenCalledTimes(1);
		expect(log.mock.calls[0][0]).toContain('Usage');
		expect(removebg).not.toHaveBeenCalled();
		expect(zip2png).not.toHaveBeenCalled();
	});

	test.each([[['-v']], [['--version']]])('%j prints the version', args => {
		runCli(args);
		expect(log).toHaveBeenCalledWith(version);
	});
});

describe('zip2png command', () => {
	test('converts the zip next to the input', async () => {
		const zipPath = path.join(tmpDir, 'result.zip');
		fs.writeFileSync(zipPath, 'zip bytes');
		const zip2png = jest.fn((binary, params) => {
			params.progressCallback(42);
			return Promise.resolve();
		});

		runCli(['zip2png', '--file', zipPath], { zip2png });
		await settle();

		const pngPath = path.join(tmpDir, 'result.png');
		expect(zip2png).toHaveBeenCalledWith(Buffer.from('zip bytes'), expect.objectContaining({ resultPath: pngPath }));
		expect(bars[0].payload).toEqual({ file: `${zipPath} -> ${pngPath}`, message: 'Processing:' });
		expect(bars[0].update.mock.calls).toEqual([[42], [100, { message: 'Processed:' }]]);
	});

	test('throws for a missing zip file', () => {
		expect(() => runCli(['zip2png', '--file', path.join(tmpDir, 'missing.zip')])).toThrow('ENOENT');
	});
});

describe('removebg command', () => {
	test('requires an API key', async () => {
		const [file] = touch('a.jpg');
		const { removebg } = runCli([file]);
		await settle();

		expect(log).toHaveBeenCalledWith('Error: API key must be specified');
		expect(removebg).not.toHaveBeenCalled();
	});

	test('processes each file with validated options', async () => {
		const files = touch('a.jpg', 'b.png');
		const { removebg } = runCli([...files, '--api-key', 'k', '--size', 'full']);
		await waitFor(() => removebg.mock.calls.length === 2);

		expect(removebg.mock.calls.map(call => call[0])).toEqual(files);
		expect(removebg.mock.calls[0][1]).toMatchObject({
			'api-key': 'k', size: 'full', type: 'auto', channels: 'rgba', format: 'png', transferFormat: 'zip',
		});
		expect(bars.map(bar => bar.payload)).toEqual(files.map(file => ({ file, message: 'Processing:' })));
		expect(removebg.mock.calls[0][2]).toBe(bars[0]);
	});

	test('reads the API key from REMOVE_BG_API_KEY', async () => {
		process.env.REMOVE_BG_API_KEY = 'env-key';
		const [file] = touch('a.jpg');
		const { removebg } = runCli([file]);
		await waitFor(() => removebg.mock.calls.length === 1);

		expect(removebg.mock.calls[0][1]['api-key']).toBe('env-key');
	});

	test('accepts files after the flags', async () => {
		const [file] = touch('a.jpg');
		const { removebg } = runCli(['--api-key', 'k', file]);
		await waitFor(() => removebg.mock.calls.length === 1);

		expect(removebg.mock.calls[0][0]).toBe(file);
	});

	test('expands globs', async () => {
		touch('a.jpg', 'b.jpg', 'c.png');
		const { removebg } = runCli([path.join(tmpDir, '*.jpg'), '--api-key', 'k']);
		await waitFor(() => removebg.mock.calls.length === 2);

		expect(removebg.mock.calls.map(call => call[0]).sort()).toEqual([path.join(tmpDir, 'a.jpg'), path.join(tmpDir, 'b.jpg')]);
	});

	test('complains when no input files are given', async () => {
		const { removebg } = runCli(['--api-key', 'k']);
		await settle();

		expect(error).toHaveBeenCalledWith('No input files or paths given.');
		expect(removebg).not.toHaveBeenCalled();
	});

	test('creates the output directory', async () => {
		const [file] = touch('a.jpg');
		const outDir = path.join(tmpDir, 'nested', 'out');
		const { removebg } = runCli([file, '--api-key', 'k', '--output-directory', outDir]);
		await waitFor(() => removebg.mock.calls.length === 1);

		expect(fs.statSync(outDir).isDirectory()).toBe(true);
	});

	test('logs output directory errors and carries on', async () => {
		const [file] = touch('a.jpg');
		const { removebg } = runCli([file, '--api-key', 'k', '--output-directory', path.join(file, 'out')]);
		await waitFor(() => removebg.mock.calls.length === 1);

		expect(log.mock.calls[0][0]).toMatchObject({ code: 'ENOTDIR' });
	});

	test('logs invalid flags', async () => {
		const [file] = touch('a.jpg');
		const { removebg } = runCli([file, '--api-key', 'k', '--no-such-flag']);
		await settle();

		expect(log.mock.calls[0][0]).toMatchObject({ name: 'UNKNOWN_OPTION' });
		expect(removebg).not.toHaveBeenCalled();
	});

	test('processes all files across several batches of 5', async () => {
		const files = touch(...Array.from({ length: 12 }, (_, i) => `${i}.jpg`));
		const { removebg } = runCli([...files, '--api-key', 'k']);
		await waitFor(() => removebg.mock.calls.length === 12);

		expect(removebg.mock.calls.map(call => call[0])).toEqual(files);
	});
});

describe('batch confirmation', () => {
	test('does not ask at or below the threshold', async () => {
		const files = touch('a.jpg', 'b.jpg');
		const { removebg, confirm } = runCli([...files, '--api-key', 'k', '--confirm-batch-over', '2']);
		await waitFor(() => removebg.mock.calls.length === 2);

		expect(confirm).not.toHaveBeenCalled();
	});

	test('asks above the threshold and proceeds when confirmed', async () => {
		const files = touch('a.jpg', 'b.jpg', 'c.jpg');
		const { removebg, confirm } = runCli([...files, '--api-key', 'k', '--confirm-batch-over', '2']);
		await waitFor(() => removebg.mock.calls.length === 3);

		expect(confirm).toHaveBeenCalledWith({ message: 'Do you want to process 3 images?' });
	});

	test('aborts when declined', async () => {
		const files = touch('a.jpg', 'b.jpg', 'c.jpg');
		const confirm = jest.fn(() => Promise.resolve(false));
		const { removebg } = runCli([...files, '--api-key', 'k', '--confirm-batch-over', '2'], { confirm });
		await settle();

		expect(confirm).toHaveBeenCalled();
		expect(removebg).not.toHaveBeenCalled();
	});

	test('defaults to asking above 50 files', async () => {
		const files = Array.from({ length: 51 }, (_, i) => path.join(tmpDir, `${i}.jpg`));
		const confirm = jest.fn(() => Promise.resolve(false));
		runCli([...files, '--api-key', 'k'], { confirm });
		await waitFor(() => confirm.mock.calls.length === 1);

		expect(confirm).toHaveBeenCalledWith({ message: 'Do you want to process 51 images?' });
	});
});
