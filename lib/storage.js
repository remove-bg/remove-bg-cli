var glob = require("glob");


function expandPaths(originalPaths) {
    var resolvedPaths = new Array();
    originalPaths.forEach(originalPath => {
        if (!originalPath.includes('*')) {
            resolvedPaths.push(originalPath);
        } else {
            // keep glob 7 behavior: sorted matches, and `\` as path separator on Windows
            var expanded = glob.sync(originalPath, { windowsPathsNoEscape: process.platform === 'win32' })
                .sort((a, b) => a.localeCompare(b, 'en'));
            if (expanded.length == 0) {
                console.warn("Warning: No files found or directory does not exist for '" + originalPath + "'");
            }
            expanded.forEach(path => {
                resolvedPaths.push(path);
            });
        }
    });
    return resolvedPaths;
}

module.exports = { expandPaths };
