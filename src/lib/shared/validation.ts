import type { AdditionalProductOperation } from '$lib/shared/types';
import { PublicError } from '$lib/server/http';

export const MAX_PRODUCT_NO = 2_147_483_647;
export const MAX_ADDITIONAL_PRODUCTS = 10;

export function normalizeMallId(input: unknown) {
	const value = typeof input === 'string' ? input.trim().toLowerCase() : '';
	if (!/^[a-z0-9][a-z0-9_-]{1,39}$/.test(value)) {
		throw new PublicError(400, 'MALL_ID_INVALID', 'mall_id 형식이 올바르지 않습니다.');
	}
	return value;
}

export function normalizeShopNo(input: unknown) {
	const value = typeof input === 'string' || typeof input === 'number' ? String(input).trim() : '';
	if (!/^\d+$/.test(value)) {
		throw new PublicError(400, 'SHOP_NO_INVALID', 'shop_no는 양의 정수여야 합니다.');
	}
	const parsed = Number(value);
	if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > MAX_PRODUCT_NO) {
		throw new PublicError(400, 'SHOP_NO_INVALID', 'shop_no는 양의 정수여야 합니다.');
	}
	return String(parsed);
}

function positiveProductNo(value: unknown, field: string) {
	if (!Number.isInteger(value) || Number(value) < 1 || Number(value) > MAX_PRODUCT_NO) {
		throw new PublicError(
			400,
			'OPERATION_INVALID',
			`${field}는 1 이상 ${MAX_PRODUCT_NO} 이하의 정수여야 합니다.`
		);
	}
	return Number(value);
}

export function validateAdditionalProductOperation(input: unknown): AdditionalProductOperation {
	if (!input || typeof input !== 'object' || Array.isArray(input)) {
		throw new PublicError(400, 'OPERATION_INVALID', '추가구성상품 요청 형식이 올바르지 않습니다.');
	}
	const candidate = input as Record<string, unknown>;
	if (candidate.method !== 'POST' && candidate.method !== 'PUT') {
		throw new PublicError(400, 'OPERATION_INVALID', '처리방식은 POST 또는 PUT이어야 합니다.');
	}
	const row = Number(candidate.row);
	if (!Number.isInteger(row) || row < 1 || row > 10_000) {
		throw new PublicError(400, 'OPERATION_INVALID', 'CSV 행 번호가 올바르지 않습니다.');
	}
	const productNo = positiveProductNo(candidate.productNo, '기준상품번호');
	if (!Array.isArray(candidate.additionalProducts)) {
		throw new PublicError(400, 'OPERATION_INVALID', '추가구성상품번호 목록이 필요합니다.');
	}
	if (
		candidate.additionalProducts.length < 1 ||
		candidate.additionalProducts.length > MAX_ADDITIONAL_PRODUCTS
	) {
		throw new PublicError(
			400,
			'OPERATION_INVALID',
			`추가구성상품은 1개 이상 ${MAX_ADDITIONAL_PRODUCTS}개 이하로 입력해야 합니다.`
		);
	}
	const additionalProducts = candidate.additionalProducts.map((value) =>
		positiveProductNo(value, '추가구성상품번호')
	);
	if (new Set(additionalProducts).size !== additionalProducts.length) {
		throw new PublicError(
			400,
			'OPERATION_INVALID',
			'추가구성상품번호를 중복해서 입력할 수 없습니다.'
		);
	}
	if (additionalProducts.includes(productNo)) {
		throw new PublicError(
			400,
			'OPERATION_INVALID',
			'기준상품과 같은 상품을 추가구성상품으로 지정할 수 없습니다.'
		);
	}
	return { row, method: candidate.method, productNo, additionalProducts };
}
