'use client';

/**
 * The app's single backend seam, talking to the Django marking site.
 *
 * It deliberately keeps the shape the pages were already written against -- an
 * `rpc(name, args)` returning `{ data, error }`, and an `auth` object -- so
 * replacing Supabase meant changing an identifier at each call site rather than
 * rewriting the pages.
 *
 * Identity is the marking site's own session cookie. There is no client-side
 * sign-in: the whole app is served from behind Django's login gate, so by the
 * time this code runs the user is already authenticated.
 */

const API_ROOT = '/api/v1/briefs';
const LOGIN_URL = '/login';
const LOGOUT_URL = '/logout';

/** A signed-in supervisor, shaped like the Supabase user the pages expect. */
export type User = {
  id: string;
  email: string | null;
  user_metadata: Record<string, unknown>;
};

export type Session = { user: User };

export type BackendError = { message: string };
export type BackendResult<T> = { data: T | null; error: BackendError | null };

// Everything is served from the same Django instance, so the backend is always
// present. Kept as a constant because the pages still branch on it.
export const isBackendConfigured = true;

let sessionRequest: Promise<User | null> | null = null;
let csrfToken = '';

function readCookie(name: string) {
  const match = document.cookie
    .split(';')
    .map((entry) => entry.trim())
    .find((entry) => entry.startsWith(`${name}=`));
  return match ? decodeURIComponent(match.slice(name.length + 1)) : '';
}

/**
 * Read the session once and cache it.
 *
 * This also collects the CSRF token. A statically-exported HTML page never gets
 * a csrftoken cookie of its own, because no Django view rendered it, so the
 * session endpoint hands the token over in its body (and sets the cookie) before
 * anything tries to POST.
 */
function loadSession(): Promise<User | null> {
  if (!sessionRequest) {
    sessionRequest = fetch(`${API_ROOT}/session/`, {
      credentials: 'same-origin',
      headers: { Accept: 'application/json' },
    })
      .then((response) => (response.ok ? response.json() : null))
      .then((payload) => {
        csrfToken = payload?.data?.csrf_token ?? '';
        return (payload?.data?.user ?? null) as User | null;
      })
      .catch(() => null);
  }
  return sessionRequest;
}

async function csrfHeader() {
  await loadSession();
  return csrfToken || readCookie('csrftoken');
}

async function rpc<T = unknown>(
  name: string,
  args?: Record<string, unknown>,
): Promise<BackendResult<T>> {
  try {
    const response = await fetch(`${API_ROOT}/${name}/`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'X-CSRFToken': await csrfHeader(),
      },
      body: JSON.stringify(args ?? {}),
    });

    const payload = await response.json().catch(() => null);

    if (!response.ok) {
      return {
        data: null,
        error: {
          message:
            payload?.error ??
            `The server rejected that request (${response.status}).`,
        },
      };
    }

    // `?? null` rather than `||`: several endpoints legitimately return false.
    return { data: (payload?.data ?? null) as T, error: null };
  } catch {
    return {
      data: null,
      error: { message: 'Could not reach the server. Check your connection.' },
    };
  }
}

export const backend = {
  rpc,

  auth: {
    async getSession() {
      const user = await loadSession();
      return { data: { session: user ? ({ user } as Session) : null } };
    },

    /**
     * A no-op subscription.
     *
     * A Django session cannot change underneath the page the way a Supabase
     * token could, so there is nothing to notify. Every page already reads
     * `getSession()` on mount; firing the callback as well would just load each
     * dashboard twice.
     */
    onAuthStateChange(
      _callback: (event: string, session: Session | null) => void,
    ) {
      return { data: { subscription: { unsubscribe() {} } } };
    },

    async signInWithOAuth() {
      window.location.href = LOGIN_URL;
      return { error: null as BackendError | null };
    },

    async signOut() {
      window.location.href = LOGOUT_URL;
      return { error: null as BackendError | null };
    },
  },
};
