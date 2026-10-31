import { describe, expect, it } from 'vitest';
import { checkSignUp, resolveRegistrationMode } from './registration';

describe('resolveRegistrationMode', () => {
	it('is invite only by default', () => {
		expect(resolveRegistrationMode(undefined, 'secret')).toBe('invite');
		expect(resolveRegistrationMode('nonsense', 'secret')).toBe('invite');
	});

	it('is closed when invite only without an invite code', () => {
		expect(resolveRegistrationMode(undefined, undefined)).toBe('closed');
		expect(resolveRegistrationMode('invite', '')).toBe('closed');
	});

	it('can be opened or closed', () => {
		expect(resolveRegistrationMode(' Open ', undefined)).toBe('open');
		expect(resolveRegistrationMode('closed', 'secret')).toBe('closed');
	});
});

describe('checkSignUp', () => {
	it('lets anyone sign up when open', () => {
		expect(checkSignUp('open', undefined, null)).toBeNull();
	});

	it('requires the right invite code when invite only', () => {
		expect(checkSignUp('invite', 'secret', 'secret')).toBeNull();
		expect(checkSignUp('invite', 'secret', ' secret ')).toBeNull();
		expect(checkSignUp('invite', 'secret', 'Secret')?.code).toBe('INVALID_INVITE_CODE');
		expect(checkSignUp('invite', 'secret', '')?.code).toBe('INVALID_INVITE_CODE');
		expect(checkSignUp('invite', 'secret', null)?.code).toBe('INVALID_INVITE_CODE');
	});

	it('lets nobody sign up when closed, even with the invite code', () => {
		expect(checkSignUp('closed', 'secret', 'secret')?.code).toBe('REGISTRATION_CLOSED');
	});
});
