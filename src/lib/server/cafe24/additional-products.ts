import type {
	AdditionalProductMethod,
	AdditionalProductOperation,
	AdditionalProductResult,
	RateLimitSummary,
	TokenEnvelopeRecord
} from '$lib/shared/types';
import { validateAdditionalProductOperation } from '$lib/shared/validation';
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

interface RemoteCall {
	status: number;
	ok: boolean;
	body: unknown;
	rateLimit: RateLimitSummary;
}

interface Cafe24Request {
	method: 'GET' | AdditionalProductMethod;
	operation: AdditionalProductOperation;
}

interface Cafe24RequestOutcome {
	payload: TokenPayload;
	remote: RemoteCall;
	refreshed: boolean;
}

export async function executeAdditionalProductOperation(params: {
	envelope: string;
	sessionCookie: string | undefined;
	operation: unknown;
}): Promise<{ result: AdditionalProductResult; credential: TokenEnvelopeRecord | null }> {
	const operation = validateAdditionalProductOperation(params.operation);
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

	const current = await callCafe24WithRefresh(payload, { method: 'GET', operation }, refreshed);
	payload = current.payload;
	refreshed = current.refreshed;
	credentialChanged ||= refreshed;
	if (!current.remote.ok) {
		return {
			result: failureResult(current.remote, operation, null),
			credential: credentialChanged
				? toTokenEnvelopeRecord(payload, encryptTokenPayload(payload))
				: null
		};
	}

	const method = resolveAdditionalProductMethod(current.remote, operation);
	const write = await callCafe24WithRefresh(payload, { method, operation }, refreshed);
	payload = write.payload;
	refreshed = write.refreshed;
	credentialChanged ||= refreshed;
	const result = normalizeResult(write.remote, operation, method);
	let credential: TokenEnvelopeRecord | null = null;
	if (credentialChanged) {
		const envelope = encryptTokenPayload(payload);
		credential = toTokenEnvelopeRecord(payload, envelope);
	}
	return { result, credential };
}

async function callCafe24WithRefresh(
	payload: TokenPayload,
	request: Cafe24Request,
	alreadyRefreshed: boolean
): Promise<Cafe24RequestOutcome> {
	let remote = await callCafe24AdditionalProducts(payload, request);
	if (remote.status !== 401) return { payload, remote, refreshed: alreadyRefreshed };
	if (alreadyRefreshed) throw reauthorizationRequired();

	const refreshedPayload = await refreshCafe24Token(payload);
	remote = await callCafe24AdditionalProducts(refreshedPayload, request);
	if (remote.status === 401) throw reauthorizationRequired();
	return { payload: refreshedPayload, remote, refreshed: true };
}

function reauthorizationRequired() {
	return new PublicError(
		401,
		'CAFE24_REAUTHORIZE',
		'Cafe24 로그인이 유효하지 않습니다. 다시 로그인해주세요.',
		true
	);
}

async function callCafe24AdditionalProducts(payload: TokenPayload, request: Cafe24Request) {
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), getRequestTimeoutMs());
	let response: Response;
	try {
		const headers: Record<string, string> = {
			authorization: `Bearer ${payload.accessToken}`,
			accept: 'application/json',
			'X-Cafe24-Api-Version': getCafe24ApiVersion()
		};
		if (request.method !== 'GET') headers['content-type'] = 'application/json';
		response = await fetch(
			`https://${payload.mallId}.cafe24api.com/api/v2/admin/products/${request.operation.productNo}/additionalproducts`,
			{
				method: request.method,
				headers,
				body:
					request.method === 'GET'
						? undefined
						: JSON.stringify({
								request: { additional_products: request.operation.additionalProducts }
							}),
				signal: controller.signal
			}
		);
	} catch (error) {
		if (error instanceof Error && error.name === 'AbortError') {
			throw new PublicError(504, 'CAFE24_TIMEOUT', 'Cafe24 상품 API 응답 시간이 초과되었습니다.');
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
		rateLimit: readRateLimit(response.headers)
	} satisfies RemoteCall;
}

function resolveAdditionalProductMethod(remote: RemoteCall, operation: AdditionalProductOperation) {
	const current = parseAdditionalProductResponse(remote.body);
	if (current.productNo !== operation.productNo) {
		throw new PublicError(
			502,
			'CAFE24_RESPONSE_INVALID',
			'Cafe24 추가구성상품 조회 결과의 기준상품번호가 일치하지 않습니다.'
		);
	}
	return current.totalCount > 0 ? 'PUT' : 'POST';
}

function normalizeResult(
	remote: RemoteCall,
	operation: AdditionalProductOperation,
	method: AdditionalProductMethod
): AdditionalProductResult {
	if (!remote.ok) return failureResult(remote, operation, method);
	const response = parseAdditionalProductResponse(remote.body);
	return {
		ok: true,
		status: remote.status,
		method,
		productNo: response.productNo,
		additionalProducts: response.additionalProducts,
		totalCount: response.totalCount,
		message: method === 'POST' ? '등록했습니다.' : '수정했습니다.',
		rateLimit: remote.rateLimit
	};
}

function failureResult(
	remote: RemoteCall,
	operation: AdditionalProductOperation,
	method: AdditionalProductMethod | null
): AdditionalProductResult {
	return {
		ok: false,
		status: remote.status,
		method,
		productNo: operation.productNo,
		additionalProducts: operation.additionalProducts,
		totalCount: null,
		message: remoteErrorMessage(remote.body, remote.status),
		rateLimit: remote.rateLimit
	};
}

function parseAdditionalProductResponse(body: unknown): {
	productNo: number;
	additionalProducts: number[];
	totalCount: number;
} {
	const response =
		isRecord(body) && isRecord(body.additionalproduct) ? body.additionalproduct : null;
	const responseProducts = response?.additional_products;
	const totalCount = response?.total_count;
	if (
		!response ||
		!Number.isInteger(response.product_no) ||
		!Array.isArray(responseProducts) ||
		!responseProducts.every((value) => Number.isInteger(value)) ||
		!Number.isInteger(totalCount) ||
		Number(totalCount) < 0
	) {
		throw new PublicError(
			502,
			'CAFE24_RESPONSE_INVALID',
			'Cafe24 추가구성상품 응답 형식이 올바르지 않습니다.'
		);
	}
	return {
		productNo: Number(response.product_no),
		additionalProducts: responseProducts.map(Number),
		totalCount: Number(totalCount)
	};
}

function remoteErrorMessage(body: unknown, status: number) {
	if (isRecord(body) && isRecord(body.error)) {
		const code = safeRemoteText(body.error.code, 64);
		const message = safeRemoteText(body.error.message, 180);
		if (message && code) return `${message} (${code})`;
		if (message) return message;
		if (code) return `Cafe24 API 요청이 거절되었습니다. (${code})`;
	}
	if (status === 429) return 'Cafe24 API 호출 한도에 도달했습니다. 잠시 후 다시 시도해주세요.';
	if (status >= 500) return 'Cafe24 상품 API가 요청을 처리하지 못했습니다.';
	return `Cafe24 API 요청이 실패했습니다. (HTTP ${status})`;
}

function safeRemoteText(value: unknown, maxLength: number) {
	if (typeof value !== 'string') return null;
	const normalized = [...value]
		.map((character) => {
			const code = character.charCodeAt(0);
			return code <= 31 || code === 127 ? ' ' : character;
		})
		.join('')
		.replace(/\s+/g, ' ')
		.trim();
	return normalized ? normalized.slice(0, maxLength) : null;
}

function readRateLimit(headers: Headers): RateLimitSummary {
	return {
		callUsage: firstHeader(headers, ['X-Api-Call-Limit', 'X-Cafe24-Api-Call-Limit']),
		callRemain: firstHeader(headers, ['X-Api-Call-Remaining', 'X-Cafe24-Api-Call-Remaining']),
		timeUsage: firstHeader(headers, ['X-Api-Time-Limit', 'X-Cafe24-Api-Time-Limit']),
		timeRemain: firstHeader(headers, ['X-Api-Time-Remaining', 'X-Cafe24-Api-Time-Remaining'])
	};
}

function firstHeader(headers: Headers, names: string[]) {
	for (const name of names) {
		const value = headers.get(name);
		if (value) return value.slice(0, 100);
	}
	return null;
}

function isExpiring(value: string, offsetMs: number) {
	const timestamp = Date.parse(value);
	return !Number.isFinite(timestamp) || timestamp <= Date.now() + offsetMs;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
