'use client';

import { usePostHog } from 'posthog-js/react';
import { Button } from '@/components/ui/button';

export function PostHogTest() {
  const posthog = usePostHog();

  const testPostHog = () => {
    try {
      if (posthog && typeof posthog.capture === 'function') {
        posthog.capture('posthog_test_event', {
          test_property: 'test_value',
          timestamp: new Date().toISOString(),
          page: 'posthog_test'
        });
        console.log('PostHog test event sent successfully');
        alert('PostHog test event sent! Check console and PostHog dashboard.');
      } else {
        console.error('PostHog not available');
        alert('PostHog not available - check configuration');
      }
    } catch (error) {
      console.error('Error sending PostHog test event:', error);
      alert(`Error: ${error}`);
    }
  };

  const checkPostHogStatus = () => {
    console.log('PostHog status:', {
      available: !!posthog,
      captureFunction: typeof posthog?.capture,
      distinctId: posthog?.get_distinct_id?.(),
      config: {
        api_host: (posthog as any)?._config?.api_host || 'unknown',
        project_token: ((posthog as any)?._config?.token?.slice(0, 10) + '...') || 'unknown'
      }
    });
  };

  return (
    <div className="p-4 border rounded-lg space-y-2">
      <h3 className="text-lg font-semibold">PostHog Debug Tools</h3>
      <div className="space-x-2">
        <Button onClick={testPostHog} variant="outline" size="sm">
          Send Test Event
        </Button>
        <Button onClick={checkPostHogStatus} variant="outline" size="sm">
          Check Status
        </Button>
      </div>
    </div>
  );
}
