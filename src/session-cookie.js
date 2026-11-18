/** 会话 Cookie 名（与 server.js 的 COOKIE 常量同值；auth-routes 自解析会话时复用，避免重复硬编码）。 */
export const SESSION_COOKIE_NAME = 'gp_session';

/** Build the shared session cookie for password, email, and first-run login. */
export function sessionCookie(req, value, maxAgeSec, name = 'gp_session') {
  const proto = String(req.headers['x-forwarded-proto'] ?? '').toLowerCase();
  const https = proto === 'https' || Boolean(req.socket?.encrypted);
  return `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSec}${https ? '; Secure' : ''}`;
}
