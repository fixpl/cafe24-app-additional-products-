import { resolveCafe24ProductCodes } from '$lib/server/cafe24/products';
import { SESSION_BINDING_COOKIE } from '$lib/server/env';
import {
	PublicError,
	assertSameOrigin,
	errorResponse,
	jsonNoStore,
	readJsonBody
} from '$lib/server/http';
import type { RequestHandler } from './$types';

interface ProductCodeRequest {
	envelope?: unknown;
	productCodes?: unknown;
}

export const POST: RequestHandler = async ({ request, url, cookies }) => {
	try {
		assertSameOrigin(request, url);
		const body = await readJsonBody<ProductCodeRequest>(request, 768_000);
		if (typeof body.envelope !== 'string') {
			throw new PublicError(400, 'CREDENTIAL_REQUIRED', '암호화된 로그인 정보가 필요합니다.');
		}
		const response = await resolveCafe24ProductCodes({
			envelope: body.envelope,
			sessionCookie: cookies.get(SESSION_BINDING_COOKIE),
			productCodes: body.productCodes,
			signal: request.signal
		});
		return jsonNoStore({ ok: true, ...response });
	} catch (error) {
		return errorResponse(error);
	}
};
