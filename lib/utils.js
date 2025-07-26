const { v4: uuidv4 } = require('uuid');

class Utils {
  static generateId() {
    return uuidv4();
  }

  static sanitizeInput(input) {
    if (typeof input !== 'string') return input;
    
    return input
      .trim()
      .replace(/[\x00-\x1F\x7F]/g, '') // Remove control characters
      .substring(0, 10000); // Limit length
  }

  static validateEmail(email) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  }

  static extractTextFromMessage(msg) {
    // Handle different message types
    if (msg.text) {
      return msg.text;
    } else if (msg.caption) {
      return msg.caption;
    } else if (msg.voice) {
      return '[Voice message]';
    } else if (msg.document) {
      return msg.document.file_name || '[Document]';
    } else if (msg.photo) {
      return msg.caption || '[Photo]';
    }
    
    return '[Unknown message type]';
  }

  static determineMessageType(msg) {
    if (msg.voice) return 'voice';
    if (msg.document) return 'document';
    if (msg.photo) return 'photo';
    if (msg.text) return 'text';
    return 'unknown';
  }

  static formatFileSize(bytes) {
    if (bytes === 0) return '0 Bytes';
    
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  static isValidUrl(string) {
    try {
      new URL(string);
      return true;
    } catch (_) {
      return false;
    }
  }

  static extractUrls(text) {
    const urlRegex = /(https?:\/\/[^\s]+)/g;
    return text.match(urlRegex) || [];
  }

  static sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  static retryWithBackoff(fn, maxRetries = 3, baseDelay = 1000) {
    return new Promise((resolve, reject) => {
      let retries = 0;
      
      const attempt = async () => {
        try {
          const result = await fn();
          resolve(result);
        } catch (error) {
          retries++;
          
          if (retries >= maxRetries) {
            reject(error);
            return;
          }
          
          const delay = baseDelay * Math.pow(2, retries - 1);
          console.log(`Retry ${retries}/${maxRetries} after ${delay}ms delay`);
          
          setTimeout(attempt, delay);
        }
      };
      
      attempt();
    });
  }

  static truncateWithEllipsis(text, maxLength) {
    if (!text || text.length <= maxLength) return text;
    return text.substring(0, maxLength - 3) + '...';
  }

  static removeSpecialChars(text) {
    return text.replace(/[^\w\s-_.]/g, '');
  }

  static capitalizeFirst(text) {
    if (!text) return text;
    return text.charAt(0).toUpperCase() + text.slice(1);
  }

  static generateSlug(text) {
    return text
      .toLowerCase()
      .replace(/[^\w\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .trim('-');
  }

  static parseCallbackData(callbackData) {
    const parts = callbackData.split('_');
    return {
      action: parts[0],
      ideaId: parts.slice(1).join('_'),
    };
  }

  static createCallbackData(action, ideaId) {
    return `${action}_${ideaId}`;
  }

  static validateFileType(filename, allowedTypes) {
    const extension = filename.split('.').pop().toLowerCase();
    return allowedTypes.includes(extension);
  }

  static getFileExtension(filename) {
    return filename.split('.').pop().toLowerCase();
  }

  static formatTimestamp(timestamp) {
    return new Date(timestamp).toLocaleString('en-US', {
      timeZone: 'UTC',
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  static logWithTimestamp(message, level = 'info') {
    const timestamp = new Date().toISOString();
    const logMessage = `[${timestamp}] ${level.toUpperCase()}: ${message}`;
    
    if (level === 'error') {
      console.error(logMessage);
    } else if (level === 'warn') {
      console.warn(logMessage);
    } else {
      console.log(logMessage);
    }
  }

  static redactSensitiveData(data) {
    const sensitiveKeys = ['api_key', 'token', 'password', 'secret'];
    const redacted = { ...data };
    
    for (const key in redacted) {
      if (sensitiveKeys.some(sensitive => key.toLowerCase().includes(sensitive))) {
        redacted[key] = '***REDACTED***';
      }
    }
    
    return redacted;
  }

  static validateEnvironmentVariables() {
    const required = [
      'TELEGRAM_BOT_TOKEN',
      'OPENAI_API_KEY',
      'NOTION_API_KEY',
      'NOTION_DATABASE_ID',
    ];

    const missing = required.filter(key => !process.env[key]);
    
    if (missing.length > 0) {
      throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
    }

    return true;
  }

  static createSuccessResponse(data) {
    return {
      success: true,
      data,
      timestamp: new Date().toISOString(),
    };
  }

  static createErrorResponse(error, code = 500) {
    return {
      success: false,
      error: {
        message: error.message || 'Unknown error',
        code,
      },
      timestamp: new Date().toISOString(),
    };
  }

  static isValidTelegramUpdate(update) {
    return update && (update.message || update.callback_query);
  }

  static extractMessageFromUpdate(update) {
    return update.message || update.callback_query?.message;
  }

  static getCallbackQuery(update) {
    return update.callback_query;
  }
}

module.exports = Utils; 