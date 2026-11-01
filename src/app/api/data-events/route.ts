import { auth } from '@/lib/auth';
import { getDataChangeScopes } from '@/lib/db/data-changes';
import { readDataChangeState, subscribeServerDataChanges } from '@/lib/data-changes';

/** Notification-only SSE. Domain reads/writes remain authenticated actions. */
export async function GET(request: Request): Promise<Response> {
  const session = await auth();
  if (!session?.user?.id) return new Response(null, { status: 401 });
  const userId = session.user.id;
  const encoder = new TextEncoder();
  let dispose = () => {};
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      let previous: string | undefined;
      let unsubscribe = () => {};
      const close = () => {
        if (closed) return;
        closed = true;
        clearInterval(heartbeat);
        clearTimeout(renewal);
        unsubscribe();
        request.signal.removeEventListener('abort', close);
        try { controller.close(); } catch { /* cancellation already closed it */ }
      };
      dispose = close;
      const send = () => {
        if (closed) return;
        try {
          const scopes = getDataChangeScopes(userId);
          if (scopes.size === 0) return close();
          const { revision } = readDataChangeState(scopes);
          if (revision === previous) return;
          previous = revision;
          controller.enqueue(encoder.encode(`event: changed\ndata: ${JSON.stringify({ revision })}\n\n`));
        } catch { close(); }
      };
      unsubscribe = subscribeServerDataChanges(send);
      request.signal.addEventListener('abort', close, { once: true });
      const heartbeat = setInterval(() => {
        if (!closed) controller.enqueue(encoder.encode(': keepalive\n\n'));
      }, 15_000);
      // A new request rechecks the DB session; no indefinitely authenticated stream.
      const renewal = setTimeout(close, 55_000);
      if (request.signal.aborted) close();
      else send();
    },
    cancel() { dispose(); },
  });
  return new Response(stream, { headers: {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'private, no-store, no-transform',
    'X-Accel-Buffering': 'no',
  } });
}
