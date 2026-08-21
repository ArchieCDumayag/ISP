const entries = Object.freeze({
  jobNumbering: './job-numbering',
  jobs: './jobs',
  technicianAssignments: './technician-assignments',
  technicianInventory: './technician-inventory',
  technicianInstallations: './technician-installations',
  tickets: './tickets'
});

function load(entryName) {
  const entry = entries[entryName];
  if (!entry) throw new Error(`Unknown Technician backend entry: ${entryName}`);
  return require(entry);
}

module.exports = Object.freeze({
  id: 'technician',
  entries,
  load
});
