import type { User } from '@supabase/supabase-js';

// These inputs must come from getUser / getClaims, never client-submitted metadata.
export function isGoogleSession(user: Pick<User, 'id' | 'identities' | 'is_anonymous'> | null, claims: unknown) {
  if (!user || user.is_anonymous || !user.identities?.some(identity => identity.provider === 'google')) return false;
  const jwt = claims as { sub?: unknown; amr?: unknown } | null;
  if (jwt?.sub !== user.id || !Array.isArray(jwt.amr)) return false;
  const methods = jwt.amr.filter(item => item && typeof item.method === 'string' && typeof item.timestamp === 'number'
    && !['token_refresh', 'totp', 'email_change'].includes(item.method));
  const latest = Math.max(...methods.map(item => item.timestamp));
  return methods.some(item => item.method === 'oauth' && item.timestamp === latest)
    && !methods.some(item => item.method !== 'oauth' && item.timestamp === latest);
}
