const fs = require('fs');
const execa = require('execa');
let path = require('path');
let exec = require('child_process').exec;

const commandLineArgs = require('command-line-args')

const { validateRemovebgOptions, optionDefinitions, mainDefinitions, injectEnvVars } = require('../lib/options')
const { expandPaths } = require('../lib/storage');
const { JPEGStream } = require('canvas');
require('dotenv').config()

function optionsFromArgv(args) {
	const mainOptions = commandLineArgs(mainDefinitions, { stopAtFirstUnknown: true, argv: args })
	const argv = mainOptions._unknown || []

	const removebgOptions = commandLineArgs(optionDefinitions, { argv })
	injectEnvVars(removebgOptions);
	return removebgOptions;
}

function cli(args, cwd) {
	return new Promise(resolve => {
		console.log(path.resolve('./cli'));
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

		let result = await cli("zip2png --file='" + process.env.TEST_DATA_DIR + "/test.zip'")
		try {
			var outputPath = 'test/files/test.png';
			expect(fs.existsSync(outputPath)).toBe(true);
			fs.unlinkSync(outputPath);
		} catch (e) {
			console.log(e);
		}
	});

	test('run removebg zip2png -help', async () => {
		let result = await cli('zip2png --help');
		expect(result.stdout).toContain('Usage');
	});
});

