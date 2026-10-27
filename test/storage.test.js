const fs = require('fs');
const os = require('os');
const path = require('path');
const { expandPaths } = require('../lib/storage');

describe('expandPaths', () => {
	let tmpDir;

	beforeEach(() => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'removebg-storage-'));
		['a.jpg', 'b.jpg', 'c.png'].forEach(name => fs.writeFileSync(path.join(tmpDir, name), ''));
	});

	afterEach(() => {
		fs.rmSync(tmpDir, { recursive: true, force: true });
		jest.restoreAllMocks();
	});

	test('passes paths without wildcards through unchanged, even if missing', () => {
		expect(expandPaths(['one.jpg', 'missing/two.png'])).toEqual(['one.jpg', 'missing/two.png']);
	});

	test('expands globs', () => {
		const result = expandPaths([path.join(tmpDir, '*.jpg')]);
		expect(result.sort()).toEqual([path.join(tmpDir, 'a.jpg'), path.join(tmpDir, 'b.jpg')]);
	});

	test('preserves order across mixed plain paths and globs', () => {
		const result = expandPaths(['first.jpg', path.join(tmpDir, '*.png'), 'last.jpg']);
		expect(result).toEqual(['first.jpg', path.join(tmpDir, 'c.png'), 'last.jpg']);
	});

	test('warns when a glob matches nothing', () => {
		const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
		const pattern = path.join(tmpDir, '*.gif');
		expect(expandPaths([pattern])).toEqual([]);
		expect(warn).toHaveBeenCalledWith(`Warning: No files found or directory does not exist for '${pattern}'`);
	});
});
