function version() {
    var pjson = require('../package.json');
    return pjson.version || 'dev';
}

function userAgent() {
    return `remove-bg-cli-${version()}`;
}

module.exports = { version, userAgent };
