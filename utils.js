function generateId() {
    if (typeof window !== 'undefined' && window.crypto && window.crypto.randomUUID) {
        return window.crypto.randomUUID();
    }
    return Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
}

function formatCurrency(val) {
    const num = Number(val) || 0;
    return num.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function formatDate(dateStr) {
    if (!dateStr) return '-';
    const [y, m, d] = dateStr.split('-');
    
    // Check if userSettings is available globally
    let format = 'DD/MM/YYYY';
    if (typeof userSettings !== 'undefined' && userSettings.dateFormat) {
        format = userSettings.dateFormat;
    }
    
    if (format === 'YYYY-MM-DD') return `${y}-${m}-${d}`;
    return `${d}/${m}/${y}`;
}

function getMonthYear(dateStr) {
    if (!dateStr) return '';
    const [y, m] = dateStr.split('-');
    return `${y}-${m}`;
}

function getMonthName(dateStr) {
    const months = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
    const [y, m] = dateStr.split('-');
    return `${months[parseInt(m) - 1]}/${y.slice(2)}`;
}

function todayStr() {
    const d = new Date();
    const tzOffset = d.getTimezoneOffset() * 60000;
    return new Date(d.getTime() - tzOffset).toISOString().split('T')[0];
}

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = {
            generateId,
            formatCurrency,
            formatDate,
            getMonthYear,
            getMonthName,
            todayStr
        };
    }
