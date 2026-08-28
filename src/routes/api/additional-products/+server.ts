import { executeAdditionalProductOperation } from '$lib/server/cafe24/additional-products';
import { SESSION_BINDING_COOKIE } from '$lib/server/env';
import {
	PublicError,
	assertSameOrigin,
	errorResponse,
	jsonNoStore,
	readJsonBody
} from '$lib/server/http';
import type { RequestHandler } from './$types';

interface OperationRequest {
	envelope?: unknown;
	operation?: unknown;
}

export const POST: RequestHandler = async ({ request, url, cookies }) => {
	try {
		assertSameOrigin(request, url);
		const body = await readJsonBody<OperationRequest>(request, 24_000);
		if (typeof body.envelope !== 'string') {
			throw new PublicError(400, 'CREDENTIAL_REQUIRED', '암호화된 로그인 정보가 필요합니다.');
		}
		const response = await executeAdditionalProductOperation({
			envelope: body.envelope,
			sessionCookie: cookies.get(SESSION_BINDING_COOKIE),
			operation: body.operation
		});
		return jsonNoStore({ ok: true, ...response });
	} catch (error) {
		return errorResponse(error);
	}
};
