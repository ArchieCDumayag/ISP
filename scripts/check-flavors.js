const {
  allFlavorSummaries,
  findDuplicateIssues,
  findRuntimeIssues,
  normalizeFlavorName
} = require('./flavor-tools');

const target = process.argv.slice(2).find((arg) => !arg.startsWith('--'));

(async () => {
  const summaries = allFlavorSummaries();
  if (!summaries.length) {
    console.log('No flavors found.');
    return;
  }

  summaries.forEach((item) => {
    console.log(`${item.name}: port=${item.port} upstream=${item.upstreamPort} db=${item.mysqlDatabase} url=${item.publicBaseUrl}`);
  });

  const issues = findDuplicateIssues(summaries);
  if (target) {
    issues.push(...await findRuntimeIssues(normalizeFlavorName(target)));
  }

  if (issues.length) {
    console.error('\nFlavor check failed:');
    issues.forEach((issue) => console.error(`- ${issue}`));
    process.exitCode = 1;
    return;
  }

  console.log('\nflavor-check-ok');
})();
