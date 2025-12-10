/**
 * Logger Service - Centralized logging with configurable log levels
 */

import * as vscode from 'vscode';

export enum LogLevel {
    Error = 0,
    Warn = 1,
    Info = 2,
    Debug = 3,
}

const LOG_LEVEL_NAMES: Record<LogLevel, string> = {
    [LogLevel.Error]: 'ERROR',
    [LogLevel.Warn]: 'WARN',
    [LogLevel.Info]: 'INFO',
    [LogLevel.Debug]: 'DEBUG',
};

/**
 * Centralized logger for the extension
 */
export class Logger {
    private static instance: Logger;
    private outputChannel: vscode.OutputChannel;
    private currentLogLevel: LogLevel;
    private configListener: vscode.Disposable | undefined;

    private constructor() {
        this.outputChannel = vscode.window.createOutputChannel('Semantic Search');
        this.currentLogLevel = this.getConfiguredLogLevel();
        this.setupConfigListener();
    }

    /**
     * Get the singleton logger instance
     */
    public static getInstance(): Logger {
        if (!Logger.instance) {
            Logger.instance = new Logger();
        }
        return Logger.instance;
    }

    /**
     * Setup configuration listener for dynamic log level changes
     */
    private setupConfigListener(): void {
        this.configListener = vscode.workspace.onDidChangeConfiguration((e) => {
            if (e.affectsConfiguration('semanticSearch.logging.level')) {
                this.currentLogLevel = this.getConfiguredLogLevel();
                this.debug('Logger', 'Log level changed to: ' + LOG_LEVEL_NAMES[this.currentLogLevel]);
            }
        });
    }

    /**
     * Get configured log level from settings
     */
    private getConfiguredLogLevel(): LogLevel {
        const config = vscode.workspace.getConfiguration('semanticSearch.logging');
        const levelString = config.get<string>('level', 'warn');

        switch (levelString.toLowerCase()) {
            case 'error':
                return LogLevel.Error;
            case 'warn':
                return LogLevel.Warn;
            case 'info':
                return LogLevel.Info;
            case 'debug':
                return LogLevel.Debug;
            default:
                return LogLevel.Warn;
        }
    }

    /**
     * Check if a log level should be logged
     */
    private shouldLog(level: LogLevel): boolean {
        return level <= this.currentLogLevel;
    }

    /**
     * Format log message with timestamp and context
     */
    private formatMessage(level: LogLevel, component: string, message: string, data?: unknown): string {
        const timestamp = new Date().toISOString();
        const levelName = LOG_LEVEL_NAMES[level];
        let formattedMessage = `[${timestamp}] [${levelName}] [${component}] ${message}`;

        if (data !== undefined) {
            // Sanitize data to avoid logging sensitive information
            const sanitized = this.sanitizeData(data);
            formattedMessage += '\n' + JSON.stringify(sanitized, null, 2);
        }

        return formattedMessage;
    }

    /**
     * Sanitize data to remove potential sensitive information
     */
    private sanitizeData(data: unknown): unknown {
        if (typeof data === 'string') {
            // Check for potential API keys or tokens
            if (data.length > 20 && /^[a-zA-Z0-9_-]+$/.test(data)) {
                return '[REDACTED]';
            }
            return data;
        }

        if (Array.isArray(data)) {
            return data.map((item) => this.sanitizeData(item));
        }

        if (data && typeof data === 'object') {
            const sanitized: Record<string, unknown> = {};
            for (const [key, value] of Object.entries(data)) {
                // Redact fields that might contain sensitive data
                const lowerKey = key.toLowerCase();
                if (lowerKey.includes('key') || lowerKey.includes('token') || lowerKey.includes('password') || lowerKey.includes('secret')) {
                    sanitized[key] = '[REDACTED]';
                } else {
                    sanitized[key] = this.sanitizeData(value);
                }
            }
            return sanitized;
        }

        return data;
    }

    /**
     * Log a message at the specified level
     */
    private log(level: LogLevel, component: string, message: string, data?: unknown): void {
        if (!this.shouldLog(level)) {
            return;
        }

        const formattedMessage = this.formatMessage(level, component, message, data);
        this.outputChannel.appendLine(formattedMessage);
    }

    /**
     * Log an error message
     */
    public error(component: string, message: string, error?: unknown): void {
        const errorData = error instanceof Error ? {
            message: error.message,
            stack: error.stack,
            name: error.name,
        } : error;

        this.log(LogLevel.Error, component, message, errorData);
    }

    /**
     * Log a warning message
     */
    public warn(component: string, message: string, data?: unknown): void {
        this.log(LogLevel.Warn, component, message, data);
    }

    /**
     * Log an info message
     */
    public info(component: string, message: string, data?: unknown): void {
        this.log(LogLevel.Info, component, message, data);
    }

    /**
     * Log a debug message
     */
    public debug(component: string, message: string, data?: unknown): void {
        this.log(LogLevel.Debug, component, message, data);
    }

    /**
     * Show the output channel
     */
    public show(): void {
        this.outputChannel.show();
    }

    /**
     * Dispose of the logger
     */
    public dispose(): void {
        this.configListener?.dispose();
        this.outputChannel.dispose();
    }
}

/**
 * Get the singleton logger instance
 */
export function getLogger(): Logger {
    return Logger.getInstance();
}
