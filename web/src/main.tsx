import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter } from 'react-router-dom';
import { Toaster } from 'sonner';
import App from './App';
import { AuthProvider } from './lib/auth-context';
import { registerServiceWorker } from './lib/push';
import { ProfileProvider } from './lib/profile';
import { ThemeProvider } from './lib/theme';
import './index.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 10_000, retry: 1, refetchOnWindowFocus: false },
  },
});

// After first install the page has no controller until the next load, which hid push errors behind a hang.
navigator.serviceWorker?.addEventListener('controllerchange', () => {
  if (!sessionStorage.getItem('sw-reloaded')) {
    sessionStorage.setItem('sw-reloaded', '1');
    location.reload();
  }
});
registerServiceWorker().catch(() => {});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <BrowserRouter>
          <ThemeProvider>
            <ProfileProvider>
              <App />
              <Toaster position="top-right" richColors closeButton />
            </ProfileProvider>
          </ThemeProvider>
        </BrowserRouter>
      </AuthProvider>
    </QueryClientProvider>
  </StrictMode>,
);
