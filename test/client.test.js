const { version } = require('../package.json');

describe('client', () => {
	test('version() returns the package.json version', () => {
		const client = require('../lib/client');
		expect(client.version()).toBe(version);
	});

	test('userAgent() embeds the version', () => {
		const client = require('../lib/client');
		expect(client.userAgent()).toBe(`remove-bg-cli-${version}`);
	});

	test('version() falls back to "dev" when package.json has no version', () => {
		jest.isolateModules(() => {
			jest.doMock('../package.json', () => ({}));
			const client = require('../lib/client');
			expect(client.version()).toBe('dev');
			expect(client.userAgent()).toBe('remove-bg-cli-dev');
		});
	});
});
