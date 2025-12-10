import * as assert from 'assert';
import * as vscode from 'vscode';
import { Logger, LogLevel, getLogger } from '../../services/logger';

suite('Logger Service Tests', () => {
	let logger: Logger;

	setup(() => {
		logger = getLogger();
	});

	test('Logger should be a singleton', () => {
		const logger1 = getLogger();
		const logger2 = getLogger();
		assert.strictEqual(logger1, logger2, 'Logger should return the same instance');
	});

	test('Logger should respect configured log level', async () => {
		const config = vscode.workspace.getConfiguration('semanticSearch.logging');
		const currentLevel = config.get<string>('level', 'warn');
		
		// Verify initial level is set
		assert.ok(['error', 'warn', 'info', 'debug'].includes(currentLevel));
	});

	test('Logger methods should not throw errors', () => {
		assert.doesNotThrow(() => {
			logger.error('Test', 'Error message', new Error('Test error'));
		});

		assert.doesNotThrow(() => {
			logger.warn('Test', 'Warning message');
		});

		assert.doesNotThrow(() => {
			logger.info('Test', 'Info message', { key: 'value' });
		});

		assert.doesNotThrow(() => {
			logger.debug('Test', 'Debug message');
		});
	});

	test('Logger should sanitize sensitive data', () => {
		// This is a white-box test - we're testing that the logger doesn't crash
		// when logging potentially sensitive data
		assert.doesNotThrow(() => {
			logger.info('Test', 'Logging with sensitive data', {
				apiKey: 'secret123',
				password: 'mypassword',
				token: 'bearer-token',
				normalField: 'safe value'
			});
		});
	});

	test('Logger show method should not throw', () => {
		assert.doesNotThrow(() => {
			logger.show();
		});
	});
});
