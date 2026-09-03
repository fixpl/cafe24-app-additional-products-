import type { ProductCodeResolution, TokenEnvelopeRecord } from '$lib/shared/types';
import { getCafe24ApiVersion, getRequestTimeoutMs } from '$lib/server/env';
import { PublicError } from '$lib/server/http';
import {
	assertSessionBinding,
	decryptTokenEnvelope,
	encryptTokenPayload,
	toTokenEnvelopeRecord,
	type TokenPayload
} from './crypto';
import { refreshCafe24Token } from './oauth';

const ACCESS_TOKEN_REFRESH_BUFFER_MS = 5 * 60_000;
const MAX_PRODUCT_CODES = 100;
const RATE_LIMIT_RETRY_FALLBACK_MS = 1_000;
const RATE_LIMIT_RETRY_GUARD_MS = 250;
const PRODUCT_CODE_PATTERN = /^[A-Za-z][A-Za-z0-9_-]{0,99}$/;

interface RemoteCall {
	status: number;
	ok: boolean;
	body: unknown;
	callRemain: string | null;
	timeRemain: string | null;
}

interface ProductRecord {
	productCode: string;
	productNo: number;
}

export async function resolveCafe24ProductCodes(params: {
	envelope: string;
	sessionCookie: string | undefined;
	productCodes: unknown;
	signal?: AbortSignal;
}): Promise<{ resolutions: ProductCodeResolution[]; credential: TokenEnvelopeRecord | null }> {
	const productCodes = validateProductCodes(params.productCodes);
	const decrypted = decryptTokenEnvelope(params.envelope);
	assertSessionBinding(decrypted.payload, params.sessionCookie);
	let payload = decrypted.payload;
	let credentialChanged = decrypted.needsKeyRotation;
	let refreshed = false;
	if (isExpiring(payload.accessTokenExpiresAt, ACCESS_TOKEN_REFRESH_BUFFER_MS)) {
		payload = await refreshCafe24Token(payload);
		credentialChanged = true;
		refreshed = true;
	}

	const outcome = await callProductCodesWithRefresh(
		payload,
		productCodes,
		refreshed,
		params.signal
	);
	payload = outcome.payload;
	credentialChanged ||= outcome.refreshed;
	const records = outcome.records;

	const productNosByCode = new Map<string, Set<number>>();
	for (const record of records) {
		if (!productCodes.includes(record.productCode)) continue;
		const productNos = productNosByCode.get(record.productCode) ?? new Set<number>();
		productNos.add(record.productNo);
		productNosByCode.set(record.productCode, productNos);
	}

	const resolutions = productCodes.map((productCode) => {
		const productNos = [...(productNosByCode.get(productCode) ?? [])];
		if (productNos.length === 1) {
			return { productCode, productNo: productNos[0], message: null };
		}
		if (productNos.length > 1) {
			return {
				productCode,
				productNo: null,
				message: 'Cafe24에서 동일한 상품코드를 여러 상품으로 반환했습니다.'
			};
		}
		return {
			productCode,
			productNo: null,
			message: 'Cafe24에서 해당 상품코드를 찾지 못했습니다.'
		};
	});

	return {
		resolutions,
		credential: credentialChanged
			? toTokenEnvelopeRecord(payload, encryptTokenPayload(payload))
			: null
	};
}

async function callProductCodesWithRefresh(
	payload: TokenPayload,
	productCodes: string[],
	alreadyRefreshed: boolean,
	signal: AbortSignal | undefined
): Promise<{ payload: TokenPayload; records: ProductRecord[]; refreshed: boolean }> {
	let remote = await callCafe24ProductList(payload, productCodes, signal);
	if (remote.status === 401) {
		if (alreadyRefreshed) throw reauthorizationRequired();
		payload = await refreshCafe24Token(payload);
		remote = await callCafe24ProductList(payload, productCodes, signal);
		if (remote.status === 401) throw reauthorizationRequired();
		alreadyRefreshed = true;
	}

	while (remote.status === 429) {
		await wait(rateLimitRetryDelay(remote), signal);
		remote = await callCafe24ProductList(payload, productCodes, signal);
		if (remote.status === 401) {
			if (alreadyRefreshed) throw reauthorizationRequired();
			payload = await refreshCafe24Token(payload);
			remote = await callCafe24ProductList(payload, productCodes, signal);
			if (remote.status === 401) throw reauthorizationRequired();
			alreadyRefreshed = true;
		}
	}

	if (!remote.ok) throw remoteFailure(remote);
	return { payload, records: parseProductRecords(remote.body), refreshed: alreadyRefreshed };
}

async function callCafe24ProductList(
	payload: TokenPayload,
	productCodes: string[],
	signal: AbortSignal | undefined
): Promise<RemoteCall> {
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), getRequestTimeoutMs());
	let response: Response;
	try {
		const url = new URL(`https://${payload.mallId}.cafe24api.com/api/v2/admin/products`);
		url.searchParams.set('shop_no', payload.shopNo);
		url.searchParams.set('product_code', productCodes.join(','));
		url.searchParams.set('fields', 'product_no,product_code');
		url.searchParams.set('limit', String(MAX_PRODUCT_CODES));
		response = await fetch(url, {
			headers: {
				authorization: `Bearer ${payload.accessToken}`,
				accept: 'application/json',
				'X-Cafe24-Api-Version': getCafe24ApiVersion()
			},
			signal: signal ? AbortSignal.any([controller.signal, signal]) : controller.signal
		});
	} catch (error) {
		if (error instanceof Error && error.name === 'AbortError') {
			throw new PublicError(499, 'REQUEST_ABORTED', '상품코드 확인을 중단했습니다.');
		}
		throw new PublicError(502, 'CAFE24_UNAVAILABLE', 'Cafe24 상품 API에 연결하지 못했습니다.');
	} finally {
		clearTimeout(timeout);
	}
	const text = await response.text();
	let body: unknown;
	try {
		body = text ? JSON.parse(text) : null;
	} catch {
		body = null;
	}
	return {
		status: response.status,
		ok: response.ok,
		body,
		callRemain: response.headers.get('X-Cafe24-Call-Remain'),
		timeRemain: response.headers.get('X-Cafe24-Time-Remain')
	};
}

function validateProductCodes(value: unknown): string[] {
	if (!Array.isArray(value)) {
		throw new PublicError(400, 'PRODUCT_CODES_INVALID', '상품코드 목록이 필요합니다.');
	}
	if (value.length === 0 || value.length > MAX_PRODUCT_CODES) {
		throw new PublicError(
			400,
			'PRODUCT_CODES_TOO_MANY',
			`상품코드는 1개 이상 ${MAX_PRODUCT_CODES}개 이하로 확인할 수 있습니다.`
		);
	}
	const codes: string[] = [];
	const seen = new Set<string>();
	for (const item of value) {
		const code = typeof item === 'string' ? item.trim() : '';
		if (!PRODUCT_CODE_PATTERN.test(code)) {
			throw new PublicError(400, 'PRODUCT_CODE_INVALID', '상품코드 형식이 올바르지 않습니다.');
		}
		if (!seen.has(code)) {
			seen.add(code);
			codes.push(code);
		}
	}
	return codes;
}

function parseProductRecords(body: unknown): ProductRecord[] {
	const products = isRecord(body) && Array.isArray(body.products) ? body.products : null;
	if (!products) {
		throw new PublicError(
			502,
			'CAFE24_RESPONSE_INVALID',
			'Cafe24 상품 조회 응답 형식이 올바르지 않습니다.'
		);
	}
	return products.flatMap((product) => {
		if (!isRecord(product)) return [];
		const productNo = product.product_no;
		const productCode = product.product_code;
		if (
			!Number.isInteger(productNo) ||
			Number(productNo) < 1 ||
			typeof productCode !== 'string' ||
			!PRODUCT_CODE_PATTERN.test(productCode)
		) {
			return [];
		}
		return [{ productCode, productNo: Number(productNo) }];
	});
}

function remoteFailure(remote: RemoteCall) {
	if (remote.status === 403) {
		return new PublicError(
			403,
			'CAFE24_PRODUCT_READ_FORBIDDEN',
			'Cafe24 상품 조회 권한을 확인해주세요.'
		);
	}
	return new PublicError(
		502,
		'CAFE24_PRODUCT_LOOKUP_FAILED',
		`Cafe24 상품코드 조회에 실패했습니다. (HTTP ${remote.status})`
	);
}

function rateLimitRetryDelay(remote: RemoteCall) {
	const values = [remote.callRemain, remote.timeRemain].flatMap((value) => {
		const seconds = Number(value);
		return Number.isFinite(seconds) && seconds >= 0 ? [seconds] : [];
	});
	return values.length === 0
		? RATE_LIMIT_RETRY_FALLBACK_MS
		: Math.ceil(Math.max(...values) * 1_000) + RATE_LIMIT_RETRY_GUARD_MS;
}

function wait(milliseconds: number, signal: AbortSignal | undefined) {
	return new Promise<void>((resolve, reject) => {
		if (signal?.aborted) {
			reject(new PublicError(499, 'REQUEST_ABORTED', '상품코드 확인을 중단했습니다.'));
			return;
		}
		const timeout = setTimeout(done, milliseconds);
		function done() {
			signal?.removeEventListener('abort', abort);
			resolve();
		}
		function abort() {
			clearTimeout(timeout);
			signal?.removeEventListener('abort', abort);
			reject(new PublicError(499, 'REQUEST_ABORTED', '상품코드 확인을 중단했습니다.'));
		}
		signal?.addEventListener('abort', abort, { once: true });
	});
}

function reauthorizationRequired() {
	return new PublicError(
		401,
		'CAFE24_REAUTHORIZE',
		'Cafe24 로그인이 유효하지 않습니다. 다시 로그인해주세요.',
		true
	);
}

function isExpiring(value: string, offsetMs: number) {
	const timestamp = Date.parse(value);
	return !Number.isFinite(timestamp) || timestamp <= Date.now() + offsetMs;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
