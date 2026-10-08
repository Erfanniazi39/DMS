import { ConflictException } from '@nestjs/common';
import { agingBucketOf, ensureCustomerPaymentTransition } from './receivables-rules';

describe('receivables-rules', () => {
  describe('ensureCustomerPaymentTransition', () => {
    it('allows PENDING -> COMPLETED (cheque clears)', () => {
      expect(() => ensureCustomerPaymentTransition('PENDING', 'COMPLETED')).not.toThrow();
    });
    it('allows PENDING -> CANCELLED (cheque bounces)', () => {
      expect(() => ensureCustomerPaymentTransition('PENDING', 'CANCELLED')).not.toThrow();
    });
    it('allows COMPLETED -> CANCELLED (cancel)', () => {
      expect(() => ensureCustomerPaymentTransition('COMPLETED', 'CANCELLED')).not.toThrow();
    });
    it('rejects COMPLETED -> PENDING', () => {
      expect(() => ensureCustomerPaymentTransition('COMPLETED', 'PENDING')).toThrow(ConflictException);
    });
    it('rejects any move out of CANCELLED (terminal)', () => {
      expect(() => ensureCustomerPaymentTransition('CANCELLED', 'COMPLETED')).toThrow(ConflictException);
      expect(() => ensureCustomerPaymentTransition('CANCELLED', 'PENDING')).toThrow(ConflictException);
    });
  });

  describe('agingBucketOf', () => {
    it('buckets non-positive days as CURRENT', () => {
      expect(agingBucketOf(0)).toBe('CURRENT');
      expect(agingBucketOf(-5)).toBe('CURRENT');
    });
    it('buckets 1-30 days overdue', () => {
      expect(agingBucketOf(1)).toBe('D1_30');
      expect(agingBucketOf(30)).toBe('D1_30');
    });
    it('buckets 31-60 days overdue', () => {
      expect(agingBucketOf(31)).toBe('D31_60');
      expect(agingBucketOf(60)).toBe('D31_60');
    });
    it('buckets 61-90 days overdue', () => {
      expect(agingBucketOf(61)).toBe('D61_90');
      expect(agingBucketOf(90)).toBe('D61_90');
    });
    it('buckets more than 90 days overdue as D90_PLUS', () => {
      expect(agingBucketOf(91)).toBe('D90_PLUS');
      expect(agingBucketOf(400)).toBe('D90_PLUS');
    });
  });
});
