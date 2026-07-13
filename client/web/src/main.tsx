import { AuthProvider, AuthCallback } from '@aprovan/ui/auth';
import { Loader2 } from 'lucide-react';
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import AuthGate from './components/AuthGate';
import { authClient } from './lib/auth';
import './index.css';

const isCallback = window.location.pathname.endsWith('/auth/callback');

function Root() {
  if (isCallback) {
    return (
      <AuthCallback
        fallbackPath="/chat/"
        loading={
          <div className="flex min-h-screen items-center justify-center">
            <Loader2 className="size-6 animate-spin text-muted-foreground" />
          </div>
        }
        renderError={(message) => (
          <div className="flex min-h-screen items-center justify-center p-4 text-sm text-destructive">
            Sign-in failed: {message}
          </div>
        )}
      />
    );
  }
  return (
    <AuthGate>
      <App />
    </AuthGate>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AuthProvider client={authClient}>
      <Root />
    </AuthProvider>
  </React.StrictMode>,
);
