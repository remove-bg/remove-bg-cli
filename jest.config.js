module.exports = {
	testEnvironment: 'node',
	// No babel: cli.js uses a top-level `return`, which babel refuses to parse
	transform: {},
	coverageProvider: 'v8',
	collectCoverageFrom: ['cli.js', 'lib/**/*.js', 'remove-bg-tools/**/*.js'],
	coverageReporters: ['text', 'html', 'lcov'],
};
