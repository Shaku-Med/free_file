import { EncryptCombine } from '../Combined';
import { getClientIP } from './GetIp';
import { getExpirationDate } from './ExpirationTime';
import { EnvValidator } from './EnvValidator';
import { buildKeyNames, getAllKeys } from './TokenKeys';

const SetToken = async (headers: Headers, options?: { expiresIn?: string; algorithm?: string }, addKeyNames?: any[], addData?: object, setUA?: boolean) => {
  try {
        let h = headers as unknown as Headers
        let gip = await getClientIP(h)
        //
        if(!gip) return null;
        let o = {
            'sec-ch-ua-platform': h.get('sec-ch-ua-platform'),
            'user-agent': h.get('user-agent')?.split(/\s+/)?.join(''),
            'x-forwarded-for': gip
        }
        let obj: any = {
            ip: gip,
            ...o
        }
        // 
        if(addData){
            obj = {
                ...obj,
                ...addData
            }
        }
        // 

        const keyNames = buildKeyNames(['token1', 'token2', ...addKeyNames || []]);
        const encryptionKeys = await getAllKeys(keyNames);
        if(!encryptionKeys) return null;

        const expirationDate = getExpirationDate(options?.expiresIn)
        obj = {
            ...obj,
            expiresAt: expirationDate.toISOString()
        }

        let enc2 = await EncryptCombine(obj, encryptionKeys, options || {
            expiresIn: '6m',
            algorithm: 'HS512'
        })
        if(!enc2) return null;
        return {
            data: enc2,
            expiresAt: expirationDate.toISOString()
        }
  }
  catch (e) {
    console.error("Error Found in SetToken: ", e)
    return null
  }
}

export default SetToken