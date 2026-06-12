/**
 * Delete "sudo mode": after the owner verifies a 6-digit email code we set a
 * signed HttpOnly SESSION cookie (dies with the browser) whose payload also
 * carries a hard 2h expiry  so users aren't re-asked for every delete, but
 * an open browser never stays elevated for more than 2 hours.
 *
 * The cookie only ever skips RE-VERIFICATION. Authorization (login +
 * ownership of the file being deleted) is re-checked on every delete call.
 */
import { EncryptCombine, DecryptCombine } from '~/lib/Security/unsharedkeyEncryption/Combined/Combined';
import { getAllKeys } from '~/lib/Security/unsharedkeyEncryption/Combined/Verification/TokenKeys';
import { getCookie } from '~/lib/Security/Token';

const SUDO_COOKIE = 'del_sudo';
const SUDO_TTL_SEC = 2 * 60 * 60;

export async function issueDeleteSudoToken(userId: string): Promise<string | null> {
  if (!userId) return null;
  const keys = await getAllKeys(['temp_token']);
  if (!keys) return null;
  return EncryptCombine({ userId, ctx: 'delete_sudo' }, keys, {
    expiresIn: SUDO_TTL_SEC,
    algorithm: 'HS512',
  });
}

/** Session cookie on purpose: no Max-Age, so it dies when the browser closes. */
export function appendDeleteSudoCookie(headers: Headers, token: string): void {
  const secure = process.env.NODE_ENV === 'production' ? 'Secure; ' : '';
  headers.append(
    'Set-Cookie',
    `${SUDO_COOKIE}=${token}; Path=/; HttpOnly; ${secure}SameSite=Strict`
  );
}

/** True only when the request carries a valid, unexpired sudo token for THIS user. */
export async function hasDeleteSudo(request: Request, userId: string): Promise<boolean> {
  try {
    if (!userId) return false;
    const token = getCookie(SUDO_COOKIE, request.headers);
    if (!token) return false;
    const keys = await getAllKeys(['temp_token']);
    if (!keys) return false;
    const decoded = await DecryptCombine(token, keys, { algorithm: 'HS512' });
    if (!decoded || typeof decoded !== 'object') return false;
    if (decoded.ctx !== 'delete_sudo') return false;
    return String(decoded.userId) === userId;
  } catch {
    return false;
  }
}
