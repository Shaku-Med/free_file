import { EnvValidator } from "../EnvValidator";

export const SetTokenKeys = [
    {
        name: `default_key`,
        keys: [EnvValidator(`DEFAULT_KEY`)],
        expiresIn: '5s',
        algorithm: 'HS512'
    }
]

export const GetTokenKeys = (name: string) => {
    let keys = SetTokenKeys.find(token => token.name === name)?.keys
    if(!keys) return null
    let notNullKeys = keys.filter(key => key !== null)
    if(notNullKeys.length === 0) return null
    return notNullKeys
}

export const getCookie = (name: string, headers: Headers) => {
    try {
        let cookie = headers.get('Cookie')
        if(!cookie) return null
        let cookies = cookie.split(';')
        let token = cookies.find(cookie => cookie.trim().startsWith(`${name}=`))
        if(!token) return null
        return token.split('=')[1]
    }
    catch {
        return null
    }
}