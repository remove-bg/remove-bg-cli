//import { ZipCanvas, ImageResizer } from '@remove-bg/remove-bg-tools';
const { ZipCanvas, ImageResizer } = require('../remove-bg-tools');
const fs = require('fs');

const superagent = require('superagent');
const path = require('path');
const { userAgent } = require('./client');
const { decodeBitmap } = require('ag-psd/dist/helpers');

const defaultOutputExtension = ".png";

function determineOutputPath(inputPath, settings) {
	var parsedInputPath = path.parse(inputPath);
	var outputDirectory = settings['output-directory'] || '.';
	outputExtension = defaultOutputExtension;
	if (settings.format == 'jpg') {
		outputExtension = '.jpg';
	}
	if (settings.format == 'zip') {
		outputExtension = ".zip";
	}

	if (!settings['output-directory']) {
		return path.join(parsedInputPath.dir, parsedInputPath.name + "-removebg" + outputExtension);
	}

	return path.join(outputDirectory, parsedInputPath.name + outputExtension);
}

function zip2png(binary, params) {
	return new Promise((resolve, reject) => {
		var mimeType = 'image/jpg';
		var quality = 0.92;
		ZipCanvas.fromBinary(
			binary,
			false,
			{
				export: {
					mimeType,
					quality
				},
				usePsd: false,
				bg_color: false,
				resolutionInfo: false
			},
			progress => {
				if (progress.percent) {
					params.progressCallback(progress.percent);
				}
			}
		)
			.then(zipCanvas => {
				var base64Data = zipCanvas.dataUrl.replace(/^data:image\/png;base64,/, "");

				require("fs").writeFile(params.resultPath, base64Data, 'base64', function (err) {
					if (err) {
						reject({ code: 'save_error', message: err });
					}

					params.progressCallback(100);
					resolve();
					//afterSaveImage(response, params.resolve);
				});

			})
			.catch(e => {
				reject({ code: 'save_error', message: e });
				return;
			});
	})
}

function removebg(file, params, bar, cb) {
	if (bar) bar.update(5);
	const inputPath = file;

	processRemovebg(params, inputPath, cb);

	function processRemovebg(params, inputPath, cb) {

		var headers = {
			'X-Api-Key': params['api-key'],
			'User-Agent': userAgent()
		}

		var bgInputStream, bgBasename;
		if (params['bg-image-file']) {
			if (!fs.existsSync(params['bg-image-file'])) {
				if (bar) {
					bar.update(0, { message: 'Background file not found:' }),
						bar.stop();
				}
				console.error(`bg_image_file ${params['bg-image-file']} doesn't exist`);
				cb();
				return;
			} else {
				bgInputStream = fs.createReadStream(params['bg-image-file']);
				bgBasename = path.basename(params['bg-image-file']);
			}
		}

		if (!fs.existsSync(inputPath)) {
			if (bar) {
				bar.update(0, { message: 'File not found:' }),
					bar.stop();
			}
			console.error(`input file ${inputPath} doesn't exist`);
			cb();
			return;
		}

		var extraApiOptions = {};
		if (params['extra-api-option']) {
			params['extra-api-option'].forEach(param => {
				extraApiOptions[param.split("=")[0]] = param.split("=")[1];
			});
		}

		let outFilePath = determineOutputPath(inputPath, params);
		var skipImage = fs.existsSync(outFilePath) && !params['reprocess-existing'];
		if (skipImage) {
			if (bar) {
				bar.update(0, { message: 'Skipped:' });
				bar.stop();
			}
			cb();
			return;
		}

		if (bar) bar.update(10);
		superagent
			.post('https://api.remove.bg/v1.0/removebg')
			.set(headers)
			.attach('image_file', fs.createReadStream(inputPath), path.basename(inputPath))
			.field('size', params.size || "")
			.field('type', params.type || "")
			.field('type_level', extraApiOptions.type_level || "")
			.field('format', params.transferFormat)
			.field('roi', extraApiOptions.roi || "")
			.field('crop', extraApiOptions.crop || "")
			.field('crop_margin', extraApiOptions.crop_margin || "")
			.field('scale', extraApiOptions.scale || "")
			.field('position', extraApiOptions.position || "")
			.field('channels', params.channels || "")
			.field('add_shadow', extraApiOptions.add_shadow || "")
			.field('semitransparency', extraApiOptions.semitransparency || "")
			.field('bg_color', params['bg-color'] || "")
			.attach('bg_image_file', bgInputStream, bgBasename)
			.on('progress', event => {
				var progress;
				var percentCompleted = Math.round((event.loaded * 100) / event.total);


				if (event.direction == 'upload') {
					progress = 10 + percentCompleted * 0.5; // 10-60

				}

				if (bar && progress) bar.update(progress); // 40-70
			})
			.then(res => {
				if (res.statusCode != 200) return console.error('Error:', response.status, response.statusText);

				if (bar) bar.update(70, { file: `${inputPath} -> ${outFilePath}` });
				if (params.transferFormat == 'zip' && params.format != 'zip') {  // have to convert zip to png
					zip2png(res.body, {
						resultPath: outFilePath, progressCallback: (percent) => {
							var updateValue = prog = 80 + 20 * (percent / 100);
							if (bar) bar.update(updateValue);
						}
					}).then(() => {
						if (bar) bar.update(100, { message: 'Processed:' });
					}).catch(e => {
						console.log(e);
					});
				} else {
					fs.writeFileSync(outFilePath, res.body);
					if (bar) bar.update(100, { message: 'Processed:' });
				}
				cb();
			}).catch(e => {
				if (e.status == 429) { // rate limit reached - retry after 'Retry-After' seconds
					let timeout = parseInt(e.response.headers['retry-after']) * 1000;
					setTimeout(() => { 
						if (bar) bar.update(0, { message: `Retrying in ${timeout}ms: ` });
						processRemovebg(params, inputPath, cb)
					}, timeout);
					return;
				}
				var errorText = 'Processing Error';
				try {
					errorText += ` '${e.response.body.errors[0].code}': "${e.response.body.errors[0].title} - ${e.response.body.errors[0].detail}"`;
				} catch (err) {
					errorText += ` ${e.toString()}`;
				}

				if (bar) bar.update(100, { message: errorText });
				if (bar) bar.stop();
				cb();
			});
	}
}

module.exports = { removebg, zip2png };
