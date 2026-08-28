import { describe, expect, it } from 'vitest';
import { PublicError } from '$lib/server/http';
import {
	MAX_ADDITIONAL_PRODUCTS,
	MAX_PRODUCT_NO,
	normalizeMallId,
	normalizeShopNo,
	validateAdditionalProductOperation
} from './validation';

describe('normalizeMallId', () => {
	it('허용된 mall_id를 소문자로 정규화한다', () => {
		expect(normalizeMallId(' SampleMall_01 ')).toBe('samplemall_01');
	});

	it('허용되지 않은 mall_id를 거절한다', () => {
		expect(() => normalizeMallId('bad.mall')).toThrow(PublicError);
	});
});

describe('normalizeShopNo', () => {
	it('양의 정수 문자열을 유지한다', () => {
		expect(normalizeShopNo('001')).toBe('1');
	});

	it('범위를 벗어난 값을 거절한다', () => {
		expect(() => normalizeShopNo(String(MAX_PRODUCT_NO + 1))).toThrow(PublicError);
	});
});

describe('validateAdditionalProductOperation', () => {
	it('정상 요청을 그대로 통과시킨다', () => {
		expect(
			validateAdditionalProductOperation({
				row: 2,
				method: 'POST',
				productNo: 1001,
				additionalProducts: [2001, 2002]
			})
		).toEqual({
			row: 2,
			method: 'POST',
			productNo: 1001,
			additionalProducts: [2001, 2002]
		});
	});

	it('중복 추가구성상품을 거절한다', () => {
		expect(() =>
			validateAdditionalProductOperation({
				row: 2,
				method: 'PUT',
				productNo: 1001,
				additionalProducts: [2001, 2001]
			})
		).toThrow(PublicError);
	});

	it('기준상품 자기 자신을 추가구성상품으로 넣으면 거절한다', () => {
		expect(() =>
			validateAdditionalProductOperation({
				row: 2,
				method: 'POST',
				productNo: 1001,
				additionalProducts: [1001]
			})
		).toThrow(PublicError);
	});

	it(`추가구성상품이 ${MAX_ADDITIONAL_PRODUCTS}개를 초과하면 거절한다`, () => {
		expect(() =>
			validateAdditionalProductOperation({
				row: 2,
				method: 'POST',
				productNo: 1001,
				additionalProducts: Array.from(
					{ length: MAX_ADDITIONAL_PRODUCTS + 1 },
					(_, index) => 2001 + index
				)
			})
		).toThrow(PublicError);
	});
});
