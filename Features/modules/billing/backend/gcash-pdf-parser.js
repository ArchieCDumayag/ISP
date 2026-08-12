const createError = require('http-errors');

const DATE_TIME_PATTERN = /\b(\d{4}-\d{2}-\d{2})\s+(\d{1,2}):(\d{2})\s*(AM|PM)\b/i;
const STATEMENT_RANGE_PATTERN = /\b(\d{4}-\d{2}-\d{2})\s+to\s+(\d{4}-\d{2}-\d{2})\b/i;
const REFERENCE_PATTERN = /^\d{10,20}$/;
const MONEY_PATTERN = /^\(?-?(?:PHP|PHP\s*)?\s*[\d,]+(?:\.\d{2})?\)?$/i;

const normalizeText = (value) => String(value == null ? '' : value).replace(/\s+/g, ' ').trim();

const parseMoney = (value) => {
    const raw = normalizeText(value);
    if (!raw || !MONEY_PATTERN.test(raw)) return null;
    const negative = /^\(/.test(raw) || /-/.test(raw);
    const parsed = Number(raw.replace(/PHP/gi, '').replace(/[(),\s-]/g, ''));
    if (!Number.isFinite(parsed)) return null;
    return Number((negative ? -parsed : parsed).toFixed(2));
};

const parseTransactionDateTime = (value) => {
    const match = normalizeText(value).match(DATE_TIME_PATTERN);
    if (!match) return null;
    let hour = Number(match[2]);
    const minute = Number(match[3]);
    const meridiem = String(match[4] || '').toUpperCase();
    if (!Number.isInteger(hour) || hour < 1 || hour > 12 || minute < 0 || minute > 59) return null;
    if (meridiem === 'AM' && hour === 12) hour = 0;
    if (meridiem === 'PM' && hour !== 12) hour += 12;
    return {
        date: match[1],
        transactionAt: `${match[1]} ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00`
    };
};

const groupTextItemsIntoRows = (items = [], tolerance = 2) => {
    const normalized = (Array.isArray(items) ? items : [])
        .map((item) => ({
            text: normalizeText(item?.str ?? item?.text),
            x: Number(item?.transform?.[4] ?? item?.x),
            y: Number(item?.transform?.[5] ?? item?.y)
        }))
        .filter((item) => item.text && Number.isFinite(item.x) && Number.isFinite(item.y))
        .sort((a, b) => (b.y - a.y) || (a.x - b.x));

    const rows = [];
    normalized.forEach((item) => {
        let row = rows.find((candidate) => Math.abs(candidate.y - item.y) <= tolerance);
        if (!row) {
            row = { y: item.y, items: [] };
            rows.push(row);
        }
        row.items.push(item);
        row.y = row.items.reduce((sum, child) => sum + child.y, 0) / row.items.length;
    });
    return rows
        .map((row) => ({ ...row, items: row.items.sort((a, b) => a.x - b.x) }))
        .sort((a, b) => b.y - a.y);
};

const resolveColumnPositions = (rows = []) => {
    const defaults = {
        date: 50,
        description: 126,
        reference: 273,
        debit: 371,
        credit: 420,
        balance: 466
    };
    const header = rows.find((row) => {
        const text = row.items.map((item) => item.text).join(' ').toLowerCase();
        return text.includes('date and time') && text.includes('reference no') && text.includes('credit');
    });
    if (!header) return defaults;

    const findX = (matcher, fallback) => {
        const item = header.items.find((candidate) => matcher(candidate.text.toLowerCase()));
        return item ? item.x : fallback;
    };
    return {
        date: findX((text) => text.includes('date and time'), defaults.date),
        description: findX((text) => text === 'description', defaults.description),
        reference: findX((text) => text.includes('reference no'), defaults.reference),
        debit: findX((text) => text === 'debit', defaults.debit),
        credit: findX((text) => text === 'credit', defaults.credit),
        balance: findX((text) => text === 'balance', defaults.balance)
    };
};

const nearestMoneyColumn = (x, columns) => {
    const candidates = ['debit', 'credit', 'balance'];
    return candidates.reduce((best, name) => {
        const distance = Math.abs(Number(x) - Number(columns[name]));
        return !best || distance < best.distance ? { name, distance } : best;
    }, null)?.name;
};

const parseTransferParties = (description) => {
    const match = normalizeText(description).match(/transfer\s+from\s+([+\d\s()-]+?)\s+to\s+([+\d\s()-]+)\s*$/i);
    if (!match) return { sender: '', recipient: '' };
    return {
        sender: match[1].replace(/\D/g, ''),
        recipient: match[2].replace(/\D/g, '')
    };
};

const parseGcashTransactionRow = (row, columns = resolveColumnPositions([]), pageNumber = 1) => {
    const items = Array.isArray(row?.items) ? row.items.slice().sort((a, b) => a.x - b.x) : [];
    if (!items.length) return null;

    const dateItem = items.find((item) => DATE_TIME_PATTERN.test(normalizeText(item.text)));
    if (!dateItem) return null;
    const parsedDate = parseTransactionDateTime(dateItem.text);
    if (!parsedDate) return null;

    const referenceItem = items.find((item) => REFERENCE_PATTERN.test(normalizeText(item.text).replace(/\s+/g, '')));
    if (!referenceItem) return null;
    const reference = normalizeText(referenceItem.text).replace(/\s+/g, '');

    const description = normalizeText(items
        .filter((item) => item.x > dateItem.x && item.x < referenceItem.x)
        .map((item) => item.text)
        .join(' '));
    const parties = parseTransferParties(description);
    const values = { debit: null, credit: null, balance: null };
    items
        .filter((item) => item.x > referenceItem.x)
        .forEach((item) => {
            const amount = parseMoney(item.text);
            if (amount == null) return;
            values[nearestMoneyColumn(item.x, columns)] = amount;
        });

    if (values.debit == null && values.credit == null) return null;
    return {
        reference,
        transactionAt: parsedDate.transactionAt,
        transactionDate: parsedDate.date,
        description,
        sender: parties.sender,
        recipient: parties.recipient,
        debit: values.debit,
        credit: values.credit,
        balance: values.balance,
        status: Number(values.credit) > 0 ? 'received' : 'debit',
        pageNumber
    };
};

const parseGcashTextPages = (pages = []) => {
    const transactions = [];
    const allText = [];
    (Array.isArray(pages) ? pages : []).forEach((page, pageIndex) => {
        const rows = groupTextItemsIntoRows(page?.items || page || []);
        const columns = resolveColumnPositions(rows);
        rows.forEach((row) => {
            allText.push(row.items.map((item) => item.text).join(' '));
            const transaction = parseGcashTransactionRow(row, columns, pageIndex + 1);
            if (transaction) transactions.push(transaction);
        });
    });

    const joinedText = allText.join('\n');
    const range = joinedText.match(STATEMENT_RANGE_PATTERN);
    return {
        title: /GCash Transaction History/i.test(joinedText) ? 'GCash Transaction History' : '',
        statementFrom: range?.[1] || null,
        statementTo: range?.[2] || null,
        transactions,
        warnings: transactions.length ? [] : ['No GCash transaction rows were found in the PDF.']
    };
};

const extractGcashTransactionsFromPdf = async (buffer, password = '') => {
    if (!Buffer.isBuffer(buffer) || !buffer.length) {
        throw createError(400, 'GCash Transaction History PDF is required.');
    }
    if (buffer.length > 8 * 1024 * 1024) {
        throw createError(413, 'GCash Transaction History PDF is too large. Max size is 8 MB.');
    }
    if (buffer.subarray(0, 5).toString('ascii') !== '%PDF-') {
        throw createError(400, 'The uploaded file is not a valid PDF.');
    }

    let loadingTask = null;
    let document = null;
    try {
        const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
        loadingTask = pdfjs.getDocument({
            data: new Uint8Array(buffer),
            password: String(password || ''),
            disableWorker: true,
            useSystemFonts: true,
            isEvalSupported: false,
            verbosity: pdfjs.VerbosityLevel.ERRORS
        });
        document = await loadingTask.promise;
        if (!Number.isInteger(document.numPages) || document.numPages < 1 || document.numPages > 100) {
            throw createError(422, 'The GCash Transaction History PDF has an unsupported page count.');
        }
        const pages = [];
        for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
            const page = await document.getPage(pageNumber);
            const content = await page.getTextContent();
            pages.push({ items: content.items || [] });
            page.cleanup();
        }
        const parsed = parseGcashTextPages(pages);
        if (!parsed.title) {
            throw createError(422, 'This PDF is not recognized as a GCash Transaction History statement.');
        }
        if (!parsed.transactions.length) {
            throw createError(422, 'No GCash transaction rows were found in the PDF.');
        }
        return { ...parsed, pageCount: document.numPages };
    } catch (error) {
        if (error?.status || error?.statusCode) throw error;
        const name = String(error?.name || '');
        const code = Number(error?.code);
        if (name === 'PasswordException' || code === 1 || code === 2) {
            throw createError(400, code === 1
                ? 'This PDF is password-protected. Enter the PDF password.'
                : 'The PDF password is incorrect.');
        }
        throw createError(422, 'The GCash Transaction History PDF could not be read.');
    } finally {
        if (document) await document.destroy().catch(() => {});
        else if (loadingTask) await loadingTask.destroy().catch(() => {});
    }
};

module.exports = {
    extractGcashTransactionsFromPdf,
    groupTextItemsIntoRows,
    parseGcashTextPages,
    parseGcashTransactionRow,
    parseMoney,
    parseTransactionDateTime
};
