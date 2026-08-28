import { createContext, useContext, useState, ReactNode, useCallback } from 'react';
import { login as loginRequest, decodeToken, DecodedToken } from '../api/auth';
import { TOKEN_STORAGE_KEY } from '../api/client';

interface AuthContextValue {
  token: string | null;
  decoded: DecodedToken | null;
  isAuthenticated: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(() => localStorage.getItem(TOKEN_STORAGE_KEY));

  const login = useCallback(async (email: string, password: string) => {
    const result = await loginRequest(email, password);
    localStorage.setItem(TOKEN_STORAGE_KEY, result.token);
    setToken(result.token);
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem(TOKEN_STORAGE_KEY);
    setToken(null);
  }, []);

  const decoded = token ? decodeToken(token) : null;

  return (
    <AuthContext.Provider value={{ token, decoded, isAuthenticated: Boolean(token), login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
