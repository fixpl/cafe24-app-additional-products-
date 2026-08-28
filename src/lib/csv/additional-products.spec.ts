import { describe, expect, it } from 'vitest';
import {
	createTemplateCsv,
	parseAdditionalProductsCsv,
	type AdditionalProductOperation
} from './additional-products';

const HEADERS = [
	'처리방식',
	'기준상품번호',
	...Array.from({ length: 10 }, (_, index) => `추가구성상품번호${index + 1}`)
];
const HEADER = HEADERS.join(',');

function operation(
	row: number,
	method: AdditionalProductOperation['method'],
	productNo: number,
	additionalProducts: number[]
): AdditionalProductOperation {
	return { row, method, productNo, additionalProducts };
}

describe('createTemplateCsv', () => {
	it('Excel에서 인식할 수 있는 BOM과 CRLF로 정확한 헤더를 만든다', () => {
		expect(createTemplateCsv()).toBe(`\uFEFF${HEADER}\r\n`);
	});
});

describe('parseAdditionalProductsCsv', () => {
	it('정상 등록 행과 수정 행을 파싱한다', () => {
		const result = parseAdditionalProductsCsv(`${HEADER}\r\n등록,1001,2001,2002\r\n수정,1002,2003`);

		expect(result.issues).toEqual([]);
		expect(result.operations).toEqual([
			operation(2, 'POST', 1001, [2001, 2002]),
			operation(3, 'PUT', 1002, [2003])
		]);
	});

	it('한글과 대소문자가 다른 영문 처리방식을 모두 지원한다', () => {
		const result = parseAdditionalProductsCsv(
			`${HEADER}\n등록,1,11\npost,2,12\n수정,3,13\npUt,4,14`
		);

		expect(result.issues).toEqual([]);
		expect(result.operations.map(({ method }) => method)).toEqual(['POST', 'POST', 'PUT', 'PUT']);
	});

	it('BOM, LF, quoted newline, quoted comma, escaped quote를 파싱한다', () => {
		const quotedHeader = HEADERS.map((header) => `"${header}"`).join(',');
		const csv = `\uFEFF${quotedHeader}\n"등록","100","\n200\n"\n"PO""ST,임의",101,201\nPUT,102,202`;
		const result = parseAdditionalProductsCsv(csv);

		expect(result.operations).toEqual([
			operation(2, 'POST', 100, [200]),
			operation(6, 'PUT', 102, [202])
		]);
		expect(result.issues).toEqual([expect.objectContaining({ row: 5, column: '처리방식' })]);
	});

	it('중복, 누락, 알 수 없는 헤더를 각각 검출한다', () => {
		const duplicateHeaders = [...HEADERS];
		duplicateHeaders[2] = '기준상품번호';
		const unknownHeaders = [...HEADERS];
		unknownHeaders[2] = '알수없음';

		const duplicate = parseAdditionalProductsCsv(duplicateHeaders.join(','));
		const missing = parseAdditionalProductsCsv(HEADERS.slice(0, -1).join(','));
		const unknown = parseAdditionalProductsCsv(unknownHeaders.join(','));

		expect(duplicate.operations).toEqual([]);
		expect(duplicate.issues.some(({ message }) => message.includes('중복된 헤더'))).toBe(true);
		expect(missing.issues.some(({ message }) => message.includes('필수 헤더'))).toBe(true);
		expect(unknown.issues.some(({ message }) => message.includes('알 수 없는 헤더'))).toBe(true);
	});

	it('닫히지 않은 인용부호를 검출하고 해당 행을 제외한다', () => {
		const result = parseAdditionalProductsCsv(`${HEADER}\nPOST,100,"200`);

		expect(result.operations).toEqual([]);
		expect(result.issues).toEqual([
			expect.objectContaining({ row: 2, message: expect.stringContaining('닫히지 않은') })
		]);
	});

	it('상품번호는 Cafe24 허용 범위의 양의 정수만 허용한다', () => {
		const unsafe = Number.MAX_SAFE_INTEGER + 1;
		const result = parseAdditionalProductsCsv(
			`${HEADER}\nPOST,0,200\nPOST,101,-1\nPOST,102,1.5\nPOST,${unsafe},203`
		);

		expect(result.operations).toEqual([]);
		expect(result.issues).toHaveLength(4);
		expect(result.issues.every(({ message }) => message.includes('1 이상 2147483647 이하'))).toBe(
			true
		);
	});

	it('추가구성상품번호의 중복과 자기 자신을 검출한다', () => {
		const result = parseAdditionalProductsCsv(`${HEADER}\nPOST,100,200,200\nPUT,101,101`);

		expect(result.operations).toEqual([]);
		expect(result.issues).toEqual([
			expect.objectContaining({ row: 2, message: expect.stringContaining('중복') }),
			expect.objectContaining({ row: 3, message: expect.stringContaining('동일한') })
		]);
	});

	it('동일한 기준상품번호가 다시 나오면 뒤의 행을 제외한다', () => {
		const result = parseAdditionalProductsCsv(`${HEADER}\nPOST,100,200\nPUT,100,201`);

		expect(result.operations).toEqual([operation(2, 'POST', 100, [200])]);
		expect(result.issues).toEqual([
			expect.objectContaining({
				row: 3,
				column: '기준상품번호',
				message: expect.stringContaining('중복')
			})
		]);
	});

	it('추가구성상품이 10개를 초과하면 행을 제외한다', () => {
		const additionalProducts = Array.from({ length: 11 }, (_, index) => 200 + index);
		const result = parseAdditionalProductsCsv(
			`${HEADER}\nPOST,100,${additionalProducts.join(',')}`
		);

		expect(result.operations).toEqual([]);
		expect(result.issues).toEqual([
			expect.objectContaining({ row: 2, message: expect.stringContaining('최대 10개') })
		]);
	});

	it('오류 행만 제외하고 다른 유효한 행은 유지한다', () => {
		const result = parseAdditionalProductsCsv(
			`${HEADER}\nPOST,100,200\nDELETE,101,201\nPUT,102,202`
		);

		expect(result.operations).toEqual([
			operation(2, 'POST', 100, [200]),
			operation(4, 'PUT', 102, [202])
		]);
		expect(result.issues).toEqual([expect.objectContaining({ row: 3, column: '처리방식' })]);
	});

	it('200개를 초과한 데이터 행을 제외하고 이슈를 반환한다', () => {
		const rows = Array.from({ length: 201 }, (_, index) => `POST,${index + 1},${index + 1001}`);
		const result = parseAdditionalProductsCsv(`${HEADER}\n${rows.join('\n')}`);

		expect(result.operations).toHaveLength(200);
		expect(result.issues).toEqual([
			expect.objectContaining({ row: 202, message: expect.stringContaining('최대 200개') })
		]);
	});
});
