const entries = Object.freeze({
  collectorNextDue: './collector-next-due',
  collectorPayments: './collector-payments',
  collectors: './collectors',
  legacyCollectorsRoutes: './routes/collectors'
});

function load(entryName) {
  const entry = entries[entryName];
  if (!entry) throw new Error(`Unknown Collector backend entry: ${entryName}`);
  return require(entry);
}

module.exports = Object.freeze({
  id: 'collector',
  entries,
  load
});
