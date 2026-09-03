import * as XLSX from 'xlsx';
import { describe, expect, it } from 'vitest';
import { readAdditionalProductsFile } from './additional-products-file';

describe('readAdditionalProductsFile', () => {
	it('XLSX 첫 번째 시트를 CSV 파서가 읽을 수 있는 텍스트로 변환한다', async () => {
		const workbook = XLSX.utils.book_new();
		const sheet = XLSX.utils.aoa_to_sheet([
			['기준상품번호', '추가구성상품번호1'],
			['P0000DGB', 2182]
		]);
		XLSX.utils.book_append_sheet(workbook, sheet, '추가구성상품');
		const bytes = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
		const file = new File([bytes], 'additional-products.xlsx', {
			type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
		});

		await expect(readAdditionalProductsFile(file)).resolves.toContain('P0000DGB,2182');
	});

	it('CSV 파일은 원문 텍스트를 유지한다', async () => {
		const file = new File(
			['기준상품번호,추가구성상품번호1\n2175,2176'],
			'additional-products.csv',
			{
				type: 'text/csv'
			}
		);

		await expect(readAdditionalProductsFile(file)).resolves.toBe(
			'기준상품번호,추가구성상품번호1\n2175,2176'
		);
	});
});
