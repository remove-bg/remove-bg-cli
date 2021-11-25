const defaultOutputExtension = ".png";
const path = require('path');

function determineOutputPath(inputPath, settings) {
    var parsedInputPath = path.parse(inputPath);
    var outputDirectory = settings['output-directory'] || '.';
    outputExtension = defaultOutputExtension;

    if (outputDirectory && outputDirectory.Length>0) {
        return path.join(parsedInputPath.dir, parsedInputPath.name+"-removebg"+outputExtension);
    }

    return path.join(outputDirectory, parsedInputPath.name+outputExtension);
}

module.exports = { determineOutputPath };
