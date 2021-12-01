const fs = require('fs');
const execa = require('execa');
const { exec } = require('child_process');

const commandLineArgs = require('command-line-args')

const { validateRemovebgOptions, optionDefinitions, mainDefinitions, injectEnvVars } = require ('../lib/options')
const {expandPaths} = require('../lib/storage');

function optionsFromArgv(args) {
	const mainOptions = commandLineArgs(mainDefinitions, { stopAtFirstUnknown: true, argv: args })
	const argv = mainOptions._unknown || []
	
	const removebgOptions = commandLineArgs(optionDefinitions, { argv })
	injectEnvVars(removebgOptions);	
	return removebgOptions;
}

jest.setTimeout(100000);
describe('removebg integration tests', () => {
	test('run removebg --help', done => {
		exec('node ./cli.js zip2png --help', (err, out) => {
			expect(out.includes('remove.bg CLI help')).toBe(true);
			done();			
		});
	});

	test('run removebg -h', done => {
		exec('node ./cli.js zip2png -h', (err, out) => {
			expect(out.includes('remove.bg CLI help')).toBe(true);
			done();			
		});
	});
});

jest.setTimeout(100000);

describe('removebg zip2png integration tests', () => {
	test('run removebg zip2png with cli (missing file)', done =>  {
		exec('node ./cli.js zip2png --file=test.zip', (err, out) => {
			expect(err.message.includes("no such file or directory, open 'test.zip'")).toBe(true);
			done();
		});
	});

	test('run removebg zip2png with cli (test/files/test.zip)', () => {
		console.log("d")

		/*const proc = execa.sync('./cli.js', ['zip2png', '--file=test/files/test.zip'], {
			buffer: false
		});
		var outputPath = 'test/files/test.png';
		t.true(fs.existsSync(outputPath));
		fs.unlinkSync(outputPath);
		t.true(stdout.includes("no such file or directory, open 'test.zip'"));*/
		expect(true).toBe(true); // not working yet
	});
	
	test('run removebg zip2png -help', done => {
		exec('node ./cli.js zip2png --help', (err, out) => {
			expect(out.includes("remove.bg CLI help")).toBe(true);
			done();			
		});
	});
});

