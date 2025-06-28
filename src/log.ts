import pino from 'pino';

// Global debug flag - set by CLI, used by other modules
export let debugEnabled = false;

// Logger instance
export const logger = pino({
  level: 'info',
  transport: debugEnabled ? {
    target: 'pino-pretty',
    options: {
      colorize: false,
      translateTime: 'SYS:standard',
      ignore: 'pid,hostname'
    }
  } : undefined
});

export function setDebugEnabled(enabled: boolean) {
  debugEnabled = enabled;
  logger.level = enabled ? 'debug' : 'info';
}

function logWithLevel(level: string, message: string, data?: Record<string, unknown>) {
  const logData: Record<string, unknown> = {
    ...(data && { ...data })
  };
  
  if (debugEnabled) {
    // In debug mode, all logs go to stderr as NDJSON
    switch (level) {
      case 'debug':
        logger.debug(logData, message);
        break;
      case 'info':
        logger.info(logData, message);
        break;
      case 'error':
        logger.error(logData, message);
        break;
      default:
        logger.info(logData, message);
    }
  } else if (level === 'error') {
    // Non-debug mode: only errors to stderr
    logger.error(logData, message);
  } else if (level === 'info' && !debugEnabled) {
    // Non-debug mode: info messages as human readable to stdout
    console.log(message);
  }
}

export function debug(message: string, data?: Record<string, unknown>) {
  if (debugEnabled) {
    const logData: Record<string, unknown> = {
      ...(data && { ...data })
    };
    logger.debug(logData, message);
  }
}

export function info(message: string, data?: Record<string, unknown>) {
  logWithLevel('info', message, data);
}

export function error(message: string, data?: Record<string, unknown>) {
  logWithLevel('error', message, data);
}
