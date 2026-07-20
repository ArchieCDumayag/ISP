const fs = require('fs');
const path = require('path');

const DEFAULT_ENV_FILE = path.join(__dirname, '.env');

const stripInlineComment = (value) => {
  let quote = '';
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if ((char === '"' || char === "'") && value[index - 1] !== '\\') {
      quote = quote === char ? '' : (quote || char);
      continue;
    }
    if (char === '#' && !quote) {
      const before = value[index - 1] || '';
      if (!before || /\s/.test(before)) return value.slice(0, index).trim();
    }
  }
  return value.trim();
};

const unquoteValue = (value) => {
  const trimmed = stripInlineComment(value);
  if (trimmed.length < 2) return trimmed;
  const first = trimmed[0];
  const last = trimmed[trimmed.length - 1];
  if (!((first === '"' && last === '"') || (first === "'" && last === "'"))) {
    return trimmed;
  }
  const inner = trimmed.slice(1, -1);
  if (first === "'") return inner;
  return inner
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\r')
    .replace(/\\t/g, '\t')
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, '\\');
};

function loadEnv(filePath = DEFAULT_ENV_FILE) {
  try {
    if (!fs.existsSync(filePath)) return false;
    const raw = fs.readFileSync(filePath, 'utf8');
    raw.split(/\r?\n/).forEach((line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) return;
      const normalized = trimmed.startsWith('export ') ? trimmed.slice(7).trim() : trimmed;
      const separatorIndex = normalized.indexOf('=');
      if (separatorIndex <= 0) return;
      const key = normalized.slice(0, separatorIndex).trim();
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) return;
      if (Object.prototype.hasOwnProperty.call(process.env, key)) return;
      process.env[key] = unquoteValue(normalized.slice(separatorIndex + 1));
    });
    return true;
  } catch (error) {
    console.warn(`[warn] Failed to load ${path.basename(filePath)}: ${error.message}`);
    return false;
  }
}

loadEnv();

module.exports = {
  loadEnv
};
