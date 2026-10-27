const { validateRemovebgOptions, injectEnvVars, optionDefinitions, showHelp } = require('../lib/options');

describe('injectEnvVars', () => {
	const originalKey = process.env.REMOVE_BG_API_KEY;

	afterEach(() => {
		if (originalKey === undefined) delete process.env.REMOVE_BG_API_KEY;
		else process.env.REMOVE_BG_API_KEY = originalKey;
	});

	test('sets api-key from REMOVE_BG_API_KEY', () => {
		process.env.REMOVE_BG_API_KEY = 'env-key';
		const options = { 'api-key': 'flag-key' };
		injectEnvVars(options);
		expect(options['api-key']).toBe('env-key');
	});

	test('leaves options untouched without REMOVE_BG_API_KEY', () => {
		delete process.env.REMOVE_BG_API_KEY;
		const options = { 'api-key': 'flag-key' };
		injectEnvVars(options);
		expect(options).toEqual({ 'api-key': 'flag-key' });
	});
});

describe('validateRemovebgOptions', () => {
	let log;

	beforeEach(() => {
		log = jest.spyOn(console, 'log').mockImplementation(() => {});
	});

	afterEach(() => {
		jest.restoreAllMocks();
	});

	test('rejects missing api key and shows help', () => {
		expect(validateRemovebgOptions({})).toBe(false);
		expect(log).toHaveBeenCalledWith('Error: API key must be specified');
		expect(log.mock.calls[1][0]).toContain('Usage');
	});

	test('fills in defaults and uses zip transfer for png', () => {
		const options = { 'api-key': 'k' };
		expect(validateRemovebgOptions(options)).toBe(true);
		expect(options).toEqual({
			'api-key': 'k',
			size: 'auto',
			type: 'auto',
			channels: 'rgba',
			format: 'png',
			transferFormat: 'zip',
		});
		expect(log).not.toHaveBeenCalled();
	});

	test('keeps explicit values', () => {
		const options = { 'api-key': 'k', size: 'full', type: 'person', channels: 'alpha', format: 'png' };
		validateRemovebgOptions(options);
		expect(options).toMatchObject({ size: 'full', type: 'person', channels: 'alpha', format: 'png' });
	});

	test('transfers png as png when the optimization is skipped', () => {
		const options = { 'api-key': 'k', 'skip-png-format-optimization': true };
		validateRemovebgOptions(options);
		expect(options.transferFormat).toBe('png');
	});

	test.each(['jpg', 'zip'])('transfers %s in its own format', format => {
		const options = { 'api-key': 'k', format };
		validateRemovebgOptions(options);
		expect(options.transferFormat).toBe(format);
	});
});

describe('showHelp', () => {
	test('prints usage for both commands and every flag', () => {
		const log = jest.spyOn(console, 'log').mockImplementation(() => {});
		showHelp();
		const output = log.mock.calls[0][0];
		log.mockRestore();

		expect(output).toContain('$ removebg <file/glob> [file/glob]... [flags]');
		expect(output).toContain('$ removebg zip2png --file /path/to/file.zip');
		optionDefinitions
			.filter(def => !def.defaultOption)
			.forEach(def => expect(output).toContain(`--${def.name}`));
	});
});
