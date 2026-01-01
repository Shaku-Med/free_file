import express from 'express';
type Request = express.Request;

export const getCookie = (name: string, req: Request | any): string | null => {
    try {
        let cookie: string | undefined;
        if (req.headers && typeof req.headers.cookie === 'string') {
            cookie = req.headers.cookie;
        } else if (req.get && typeof req.get === 'function') {
            cookie = req.get('Cookie') || undefined;
        } else if (typeof req === 'object' && 'cookie' in req) {
            cookie = req.cookie;
        }
        
        if (!cookie) return null;
        const cookies = cookie.split(';');
        const token = cookies.find((c: string) => c.trim().startsWith(`${name}=`));
        if (!token) return null;
        return token.split('=')[1].trim();
    } catch {
        return null;
    }
};

export const sanitizeFilePath = (path: string | null | undefined): string | null => {
    if (!path || typeof path !== 'string') {
        return null;
    }

    let sanitized = path.replace(/\0/g, '');
    
    sanitized = sanitized.replace(/\.\./g, '');
    sanitized = sanitized.replace(/\/\.\./g, '');
    sanitized = sanitized.replace(/\.\.\//g, '');
    
    sanitized = sanitized.replace(/^\/+|\/+$/g, '');
    
    if (sanitized.length > 500) {
        return null;
    }

    const dangerousChars = /[\x00-\x1F\x7F<>'"`;\\|&$!*?{}]/;
    if (dangerousChars.test(sanitized)) {
        return null;
    }
    
    if (sanitized.length === 0) {
        return null;
    }

    return sanitized;
};
