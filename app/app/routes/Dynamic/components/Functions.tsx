import { getCookie } from "~/lib/Security/Token";
import SetToken from "~/lib/Security/unsharedkeyEncryption/Combined/Verification/SetToken";
import { VerifyToken } from "~/lib/Security/unsharedkeyEncryption/Combined/Verification/VerifyToken";
export const MakeVideoToken = async (file: string, id: string, headers: Headers) => {
    try {
        let cookie = getCookie('validator', headers)
        if(cookie) {
          let vdalidateCookie = await VerifyVideoToken(cookie, headers)
          if(vdalidateCookie?.id === id) return null
        }

        if(!file && file.startsWith('image/') || !id) return null
        let keys = ['video_token']
        let token = await SetToken(headers, {
            expiresIn: '30d',
            algorithm: 'HS512'
        }, keys, {
            file: file,
            id: id
        })
        if(!token) return null
        return token.data
    }
    catch (error) {
        console.error('Error in MakeVideoToken:', error)
        return null
    }
}

export const VerifyVideoToken = async (token: string, headers: Headers) => {
    try {
        let keys = ['video_token']
        let verified = await VerifyToken({
            token: token,
            addedKeyNames: keys || []
        }, headers)
        if(!verified) return null
        return verified
    }
    catch (error) {
        console.error('Error in VerifyVideoToken:', error)
        return null
    }
}