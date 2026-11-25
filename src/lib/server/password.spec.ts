import { describe, expect, it } from 'vitest';
import { parsePasswordChange } from './password';

describe('parsePasswordChange', () => {
	const valid = {
		currentAuthKey: 'b2xkIGF1dGgga2V5IG9mIDMyIGJ5dGVzIGxvbmcuLi4=',
		newAuthKey: 'bmV3IGF1dGgga2V5IG9mIDMyIGJ5dGVzIGxvbmcuLi4=',
		privateKey: 'ZW5jcnlwdGVkIHByaXZhdGUga2V5',
		salt: 'c2FsdHNhbHRzYWx0c2FsdA==',
		nonce: 'bm9uY2Vub25jZW5v',
		kdfIterations: 600_000
	};

	it('accepts a complete change', () => {
		expect(parsePasswordChange(valid)).toEqual(valid);
	});

	it('leaves out anything else that was sent', () => {
		expect(parsePasswordChange({ ...valid, publicKey: 'abc', username: 'other' })).toEqual(valid);
	});

	it('requires both auth keys', () => {
		expect(parsePasswordChange({ ...valid, currentAuthKey: '' })).toHaveProperty('problem');
		expect(parsePasswordChange({ ...valid, newAuthKey: undefined })).toHaveProperty('problem');
		expect(parsePasswordChange({ ...valid, newAuthKey: 'x'.repeat(129) })).toHaveProperty(
			'problem'
		);
	});

	it('requires the key fields as base64', () => {
		expect(parsePasswordChange({ ...valid, privateKey: '' })).toHaveProperty('problem');
		expect(parsePasswordChange({ ...valid, salt: 'not base64!' })).toHaveProperty('problem');
		expect(parsePasswordChange({ ...valid, nonce: 42 })).toHaveProperty('problem');
		expect(parsePasswordChange({ ...valid, privateKey: 'A'.repeat(1025) })).toHaveProperty(
			'problem'
		);
	});

	it('refuses weak or absurd key derivation settings', () => {
		expect(parsePasswordChange({ ...valid, kdfIterations: 1000 })).toHaveProperty('problem');
		expect(parsePasswordChange({ ...valid, kdfIterations: 600_000.5 })).toHaveProperty('problem');
		expect(parsePasswordChange({ ...valid, kdfIterations: 1e9 })).toHaveProperty('problem');
		expect(parsePasswordChange({ ...valid, kdfIterations: '600000' })).toHaveProperty('problem');
	});

	it('refuses anything that isn’t an object', () => {
		expect(parsePasswordChange(null)).toHaveProperty('problem');
		expect(parsePasswordChange('change')).toHaveProperty('problem');
	});
});
