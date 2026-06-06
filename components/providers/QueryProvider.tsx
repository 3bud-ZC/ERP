'use client';

import { ReactNode, useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

export function QueryProvider({ children }: { children: ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // Operational ERP pages need near real-time freshness.
            // Mutations invalidate affected keys explicitly as well.
            staleTime: 0,
            gcTime: 5 * 60_000,
            refetchOnWindowFocus: true,
            refetchOnReconnect: true,
            refetchOnMount: 'always',
            retry: (failureCount, error) => {
              const status =
                typeof error === 'object' && error && 'status' in error
                  ? Number((error as { status?: number }).status)
                  : undefined;

              if (status && [400, 401, 403, 404, 409, 422, 429].includes(status)) {
                return false;
              }

              return failureCount < 1;
            },
          },
          mutations: {
            retry: 0,
          },
        },
      })
  );

  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
