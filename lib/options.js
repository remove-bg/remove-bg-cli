const commandLineUsage = require('command-line-usage')

const optionDefinitions = [
	{
		name: 'api-key',
		description: 'API key (required) or set REMOVE_BG_API_KEY environment variable',
		type: String
	},
	{
		name: 'bg-color',
		description: 'Image background color',
		type: String
	},
	{
		name: 'bg-image-file',
		description: 'Adds a background image from a file',
		type: String
	},
	{
		name: 'channels',
		description: 'Image channels',
		type: String
	},
	{
		name: 'confirm-batch-over',
		description: 'Confirm any batches over this size (-1 to disable) (default 50)',
		type: String
	},
	{
		name: 'extra-api-options',
		description: "Extra options to forward to the API (format: 'option1=val1&option2=val2')",
		type: String
	},
	{
		name: 'format',
		description: 'Image format (default "png")',
		type: String
	},
	{
		name: 'help',
		description: 'help for removebg',
		type: String
	},
	{
		name: 'output-directory',
		description: 'Output directory',
		type: String
	},
	{
		name: 'reprocess-existing',
		description: 'Reprocess and overwrite any already processed images',
		type: Number
	},
	{
		name: 'size',
		description: 'Image size (default "auto")',
		type: String
	},
	{
		name: 'type',
		description: 'Image type',
		type: String
	}
]

const mainDefinitions = [
	{ name: 'command', multiple: true, defaultOption: true }
]

function injectEnvVars(removebgOptions) {
	if (process.env.REMOVE_BG_API_KEY) { removebgOptions['api-key'] = process.env.REMOVE_BG_API_KEY };
}

function validateRemovebgOptions(removebgOptions) {
	var error;
	if (!removebgOptions['api-key']) {
		error = "API key must be specified";
	}

	if (error) {
		console.log("Error: " + error);
		showHelp();
		return false;
	}

	return true;
}

function showHelp() {
	const sections = [{	header: 'Remove image background - 100% automatically'},
		{ header: 'remove.bg CLI help',	content: 'Removes background from images on the command line.' },
		{ header: 'Usage',
			content: [
				'$ removebg <file>... [flags]',
				'$ removebg zip2png [command]'
			]
		},
		{ header: 'Additional Available Commands', content: [{name: 'zip2png', summary: 'Converts a remove.bg ZIP to a PNG' }]},
		{ header: 'Flags', optionList: optionDefinitions },
		{ content: 'Use "removebg [command] --help" for more information about a command.' },
		{ content: 'Project home: {underline https://github.com/remove-bg/remove-bg-cli}' }
	]


	console.log(commandLineUsage(sections))
}

module.exports = { validateRemovebgOptions, injectEnvVars, mainDefinitions, optionDefinitions, showHelp };
