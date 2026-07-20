(function () {
    const params = new URLSearchParams(window.location.search);
    const nodes = {
        businessName: document.getElementById('receiptBusinessName'),
        verified: document.getElementById('receiptVerified'),
        amount: document.getElementById('receiptAmount'),
        paidBy: document.getElementById('receiptPaidBy'),
        account: document.getElementById('receiptAccount'),
        paymentFor: document.getElementById('receiptFor'),
        method: document.getElementById('receiptMethod'),
        reference: document.getElementById('receiptReference'),
        dateTime: document.getElementById('receiptDateTime'),
        receivedBy: document.getElementById('receiptReceivedBy'),
        downloadBtn: document.getElementById('receiptDownloadBtn'),
        printBtn: document.getElementById('receiptPrintBtn'),
        continueBtn: document.getElementById('receiptContinueBtn')
    };
    let currentReceipt = null;

    const clean = (value, fallback = '') => String(value ?? '').trim() || fallback;

    const formatCurrency = (value) => {
        const amount = Number(value);
        const safeAmount = Number.isFinite(amount) ? amount : 0;
        try {
            return new Intl.NumberFormat('en-PH', {
                style: 'currency',
                currency: 'PHP',
                minimumFractionDigits: 2
            }).format(safeAmount);
        } catch {
            return `PHP ${safeAmount.toFixed(2)}`;
        }
    };

    const formatDateTime = (value) => {
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return clean(value, '-');
        return date.toLocaleString('en-PH', {
            month: 'long',
            day: 'numeric',
            year: 'numeric',
            hour: 'numeric',
            minute: '2-digit',
            hour12: true,
            timeZone: 'Asia/Manila'
        });
    };

    const fallbackReceipt = () => ({
        businessName: 'Dante Fiber',
        verified: false,
        amountPaid: Number(params.get('amount')) || 0,
        paidBy: clean(params.get('paidBy') || params.get('payer'), 'Customer'),
        accountNumber: clean(params.get('accountNumber') || params.get('account'), '-'),
        paymentFor: clean(params.get('description') || params.get('for'), 'Internet payment'),
        paymentMethod: clean(params.get('method'), 'Online Payment'),
        referenceNumber: clean(params.get('reference') || params.get('ref'), 'Processing'),
        dateTime: clean(params.get('dateTime') || params.get('paidAt'), new Date().toISOString()),
        receivedBy: 'Dante Fiber',
        target: clean(params.get('target'))
    });

    const safeFilePart = (value, fallback = 'receipt') => (
        clean(value, fallback)
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '')
            .slice(0, 80) || fallback
    );

    const getWrappedLines = (ctx, text, maxWidth) => {
        const words = clean(text, '-').split(/\s+/);
        const lines = [];
        let line = '';
        words.forEach((word) => {
            const nextLine = line ? `${line} ${word}` : word;
            if (ctx.measureText(nextLine).width <= maxWidth || !line) {
                line = nextLine;
                return;
            }
            lines.push(line);
            line = word;
        });
        if (line) lines.push(line);
        return lines;
    };

    const roundedRect = (ctx, x, y, width, height, radius) => {
        const r = Math.min(radius, width / 2, height / 2);
        ctx.beginPath();
        ctx.moveTo(x + r, y);
        ctx.arcTo(x + width, y, x + width, y + height, r);
        ctx.arcTo(x + width, y + height, x, y + height, r);
        ctx.arcTo(x, y + height, x, y, r);
        ctx.arcTo(x, y, x + width, y, r);
        ctx.closePath();
    };

    const drawReceiptPng = (receipt) => {
        const data = { ...fallbackReceipt(), ...(receipt || {}) };
        const canvas = document.createElement('canvas');
        const measureCanvas = document.createElement('canvas');
        const measureCtx = measureCanvas.getContext('2d');
        const width = 900;
        const padding = 70;
        const contentWidth = width - (padding * 2);
        const labelFont = '28px Arial, sans-serif';
        const valueFont = 'bold 36px Arial, sans-serif';
        const smallFont = '24px Arial, sans-serif';
        const fields = [
            ['Paid by', clean(data.paidBy, 'Customer')],
            ['Account / Customer No.', clean(data.accountNumber, '-')],
            ['Payment For', clean(data.paymentFor, 'Internet payment')],
            ['Payment Method', clean(data.paymentMethod, 'Online Payment')],
            ['Reference No.', clean(data.referenceNumber, 'Processing')],
            ['Date & Time', formatDateTime(data.dateTime)]
        ];
        let height = 520;
        const measuredFields = fields.map(([label, value]) => {
            measureCtx.font = valueFont;
            const lines = getWrappedLines(measureCtx, value, contentWidth);
            height += 52 + (lines.length * 42) + 24;
            return { label, lines };
        });
        height += 230;

        const scale = Math.max(2, Math.min(3, window.devicePixelRatio || 2));
        canvas.width = Math.round(width * scale);
        canvas.height = Math.round(height * scale);
        const ctx = canvas.getContext('2d');
        ctx.scale(scale, scale);

        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, width, height);

        ctx.fillStyle = '#288bdc';
        roundedRect(ctx, 0, 0, width, 150, 28);
        ctx.fill();
        ctx.fillRect(0, 80, width, 70);

        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 48px Arial, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(clean(data.businessName, 'Dante Fiber').toUpperCase(), width / 2, 78);

        let y = 205;
        ctx.fillStyle = '#727c8d';
        ctx.font = '30px Arial, sans-serif';
        ctx.fillText('Digital Payment Receipt', width / 2, y);

        y += 70;
        ctx.fillStyle = '#1aa064';
        ctx.beginPath();
        ctx.arc(width / 2, y, 54, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 11;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.beginPath();
        ctx.moveTo((width / 2) - 25, y);
        ctx.lineTo((width / 2) - 7, y + 23);
        ctx.lineTo((width / 2) + 30, y - 28);
        ctx.stroke();

        y += 105;
        ctx.fillStyle = '#242933';
        ctx.font = 'bold 42px Arial, sans-serif';
        ctx.fillText('Payment Successful', width / 2, y);

        y += 86;
        ctx.fillStyle = '#727c8d';
        ctx.font = '30px Arial, sans-serif';
        ctx.fillText('Amount Paid', width / 2, y);
        y += 76;
        ctx.fillStyle = '#242933';
        ctx.font = 'bold 72px Arial, sans-serif';
        ctx.fillText(formatCurrency(data.amountPaid), width / 2, y);

        ctx.textAlign = 'left';
        y += 90;
        measuredFields.forEach(({ label, lines }) => {
            ctx.fillStyle = '#727c8d';
            ctx.font = labelFont;
            ctx.fillText(label, padding, y);
            y += 42;
            ctx.fillStyle = '#242933';
            ctx.font = valueFont;
            lines.forEach((line) => {
                ctx.fillText(line, padding, y);
                y += 42;
            });
            y += 16;
            ctx.strokeStyle = '#d7dee8';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(padding, y);
            ctx.lineTo(width - padding, y);
            ctx.stroke();
            y += 26;
        });

        ctx.fillStyle = '#727c8d';
        ctx.font = smallFont;
        ctx.textAlign = 'center';
        const noteLines = getWrappedLines(ctx, 'Thank you for your payment. Please keep this receipt for your records.', contentWidth);
        noteLines.forEach((line) => {
            ctx.fillText(line, width / 2, y);
            y += 32;
        });

        y += 18;
        roundedRect(ctx, padding, y, contentWidth, 112, 18);
        ctx.fillStyle = '#f8fafc';
        ctx.fill();
        ctx.strokeStyle = '#d7dee8';
        ctx.stroke();
        ctx.textAlign = 'left';
        ctx.fillStyle = '#727c8d';
        ctx.font = '24px Arial, sans-serif';
        ctx.fillText('Received by', padding + 28, y + 34);
        ctx.fillStyle = '#242933';
        ctx.font = 'bold 34px Arial, sans-serif';
        ctx.fillText(clean(data.receivedBy || data.businessName, 'Dante Fiber'), padding + 28, y + 78);

        return canvas;
    };

    const downloadReceipt = () => {
        const data = currentReceipt || fallbackReceipt();
        const previousText = nodes.downloadBtn?.textContent || 'Download Receipt';
        if (nodes.downloadBtn) {
            nodes.downloadBtn.disabled = true;
            nodes.downloadBtn.textContent = 'Preparing...';
        }
        try {
            const canvas = drawReceiptPng(data);
            canvas.toBlob((blob) => {
                if (!blob) {
                    if (nodes.downloadBtn) {
                        nodes.downloadBtn.disabled = false;
                        nodes.downloadBtn.textContent = previousText;
                    }
                    return;
                }
                const url = URL.createObjectURL(blob);
                const link = document.createElement('a');
                const reference = safeFilePart(data.referenceNumber || data.accountNumber || 'receipt');
                link.href = url;
                link.download = `payment-receipt-${reference}.png`;
                document.body.appendChild(link);
                link.click();
                link.remove();
                setTimeout(() => URL.revokeObjectURL(url), 5000);
                if (nodes.downloadBtn) {
                    nodes.downloadBtn.disabled = false;
                    nodes.downloadBtn.textContent = previousText;
                }
            }, 'image/png', 0.95);
        } catch {
            if (nodes.downloadBtn) {
                nodes.downloadBtn.disabled = false;
                nodes.downloadBtn.textContent = previousText;
            }
        }
    };

    const renderReceipt = (receipt) => {
        const data = { ...fallbackReceipt(), ...(receipt || {}) };
        currentReceipt = data;
        if (nodes.businessName) nodes.businessName.textContent = clean(data.businessName, 'Dante Fiber').toUpperCase();
        if (nodes.amount) nodes.amount.textContent = formatCurrency(data.amountPaid);
        if (nodes.paidBy) nodes.paidBy.textContent = clean(data.paidBy, 'Customer');
        if (nodes.account) nodes.account.textContent = clean(data.accountNumber, '-');
        if (nodes.paymentFor) nodes.paymentFor.textContent = clean(data.paymentFor, 'Internet payment');
        if (nodes.method) nodes.method.textContent = clean(data.paymentMethod, 'Online Payment');
        if (nodes.reference) nodes.reference.textContent = clean(data.referenceNumber, 'Processing');
        if (nodes.dateTime) nodes.dateTime.textContent = formatDateTime(data.dateTime);
        if (nodes.receivedBy) nodes.receivedBy.textContent = clean(data.receivedBy || data.businessName, 'Dante Fiber');
        if (nodes.verified) {
            nodes.verified.textContent = data.verified
                ? 'Payment has been recorded successfully.'
                : 'Payment successful. Receipt details may finish syncing shortly.';
            nodes.verified.classList.toggle('is-warning', !data.verified);
        }
        if (nodes.continueBtn) {
            const target = clean(data.target || params.get('target'));
            nodes.continueBtn.href = target || '/quick-payment';
            nodes.continueBtn.textContent = target ? 'Continue' : 'Done';
        }
    };

    const loadReceipt = async () => {
        renderReceipt(fallbackReceipt());
        try {
            const response = await fetch(`/api/payment-receipt?${params.toString()}`, {
                cache: 'no-store'
            });
            const payload = await response.json().catch(() => ({}));
            if (!response.ok || payload.ok === false) {
                throw new Error(payload.error || 'Unable to load receipt.');
            }
            renderReceipt(payload.receipt || {});
        } catch {
            if (nodes.verified) {
                nodes.verified.textContent = 'Payment successful. Receipt details may finish syncing shortly.';
                nodes.verified.classList.add('is-warning');
            }
        }
    };

    nodes.downloadBtn?.addEventListener('click', downloadReceipt);
    nodes.printBtn?.addEventListener('click', () => window.print());
    loadReceipt();
})();
