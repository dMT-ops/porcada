import { describe, it, expect } from 'vitest';
import { formatCurrency, formatDate, getMonthYear, getMonthName } from './utils.js';

describe('Utils', () => {
    describe('formatCurrency', () => {
        it('should format numbers correctly to BRL', () => {
            const formatted = formatCurrency(1234.56);
            // non-breaking space is used in BRL formatting (\xa0)
            expect(formatted.replace(/\s/g, ' ')).toContain('R$ 1.234,56');
        });

        it('should handle zero', () => {
            const formatted = formatCurrency(0);
            expect(formatted.replace(/\s/g, ' ')).toContain('R$ 0,00');
        });

        it('should handle strings that can be converted to numbers', () => {
            const formatted = formatCurrency("1500.5");
            expect(formatted.replace(/\s/g, ' ')).toContain('R$ 1.500,50');
        });

        it('should return R$ 0,00 for invalid inputs', () => {
            const formatted = formatCurrency(null);
            expect(formatted.replace(/\s/g, ' ')).toContain('R$ 0,00');
        });
    });

    describe('formatDate', () => {
        it('should convert YYYY-MM-DD to DD/MM/YYYY', () => {
            expect(formatDate('2026-07-07')).toBe('07/07/2026');
        });

        it('should handle empty input', () => {
            expect(formatDate('')).toBe('-');
            expect(formatDate(null)).toBe('-');
        });
    });

    describe('getMonthYear', () => {
        it('should extract YYYY-MM from YYYY-MM-DD', () => {
            expect(getMonthYear('2026-07-07')).toBe('2026-07');
        });

        it('should handle empty input', () => {
            expect(getMonthYear('')).toBe('');
        });
    });

    describe('getMonthName', () => {
        it('should convert YYYY-MM to Month/YY', () => {
            expect(getMonthName('2026-07-07')).toBe('Jul/26');
            expect(getMonthName('2026-01-01')).toBe('Jan/26');
        });
    });
});
