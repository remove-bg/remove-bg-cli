#!/usr/bin/env node
const commandLineArgs = require('command-line-args')
const { removebg, zip2png } = require('./lib/functions.js');
const { validateRemovebgOptions, mainDefinitions, optionDefinitions, injectEnvVars, showHelp } = require('./lib/options')
const { expandPaths } = require('./lib/storage');
const { prompts } = require('prompts')
const cliProgress = require('cli-progress');
const fs = require('fs');
const { version } = require('./lib/client');
const Queue = require('better-queue');

/* first - parse the main command */

const mainOptions = commandLineArgs(mainDefinitions, { stopAtFirstUnknown: true })
const argv = mainOptions._unknown || []

// create new container
const multibar = new cliProgress.MultiBar({
	format: '{bar} | {message} {file}',
	hideCursor: true,
	barCompleteChar: '\u2588',
	barIncompleteChar: '\u2591',
	clearOnComplete: false,
	stopOnComplete: true,
	forceRedraw: true
});

if (Object.entries( mainOptions).length === 0 || mainOptions._unknown && (mainOptions._unknown[0] === '--help' || mainOptions._unknown[0] === '-h')) {
	showHelp();
	return;
}

if (Object.entries( mainOptions).length === 0 || mainOptions._unknown && (mainOptions._unknown[0] === '--version' || mainOptions._unknown[0] === '-v')) {
	console.log(version());
	return;
}

if (mainOptions.commandOrFiles && mainOptions.commandOrFiles[0] === 'zip2png') {
	const zip2pngDefinitions = [
		{ name: 'file', defaultOption: true }
	]
	const zip2pngOptions = commandLineArgs(zip2pngDefinitions, { argv })

	var binary = fs.readFileSync(zip2pngOptions.file);
	var resultPath = zip2pngOptions.file.replace('zip', 'png');
	let bar = multibar.create(100, 0, {file: `${zip2pngOptions.file} -> ${resultPath}`, message: 'Processing:'});

	zip2png(binary, { resultPath: resultPath, progressCallback: (percent) => {
		if (bar) bar.update(percent);
	} }).then(() => {
		if (bar) bar.update(100, {message: 'Processed:'});
	});
	return;
} else {
	(async () => {
		try {
			const removebgOptions = commandLineArgs(optionDefinitions, { argv })
			injectEnvVars(removebgOptions);
			if (!validateRemovebgOptions(removebgOptions)) return;

			// create output directory
			if (removebgOptions['output-directory']) {
				try {
					fs.mkdirSync(removebgOptions['output-directory'], {recursive: true});
				} catch (err) {
					console.log(err);
				}
			}

			// expand input path(s)
			var pathsToExpand = mainOptions.commandOrFiles || removebgOptions.files;
			if (pathsToExpand == undefined) {
				console.error("No input files or paths given.");
				return;
			}
			var expandedInputPaths = expandPaths(pathsToExpand); // input file is in the mainOptions.commandOrFiles or in removebgOptions.files if specified as last commandline argument

			var confirmBatchOver = 50;
			if (removebgOptions['confirm-batch-over']) {
				confirmBatchOver = parseInt(removebgOptions['confirm-batch-over']);
			}

			var needsConfirmation = expandedInputPaths.length > confirmBatchOver;
			if (needsConfirmation) {
				const response = await prompts.confirm({message: `Do you want to process ${expandedInputPaths.length} images?`});
				if (!response) {
					return;
				}
				invokeRemovebg(mainOptions, removebgOptions, expandedInputPaths);
			} else {
				invokeRemovebg(mainOptions, removebgOptions, expandedInputPaths);
			}
		} catch (e) {
			console.log(e);
		}
	})();
}


function invokeRemovebg(mainOptions, removebgOptions, expandedInputPaths) {
	let batchSize = 5;
	const queue = new Queue(function (batch, cb) {
		let done = 0;
		batch.forEach(inputPath => {
			var bar = multibar.create(100, 0, {file: inputPath, message: 'Processing:'})
			removebg(inputPath, removebgOptions, bar, function () {
				done ++;
				if (done == batchSize) {
					cb();
				}
			});
		})
	}, { batchSize: batchSize });
	
	expandedInputPaths.forEach(inputPath => {
		queue.push(inputPath);
	})


}



