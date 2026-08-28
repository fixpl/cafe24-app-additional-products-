import type { ApiErrorResponse } from '$lib/shared/types';

export class PublicError extends Error {
	constructor(
		public readonly status: number,
		public readonly code: string,
		message: string,
		public readonly reauthorize = false
	) {
		super(message);
	}
}

export function jsonNoStore<T>(body: T, init: ResponseInit = {}) {
	const headers = new Headers(init.headers);
	headers.set('cache-control', 'no-store, no-cache, must-revalidate, private');
	headers.set('content-type', 'application/json; charset=utf-8');
	headers.set('x-content-type-options', 'nosniff');
	return new Response(JSON.stringify(body), { ...init, headers });
}

export function errorResponse(error: unknown) {
	const publicError =
		error instanceof PublicError
			? error
			: new PublicError(
					500,
					'INTERNAL_ERROR',
					'요청을 처리하지 못했습니다. 잠시 후 다시 시도해주세요.'
				);
	return jsonNoStore<ApiErrorResponse>(
		{
			ok: false,
			error: {
				code: publicError.code,
				message: publicError.message,
				reauthorize: publicError.reauthorize
			}
		},
		{ status: publicError.status }
	);
}

export function assertSameOrigin(request: Request, currentUrl: URL) {
	const origin = request.headers.get('origin');
	if (!origin || origin !== currentUrl.origin) {
		throw new PublicError(403, 'ORIGIN_REJECTED', '다른 출처에서 보낸 요청은 허용되지 않습니다.');
	}
	const fetchSite = request.headers.get('sec-fetch-site');
	if (fetchSite && fetchSite !== 'same-origin' && fetchSite !== 'same-site') {
		throw new PublicError(403, 'ORIGIN_REJECTED', '다른 출처에서 보낸 요청은 허용되지 않습니다.');
	}
}

export async function readJsonBody<T>(request: Request, maxBytes = 32_768): Promise<T> {
	if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) {
		throw new PublicError(415, 'JSON_REQUIRED', 'JSON 요청만 허용됩니다.');
	}
	const length = Number(request.headers.get('content-length') ?? '0');
	if (Number.isFinite(length) && length > maxBytes) {
		throw new PublicError(413, 'BODY_TOO_LARGE', '요청 본문이 너무 큽니다.');
	}
	const text = await request.text();
	if (Buffer.byteLength(text, 'utf8') > maxBytes) {
		throw new PublicError(413, 'BODY_TOO_LARGE', '요청 본문이 너무 큽니다.');
	}
	try {
		return JSON.parse(text) as T;
	} catch {
		throw new PublicError(400, 'INVALID_JSON', 'JSON 형식이 올바르지 않습니다.');
	}
}
