const fs = require('fs');
const path = require('path');
const { PROJECT_ROOT } = require('../../../../core/runtime/paths');

const PACKAGE_DATA_ROOT = path.join(PROJECT_ROOT, 'node_modules', '@jobuntux', 'psgc', 'data');

const pickLatestDatasetVersion = () => {
    const entries = fs.existsSync(PACKAGE_DATA_ROOT)
        ? fs.readdirSync(PACKAGE_DATA_ROOT, { withFileTypes: true })
            .filter((entry) => entry.isDirectory())
            .map((entry) => entry.name)
            .sort((left, right) => left.localeCompare(right, 'en'))
        : [];

    return entries.length ? entries[entries.length - 1] : null;
};

const DATA_VERSION = pickLatestDatasetVersion();

if (!DATA_VERSION) {
    throw new Error('No PSGC dataset directory was found. Run npm install to restore dependencies.');
}

const DATASET_DIR = path.join(PACKAGE_DATA_ROOT, DATA_VERSION);

const decodeMojibake = (value) => {
    const text = String(value || '').trim().replace(/\s+/g, ' ');
    if (!text || !/[Ãâ]/.test(text)) return text;

    try {
        const fixed = Buffer.from(text, 'latin1').toString('utf8').trim().replace(/\s+/g, ' ');
        return fixed && !fixed.includes('\uFFFD') ? fixed : text;
    } catch {
        return text;
    }
};

const readDataset = (filename) => {
    const filepath = path.join(DATASET_DIR, filename);
    return JSON.parse(fs.readFileSync(filepath, 'utf8'));
};

const sortByName = (left, right) => left.name.localeCompare(right.name, 'en', { sensitivity: 'base' });

const provinces = readDataset('provinces.json')
    .map((item) => ({
        code: String(item?.provCode || '').trim(),
        name: decodeMojibake(item?.provName),
        regionCode: String(item?.regCode || '').trim(),
        cityClass: String(item?.cityClass || '').trim()
    }))
    .filter((item) => item.code && item.name)
    .sort(sortByName);

const municipalities = readDataset('muncities.json')
    .map((item) => ({
        code: String(item?.munCityCode || '').trim(),
        name: decodeMojibake(item?.munCityName),
        provinceCode: String(item?.provCode || '').trim(),
        regionCode: String(item?.regCode || '').trim()
    }))
    .filter((item) => item.code && item.name && item.provinceCode);

const barangays = readDataset('barangays.json')
    .map((item) => ({
        code: String(item?.brgyCode || '').trim(),
        name: decodeMojibake(item?.brgyName),
        municipalityCode: String(item?.munCityCode || '').trim(),
        provinceCode: String(item?.provCode || '').trim(),
        regionCode: String(item?.regCode || '').trim()
    }))
    .filter((item) => item.code && item.name && item.municipalityCode);

const municipalitiesByProvinceCode = new Map();
const barangaysByMunicipalityCode = new Map();

municipalities.forEach((item) => {
    const bucket = municipalitiesByProvinceCode.get(item.provinceCode) || [];
    bucket.push(item);
    municipalitiesByProvinceCode.set(item.provinceCode, bucket);
});

barangays.forEach((item) => {
    const bucket = barangaysByMunicipalityCode.get(item.municipalityCode) || [];
    bucket.push(item);
    barangaysByMunicipalityCode.set(item.municipalityCode, bucket);
});

municipalitiesByProvinceCode.forEach((items, code) => {
    municipalitiesByProvinceCode.set(code, items.slice().sort(sortByName));
});

barangaysByMunicipalityCode.forEach((items, code) => {
    barangaysByMunicipalityCode.set(code, items.slice().sort(sortByName));
});

const cloneItems = (items) => items.map((item) => ({ ...item }));

const listProvinces = () => cloneItems(provinces);

const listMunicipalities = (provinceCode) => {
    const safeCode = String(provinceCode || '').trim();
    if (!safeCode) return [];
    return cloneItems(municipalitiesByProvinceCode.get(safeCode) || []);
};

const listBarangays = (municipalityCode) => {
    const safeCode = String(municipalityCode || '').trim();
    if (!safeCode) return [];
    return cloneItems(barangaysByMunicipalityCode.get(safeCode) || []);
};

module.exports = {
    dataVersion: DATA_VERSION,
    listProvinces,
    listMunicipalities,
    listBarangays
};
