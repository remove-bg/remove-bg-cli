const commandLineUsage = require('command-line-usage')

const optionDefinitions = [
	{
		name: 'files',
		type: String,
		multiple: true,
		defaultOption: true
	},
	{
		name: 'api-key',
		typeLabel: "string",
		description: 'API key (required) or set REMOVE_BG_API_KEY environment variable',
		type: String
	},
	{
		name: 'bg-color',
		typeLabel: "string",
		description: 'Image background color',
		type: String
	},
	{
		name: 'bg-image-file',
		typeLabel: "string",
		description: 'Adds a background image from a file',
		type: String
	},
	{
		name: 'channels',
		typeLabel: "string",
		description: 'Image channels',
		type: String
	},
	{
		name: 'confirm-batch-over',
		typeLabel: "int",
		description: 'Confirm any batches over this size (-1 to disable) (default 50)',
		type: String
	},
	{
		name: 'extra-api-option',
		typeLabel: "string",
		description: "Extra option to forward to the API (format: 'option=val'). This parameter can be used multiple times.",
		type: String,
		multiple: true
	},
	{
		name: 'format',
		typeLabel: "string",
		description: 'Image format (default "png")',
		type: String
	},
	{
		name: 'help',
		alias: 'h',
		description: 'help for removebg CLI',
		type: Boolean
	},
	{
		name: 'output-directory',
		typeLabel: "string",
		description: 'Output directory',
		type: String
	},
	{
		name: 'reprocess-existing',
		description: 'Reprocess and overwrite any already processed images',
		type: Boolean
	},
	{
		name: 'size',
		typeLabel: "string",
		description: 'Image size (default "auto")',
		type: String
	},
	{
		name: 'skip-png-format-optimization',
		description: 'Skip optimizing PNG format as ZIP to save bandwidth',
		type: Boolean
	},
	{
		name: 'type',
		typeLabel: "string",
		description: 'Image type',
		type: String
	},
	{
		name: 'version',
		alias: 'v',
		description: 'version for removebg',
		type: Boolean
	}
]

const mainDefinitions = [
	{ name: 'commandOrFiles', multiple: true, defaultOption: true }
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

	removebgOptions.size = removebgOptions.size || "auto";
	removebgOptions.type = removebgOptions.type || "auto";
	removebgOptions.channels = removebgOptions.channels || "rgba";
	removebgOptions.format = removebgOptions.format || 'png';

	if (!removebgOptions['skip-png-format-optimization'] && removebgOptions.format == 'png') {
		removebgOptions.transferFormat = 'zip';
	} else {
		removebgOptions.transferFormat = removebgOptions.format || 'png';
	}

	return true;
}

function showHelp() {
	const sections = [{ header: 'Remove image background - 100% automatically' },
	{ header: 'remove.bg CLI help', content: "Removes background from images on the command line. \nGot questions? We'll help. https://remove.bg/support" },
	{
		header: 'Usage',
		content: [
			'$ removebg <file/glob> [file/glob]... [flags]',
		]
	},
	{ header: 'Flags', optionList: optionDefinitions },
	{ content: 'Project home: {underline https://github.com/remove-bg/remove-bg-cli}' },
	{
		header: 'zip2png CLI help',
		content: [
			{ name: 'zip2png', summary: 'Converts a remove.bg ZIP to a PNG' }
		]
	},
	{
		header: 'Usage',
		content: [
			'$ removebg zip2png --file /path/to/file.zip'
		]
	},
	]
	console.log(commandLineUsage(sections))
}

module.exports = { validateRemovebgOptions, injectEnvVars, mainDefinitions, optionDefinitions, showHelp };
