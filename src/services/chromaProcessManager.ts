/**
 * ChromaDB Process Manager
 * Manages the lifecycle of a bundled Chroma server executable
 */

import * as vscode from 'vscode';
import { ChildProcess, spawn } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import * as net from 'net';

export interface ChromaServerConfig {
    port: number;
    host: string;
    persistPath: string;
    logLevel: 'debug' | 'info' | 'warning' | 'error';
    startupTimeout: number;
}

export type ChromaServerStatus = 'stopped' | 'starting' | 'running' | 'error';

export class ChromaProcessManager {
    private process: ChildProcess | null = null;
    private port: number = 0;
    private status: ChromaServerStatus = 'stopped';
    private healthCheckInterval: NodeJS.Timeout | null = null;
    private restartAttempts: number = 0;
    private readonly maxRestartAttempts: number = 3;
    private readonly defaultPort = 8765;
    private outputChannel: vscode.OutputChannel;
    private statusEmitter: vscode.EventEmitter<ChromaServerStatus>;

    public readonly onStatusChange: vscode.Event<ChromaServerStatus>;

    constructor(private context: vscode.ExtensionContext) {
        this.outputChannel = vscode.window.createOutputChannel('Chroma Server');
        this.statusEmitter = new vscode.EventEmitter<ChromaServerStatus>();
        this.onStatusChange = this.statusEmitter.event;
    }

    /**
     * Get current server status
     */
    getStatus(): ChromaServerStatus {
        return this.status;
    }

    /**
     * Update and emit status
     */
    private updateStatus(status: ChromaServerStatus): void {
        this.status = status;
        this.statusEmitter.fire(status);
    }

    /**
     * Start the Chroma server process
     */
    async start(): Promise<void> {
        if (this.status === 'running') {
            this.log('Server is already running');
            return;
        }

        this.updateStatus('starting');
        this.log('Starting Chroma server...');

        try {
            // Get configuration
            const config = this.getConfig();

            // Find available port
            this.port = config.port > 0 ? config.port : await this.findAvailablePort();
            this.log(`Using port: ${this.port}`);

            // Get executable path for current platform
            const execPath = this.getChromaExecutablePath();
            
            // Check if executable exists
            if (!fs.existsSync(execPath)) {
                throw new Error(`Chroma executable not found at: ${execPath}. Please ensure the extension is properly installed.`);
            }

            // Ensure persist directory exists
            const persistPath = path.join(
                this.context.globalStorageUri.fsPath,
                'chroma'
            );
            if (!fs.existsSync(persistPath)) {
                fs.mkdirSync(persistPath, { recursive: true });
            }
            this.log(`Persist path: ${persistPath}`);

            // Set executable permissions on Unix systems
            if (process.platform !== 'win32') {
                try {
                    fs.chmodSync(execPath, 0o755);
                } catch (err) {
                    this.log(`Warning: Could not set executable permissions: ${err}`);
                }
            }

            // Spawn Chroma server
            this.process = spawn(execPath, [
                'run',
                '--host', '127.0.0.1',
                '--port', this.port.toString(),
                '--path', persistPath,
                '--log-config', config.logLevel,
            ], {
                cwd: path.dirname(execPath),
                stdio: ['ignore', 'pipe', 'pipe'],
            });

            // Handle stdout
            this.process.stdout?.on('data', (data) => {
                this.log(`[stdout] ${data.toString().trim()}`);
            });

            // Handle stderr
            this.process.stderr?.on('data', (data) => {
                this.log(`[stderr] ${data.toString().trim()}`);
            });

            // Handle process exit
            this.process.on('exit', (code, signal) => {
                this.log(`Server exited with code ${code}, signal ${signal}`);
                this.process = null;
                
                if (this.status === 'running') {
                    // Unexpected exit, try to restart
                    this.updateStatus('error');
                    this.handleCrash();
                } else {
                    this.updateStatus('stopped');
                }
            });

            // Handle process error
            this.process.on('error', (err) => {
                this.log(`Server error: ${err.message}`);
                this.updateStatus('error');
            });

            // Wait for server to be ready
            await this.waitForReady(config.startupTimeout);
            
            this.updateStatus('running');
            this.restartAttempts = 0;
            this.log('Chroma server started successfully');

            // Start health check interval
            this.startHealthCheck();
        } catch (error) {
            this.updateStatus('error');
            const message = error instanceof Error ? error.message : String(error);
            this.log(`Failed to start server: ${message}`);
            throw error;
        }
    }

    /**
     * Stop the Chroma server gracefully
     */
    async stop(): Promise<void> {
        this.log('Stopping Chroma server...');
        
        // Stop health check
        this.stopHealthCheck();

        if (!this.process) {
            this.updateStatus('stopped');
            return;
        }

        const proc = this.process;
        return new Promise((resolve) => {
            const timeout = setTimeout(() => {
                // Force kill if graceful shutdown fails
                if (this.process) {
                    this.log('Force killing server...');
                    this.process.kill('SIGKILL');
                }
                this.updateStatus('stopped');
                resolve();
            }, 5000);

            proc.once('exit', () => {
                clearTimeout(timeout);
                this.process = null;
                this.updateStatus('stopped');
                this.log('Server stopped');
                resolve();
            });

            // Send graceful shutdown signal
            proc.kill('SIGTERM');
        });
    }

    /**
     * Get the server URL for client connection
     */
    getServerUrl(): string {
        return `http://127.0.0.1:${this.port}`;
    }

    /**
     * Get the server port
     */
    getPort(): number {
        return this.port;
    }

    /**
     * Check if server is healthy and responsive
     */
    async healthCheck(): Promise<boolean> {
        if (!this.process || this.status !== 'running') {
            return false;
        }

        try {
            const response = await fetch(`${this.getServerUrl()}/api/v1/heartbeat`, {
                method: 'GET',
                signal: AbortSignal.timeout(5000),
            });
            return response.ok;
        } catch {
            return false;
        }
    }

    /**
     * Wait for the server to be ready
     */
    private async waitForReady(timeout: number): Promise<void> {
        const startTime = Date.now();
        const checkInterval = 500;

        while (Date.now() - startTime < timeout) {
            try {
                const response = await fetch(`http://127.0.0.1:${this.port}/api/v1/heartbeat`, {
                    method: 'GET',
                    signal: AbortSignal.timeout(2000),
                });
                if (response.ok) {
                    return;
                }
            } catch {
                // Server not ready yet
            }
            await this.sleep(checkInterval);
        }

        throw new Error(`Server did not start within ${timeout}ms timeout`);
    }

    /**
     * Find an available port for the server
     */
    private async findAvailablePort(): Promise<number> {
        // Try default port first
        if (await this.isPortAvailable(this.defaultPort)) {
            return this.defaultPort;
        }

        // Find a random available port
        return this.getRandomAvailablePort();
    }

    /**
     * Check if a port is available
     */
    private isPortAvailable(port: number): Promise<boolean> {
        return new Promise((resolve) => {
            const server = net.createServer();
            server.listen(port, '127.0.0.1');
            server.on('listening', () => {
                server.close();
                resolve(true);
            });
            server.on('error', () => {
                resolve(false);
            });
        });
    }

    /**
     * Get a random available port
     */
    private getRandomAvailablePort(): Promise<number> {
        return new Promise((resolve, reject) => {
            const server = net.createServer();
            server.listen(0, '127.0.0.1');
            server.on('listening', () => {
                const address = server.address();
                if (address && typeof address === 'object') {
                    const port = address.port;
                    server.close(() => resolve(port));
                } else {
                    server.close(() => reject(new Error('Could not get port')));
                }
            });
            server.on('error', reject);
        });
    }

    /**
     * Get the path to the Chroma executable for current platform
     */
    private getChromaExecutablePath(): string {
        const platform = process.platform;
        const arch = process.arch;
        const ext = platform === 'win32' ? '.exe' : '';

        let platformDir: string;
        if (platform === 'win32') {
            platformDir = 'win32-x64';
        } else if (platform === 'darwin') {
            platformDir = arch === 'arm64' ? 'darwin-arm64' : 'darwin-x64';
        } else {
            platformDir = 'linux-x64';
        }

        return path.join(
            this.context.extensionPath,
            'bin',
            platformDir,
            `chroma${ext}`
        );
    }

    /**
     * Get configuration from VS Code settings
     */
    private getConfig(): ChromaServerConfig {
        const config = vscode.workspace.getConfiguration('semanticSearch.chroma');
        return {
            port: config.get<number>('port', 0),
            host: '127.0.0.1',
            persistPath: path.join(this.context.globalStorageUri.fsPath, 'chroma'),
            logLevel: config.get<'debug' | 'info' | 'warning' | 'error'>('logLevel', 'warning'),
            startupTimeout: config.get<number>('startupTimeout', 30000),
        };
    }

    /**
     * Start periodic health check
     */
    private startHealthCheck(): void {
        this.stopHealthCheck();
        this.healthCheckInterval = setInterval(async () => {
            const healthy = await this.healthCheck();
            if (!healthy && this.status === 'running') {
                this.log('Health check failed');
                this.updateStatus('error');
                this.handleCrash();
            }
        }, 30000); // Check every 30 seconds
    }

    /**
     * Stop periodic health check
     */
    private stopHealthCheck(): void {
        if (this.healthCheckInterval) {
            clearInterval(this.healthCheckInterval);
            this.healthCheckInterval = null;
        }
    }

    /**
     * Handle server crash with auto-restart
     */
    private async handleCrash(): Promise<void> {
        if (this.restartAttempts >= this.maxRestartAttempts) {
            this.log(`Max restart attempts (${this.maxRestartAttempts}) reached`);
            vscode.window.showErrorMessage(
                'Chroma server crashed and could not be restarted. Please restart VS Code or check the output logs.',
                'Show Logs'
            ).then((action) => {
                if (action === 'Show Logs') {
                    this.outputChannel.show();
                }
            });
            return;
        }

        this.restartAttempts++;
        const delay = Math.pow(2, this.restartAttempts) * 1000; // Exponential backoff
        this.log(`Attempting restart ${this.restartAttempts}/${this.maxRestartAttempts} in ${delay}ms...`);

        await this.sleep(delay);

        try {
            await this.start();
            vscode.window.showInformationMessage('Chroma server restarted successfully');
        } catch (error) {
            this.log(`Restart attempt ${this.restartAttempts} failed: ${error}`);
        }
    }

    /**
     * Log message to output channel
     */
    private log(message: string): void {
        const timestamp = new Date().toISOString();
        this.outputChannel.appendLine(`[${timestamp}] ${message}`);
        console.log(`[ChromaProcessManager] ${message}`);
    }

    /**
     * Sleep helper
     */
    private sleep(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * Dispose resources
     */
    dispose(): void {
        this.stopHealthCheck();
        this.statusEmitter.dispose();
        this.outputChannel.dispose();
    }
}
