const fs = require('fs');
const os = require('os');
let path = require('path');
let exec = require('child_process').exec;

const { createCanvas, loadImage } = require('canvas');
const { createRemovebgZip } = require('./helpers/fixtures');
require('dotenv').config()

function cli(args, cwd) {
	return new Promise(resolve => {
		exec(`node ${path.resolve('./cli')} ${args}`,
			{ cwd },
			(error, stdout, stderr) => {
				resolve({ code: error && error.code ? error.code : 0, error, stdout, stderr });
			});
	})
}

beforeEach(function () {
	jest.setTimeout(2000) // ms
});

describe('removebg integration tests', () => {
	test('run removebg --help', async () => {
		let result = await cli('zip2png --help');
		expect(result.stdout).toContain('Usage');
	});

	test('run removebg -h', async () => {
		let result = await cli("zip2png -h");
		expect(result.stdout).toContain('Usage');
	});
});

describe('removebg zip2png integration tests', () => {
	test('run removebg zip2png with cli (missing file)', async () => {
		let result = await cli('zip2png --file=test.zip');
		expect(result.stderr).toContain("no such file or directory, open 'test.zip'");
	});

	test('run removebg zip2png with cli (/test.zip)', async () => {
		const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'removebg-test-'));
		const zipPath = path.join(tmpDir, 'test.zip');
		const outputPath = path.join(tmpDir, 'test.png');
		try {
			await createRemovebgZip(zipPath, 4, 2);

			const result = await cli(`zip2png --file='${zipPath}'`);
			expect(result.code).toBe(0);
			expect(fs.existsSync(outputPath)).toBe(true);

			const image = await loadImage(outputPath);
			expect([image.width, image.height]).toEqual([4, 2]);

			const ctx = createCanvas(image.width, image.height).getContext('2d');
			ctx.drawImage(image, 0, 0);
			expect(ctx.getImageData(0, 0, 1, 1).data[3]).toBe(255); // opaque half
			expect(ctx.getImageData(3, 0, 1, 1).data[3]).toBe(0); // transparent half
		} finally {
			fs.rmSync(tmpDir, { recursive: true, force: true });
		}
	});

	test('run removebg zip2png -help', async () => {
		let result = await cli('zip2png --help');
		expect(result.stdout).toContain('Usage');
	});
});

