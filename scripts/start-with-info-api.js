require('../env-loader');

const path = require('path');

const DEFAULT_INFO_API_USER = 'collector-sync';
const DEFAULT_INFO_API_PASS = '037ca67e63d6481bb59d';

if (!String(process.env.INFO_API_USER || '').trim()) {
    process.env.INFO_API_USER = DEFAULT_INFO_API_USER;
}
if (!String(process.env.INFO_API_PASS || '')) {
    process.env.INFO_API_PASS = DEFAULT_INFO_API_PASS;
}

const maskedPass = process.env.INFO_API_PASS ? '******' : '(missing)';
console.log(`[info] INFO API auth enabled for user: ${process.env.INFO_API_USER}`);
console.log(`[info] INFO API password: ${maskedPass}`);

require(path.join(__dirname, 'start-with-cloudflared.js'));
