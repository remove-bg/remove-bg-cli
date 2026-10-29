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

// glob 7 behavior that glob 13 no longer has by default
describe('expandPaths compatibility with glob 7', () => {
	let tmpDir;
	const realPlatform = process.platform;

	beforeEach(() => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'removebg-storage-'));
		fs.mkdirSync(path.join(tmpDir, 'sub', 'deep'), { recursive: true });
		['zeta.jpg', 'Alpha.jpg', 'm.jpg', 'b.jpg', 'lit*.jpg', 'sub/one.png', 'sub/deep/two.png']
			.forEach(name => fs.writeFileSync(path.join(tmpDir, name), ''));
	});

	afterEach(() => {
		Object.defineProperty(process, 'platform', { value: realPlatform });
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	test('returns the matches of each glob sorted alphabetically', () => {
		expect(expandPaths([path.join(tmpDir, '[!l]*.jpg'), path.join(tmpDir, 'sub/**/*.png')])).toEqual([
			path.join(tmpDir, 'Alpha.jpg'),
			path.join(tmpDir, 'b.jpg'),
			path.join(tmpDir, 'm.jpg'),
			path.join(tmpDir, 'zeta.jpg'),
			path.join(tmpDir, 'sub/deep/two.png'),
			path.join(tmpDir, 'sub/one.png'),
		]);
	});

	test('treats backslashes in patterns as path separators on Windows', () => {
		Object.defineProperty(process, 'platform', { value: 'win32' });
		expect(expandPaths([`${tmpDir}\\sub\\**\\*.png`])).toEqual([
			`${tmpDir}/sub/deep/two.png`,
			`${tmpDir}/sub/one.png`,
		]);
	});

	test('keeps backslashes as escapes elsewhere', () => {
		expect(expandPaths([path.join(tmpDir, 'lit\\*.jpg')])).toEqual([path.join(tmpDir, 'lit*.jpg')]);
	});
});
