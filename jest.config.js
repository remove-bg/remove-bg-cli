// The npm test scripts run Node with --experimental-vm-modules so Jest can require()
// ESM-only packages (nock 15+).
module.exports = {
	testEnvironment: 'node',
	// No babel: cli.js uses a top-level `return`, which babel refuses to parse
	transform: {},
	coverageProvider: 'v8',
	collectCoverageFrom: ['cli.js', 'lib/**/*.js', 'remove-bg-tools/**/*.js'],
	coverageReporters: ['text', 'html', 'lcov'],
};
