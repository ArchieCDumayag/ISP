const entries = Object.freeze({
  expenses: './expenses',
  payroll: './payroll'
});

function load(entryName) {
  const entry = entries[entryName];
  if (!entry) throw new Error(`Unknown Finance backend entry: ${entryName}`);
  return require(entry);
}

module.exports = Object.freeze({
  id: 'finance',
  entries,
  load
});
