import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from '@/components/ui/sonner';
import '@/i18n';
import '@/index.css';
import App from './App';
import ErrorBoundary from '@/components/ErrorBoundary';
import { initNativePlatform } from '@/lib/native';

initNativePlatform();


const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30000, retry: 1 } },
});

const rootEl = document.getElementById('root')!;
const reactRoot = createRoot(rootEl, {
  onUncaughtError(error: unknown, errorInfo: { componentStack?: string }) {
    console.error('[React Uncaught Error]', error, errorInfo);
  },
  onCaughtError(error: unknown, errorInfo: { componentStack?: string; errorBoundary?: unknown }) {
    console.error('[React Caught Error]', error, errorInfo);
  },
  onRecoverableError(error: unknown, errorInfo: { componentStack?: string }) {
    console.error('[React Recoverable Error]', error, errorInfo);
  },
} as any);

reactRoot.render(
  <ErrorBoundary name="root">
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Toaster />
        <App />
      </BrowserRouter>
    </QueryClientProvider>
  </ErrorBoundary>
);
