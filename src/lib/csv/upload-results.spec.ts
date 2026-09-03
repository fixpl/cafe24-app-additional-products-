import { describe, expect, it } from 'vitest';
import { createUploadResultsCsv, createUploadResultsFileName } from './upload-results';

describe('createUploadResultsCsv', () => {
	it('요청값, Cafe24 응답, HTTP 상태와 실패 메시지를 CSV로 만든다', () => {
		const csv = createUploadResultsCsv({
			results: [
				{
					row: 2,
					productNo: 2175,
					method: 'POST',
					ok: true,
					message: '등록했습니다.',
					requestedAdditionalProducts: [2176, 2178],
					returnedAdditionalProducts: [2176, 2178],
					httpStatus: 200,
					totalCount: 2
				},
				{
					row: 3,
					productNo: 3001,
					method: 'PUT',
					ok: false,
					message: '=Cafe24 요청 거절, 다시 확인',
					requestedAdditionalProducts: [3002],
					returnedAdditionalProducts: null,
					httpStatus: 422,
					totalCount: null
				}
			]
		});

		expect(csv).toBe(
			'\uFEFF처리행,기준상품번호,요청 추가구성상품번호,Cafe24 응답 추가구성상품번호,처리방식,HTTP 상태,응답 총 개수,결과,Cafe24 응답 메시지\r\n' +
				'2,2175,2176 | 2178,2176 | 2178,POST,200,2,성공,등록했습니다.\r\n' +
				"3,3001,3002,'-,PUT,422,'-,실패,\"'=Cafe24 요청 거절, 다시 확인\"\r\n"
		);
	});

	it('이전 업로드 기록처럼 응답 상세가 없는 경우에도 내려받을 수 있다', () => {
		const csv = createUploadResultsCsv({
			results: [{ row: 2, productNo: 1001, method: null, ok: false, message: '중단됨' }]
		});

		expect(csv).toContain("2,1001,'-,'-,'-,'-,'-,실패,중단됨");
	});
});

describe('createUploadResultsFileName', () => {
	it('원본 CSV 또는 XLSX 이름에서 결과 파일 이름을 만든다', () => {
		expect(createUploadResultsFileName('추가구성상품.csv')).toBe('추가구성상품-results.csv');
		expect(createUploadResultsFileName('추가구성상품.xlsx')).toBe('추가구성상품-results.csv');
	});
});
