export const VerifyIp = async (ip: string) => {
    try {
        if(ip === `unknown`) return false;
        let regex = /^(\d{1,3}\.){3}\d{1,3}$/; // 192.168.1.1

        if(!regex.test(ip) && process.env['NODE_ENV'] === 'production'){
            return false;
        }

        // let response = await fetch(`https://ipinfo.io/${ip}/json`);
        // let data = await response.json();
        // console.log("data", data)
        // if(data.ip === ip){
        //     return true;
        // }
        // return false;
        return true;
    }
    catch {
        return false;
    }
}

export async function getClientIP(headers: Headers) {
    let ips =  (
      headers.get('x-real-ip') ||
      headers.get('cf-connecting-ip') ||
      headers.get('x-client-ip') ||
      headers.get('fastly-client-ip') ||
      headers.get('true-client-ip') ||
      headers.get('x-forwarded-for')?.split(',')[0].trim() ||
      headers.get('x-forwarded') ||
      headers.get('x-cluster-client-ip') ||
      headers.get('forwarded-for') ||
      headers.get('forwarded') ||
      headers.get('via') ||
      headers.get(`DO-Connecting-IP`) ||
      headers.get(`oxygen-buyer-ip`) ||
      headers.get(`HTTP-X-Forwarded-For`) ||
      headers.get(`Fly-Client-IP`) ||
      'unknown'
    );

    return process.env['NODE_ENV'] === 'production' ? await VerifyIp(ips) : `::1`;
}

export function getHeaders(header: Headers){
    return {
        get: (name: string) => {
            return new Headers(header).get(name)
        },
        forEach: (callback: (value: string, key: string) => void) => {
            header.forEach((value, key) => {
                callback(value, key)
            })
        },
    }
}