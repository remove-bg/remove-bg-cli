//import { ZipCanvas, ImageResizer } from '@remove-bg/remove-bg-tools';
const { ZipCanvas, ImageResizer } = require('../remove-bg-tools');
const fs = require('fs');

const superagent = require('superagent');
const path = require('path');
const { config } = require('process');
const { determineOutputPath } = require('./determine_output_path');
const { optionDefinitions } = require('./options');
const { userAgent } = require('./client');

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

function removebg(file, params, bar) {
	bar.update(5);
	const inputPath = file;
	params.size = params.size || "auto";
	params.format = params.format || "zip";
	params.type = params.type || "auto";

	processRemovebg(params, inputPath);

	function processRemovebg(params, inputPath) {
		bar.update(10);

		var headers = {
			'X-Api-Key': params['api-key'],
			'User-Agent': userAgent(),
		}

		superagent
			.post('https://api.remove.bg/v1.0/removebg')
			.set(headers)
			.attach('image_file', fs.createReadStream(inputPath), path.basename(inputPath))
			.field('size', params.size)
			.field('format', params.format)
			.field('type', params.type)
			.on('progress', event => {
				var progress;
				var percentCompleted = Math.round((event.loaded * 100) / event.total);

				if (event.direction == 'upload') {
					progress = 10 + percentCompleted * 0.5; // 10-60
				} 
				bar.update(progress); // 40-70
			})
			.then(res => {
				if (res.statusCode == 429) { // rate limit reached - retry after 'Retry-After' seconds
					setTimeout(processRemovebg(params, inputPath), res.headers['Retry-After'] * 1000);
				}
				if (res.statusCode != 200) return console.error('Error:', response.status, response.statusText);

				var outFilePath = determineOutputPath(inputPath, params);
				bar.update(70, {file: `${inputPath} -> ${outFilePath}`});
				if (params.format == 'png') {
					fs.writeFileSync(outFilePath, res.body);
					bar.update(100, {message: 'Processed:'});
				}
				if (params.format == 'zip') {
					zip2png(res.body, {
						resultPath: outFilePath, progressCallback: (percent) => {
							var updateValue = prog = 80 + 20 * (percent / 100);
							bar.update(updateValue);
						}
					}).then(() => {
						bar.update(100, {message: 'Processed:'});
					}).catch(e => {
						console.log(e);
					});;
				};
			}).catch(e => {
				console.log(e);
			});
	}
}

module.exports = { removebg, zip2png };
