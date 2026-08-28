import { apiFetch } from './client';

export interface DecodedToken {
  userId: string;
  tenantId: string;
  isAdmin: boolean;
}

export function login(email: string, password: string): Promise<{ token: string }> {
  return apiFetch('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
}

export function decodeToken(token: string): DecodedToken | null {
  try {
    const payloadBase64 = token.split('.')[1];
    const payloadJson = atob(payloadBase64.replace(/-/g, '+').replace(/_/g, '/'));
    const payload = JSON.parse(payloadJson);
    return {
      userId: payload.sub,
      tenantId: payload.tenant_id,
      isAdmin: Boolean(payload.is_admin),
    };
  } catch {
    return null;
  }
}
