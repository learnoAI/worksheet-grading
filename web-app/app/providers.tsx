'use client'

import { useEffect } from "react"

import posthog from 'posthog-js'
import { PostHogProvider as PHProvider } from 'posthog-js/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 15_000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
})

export function PostHogProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    // Only initialize if not already initialized
    if (typeof window !== 'undefined' && !posthog.__loaded) {
      posthog.init(process.env.NEXT_PUBLIC_POSTHOG_KEY as string, {
        api_host: process.env.NEXT_PUBLIC_POSTHOG_HOST || 'https://us.i.posthog.com',
        person_profiles: 'identified_only', // Match the layout.tsx configuration
        capture_pageview: true,
        capture_pageleave: true,
        loaded: (posthog) => {
          if (process.env.NODE_ENV === 'development') console.log('PostHog loaded')
        },
        ui_host: 'https://us.posthog.com',
        autocapture: true,
        disable_session_recording: false,
      })
    }
  }, [])

  return (
    <QueryClientProvider client={queryClient}>
      <PHProvider client={posthog}>
        {children}
      </PHProvider>
    </QueryClientProvider>
  )
}
