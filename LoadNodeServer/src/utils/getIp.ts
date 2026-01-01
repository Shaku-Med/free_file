export const VerifyIp = async (ip: string): Promise<boolean> => {
    try {
        if (ip === `unknown`) return false;
        const regex = /^(\d{1,3}\.){3}\d{1,3}$/;

        if (!regex.test(ip) && process.env['NODE_ENV'] === 'production') {
            return false;
        }

        return true;
    } catch {
        return false;
    }
};

export async function getClientIP(req: any): Promise<string> {
    let headers: any = {};
    if (req.headers) {
        headers = req.headers;
    } else if (req.get && typeof req.get === 'function') {
        headers = {
            'x-real-ip': req.get('x-real-ip'),
            'cf-connecting-ip': req.get('cf-connecting-ip'),
            'x-client-ip': req.get('x-client-ip'),
            'x-forwarded-for': req.get('x-forwarded-for'),
        };
    }
    
    const ip = (
        headers['x-real-ip'] ||
        headers['cf-connecting-ip'] ||
        headers['x-client-ip'] ||
        headers['fastly-client-ip'] ||
        headers['true-client-ip'] ||
        (headers['x-forwarded-for']?.split(',')[0]?.trim()) ||
        headers['x-forwarded'] ||
        headers['x-cluster-client-ip'] ||
        headers['forwarded-for'] ||
        headers['forwarded'] ||
        headers['via'] ||
        headers['DO-Connecting-IP'] ||
        headers['oxygen-buyer-ip'] ||
        headers['HTTP-X-Forwarded-For'] ||
        headers['Fly-Client-IP'] ||
        'unknown'
    );

    return process.env['NODE_ENV'] === 'production' ? (await VerifyIp(ip) ? ip : 'unknown') : '::1';
}
