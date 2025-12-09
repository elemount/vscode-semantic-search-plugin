import * as assert from 'assert';
import * as vscode from 'vscode';

suite('Extension Test Suite', () => {
	vscode.window.showInformationMessage('Start all tests.');

	test('Extension should be present', () => {
		assert.ok(vscode.extensions.getExtension('undefined_publisher.semantic-search'));
	});

	test('Commands should be registered', async () => {
		const commands = await vscode.commands.getCommands(true);
		
		assert.ok(commands.includes('semantic-search.buildIndex'));
		assert.ok(commands.includes('semantic-search.search'));
		assert.ok(commands.includes('semantic-search.deleteIndex'));
	});

	test('Sample test', () => {
		assert.strictEqual(-1, [1, 2, 3].indexOf(5));
		assert.strictEqual(-1, [1, 2, 3].indexOf(0));
	});
});
