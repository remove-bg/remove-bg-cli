var glob = require("glob");


function expandPaths(originalPaths) {
    var resolvedPaths = new Array();
    originalPaths.forEach(originalPath => {
        if (!originalPath.includes('*')) {
            resolvedPaths.push(originalPath);
        } else {
            var expanded = glob.sync(originalPath);
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
