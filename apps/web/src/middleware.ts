import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient, type CookieOptions } from '@supabase/ssr';

// Geofence: a starter list of disallowed country codes.
// Tune for your operating jurisdiction.
const BLOCKED_COUNTRIES = new Set(['US', 'FR', 'AU', 'IL', 'KP', 'IR', 'CU', 'SY', 'SD']);

export async function middleware(req: NextRequest) {
  const url = req.nextUrl.clone();
  // Country detection: prefer Cloudflare's header (when behind Cloudflare),
  // fall back to Vercel's, then to Fly's region as a coarse approximation.
  const country = (
    req.headers.get('cf-ipcountry') ??
    req.headers.get('x-vercel-ip-country') ??
    req.headers.get('fly-client-ip-country') ??
    ''
  ).toUpperCase();
  if (BLOCKED_COUNTRIES.has(country) && !url.pathname.startsWith('/blocked') && !url.pathname.startsWith('/api/health')) {
    url.pathname = '/blocked';
    url.searchParams.set('country', country);
    return NextResponse.redirect(url);
  }

  // Refresh Supabase session via cookies on every request
  let response = NextResponse.next({ request: { headers: req.headers } });
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return req.cookies.getAll(); },
        setAll(list: Array<{ name: string; value: string; options?: CookieOptions }>) {
          for (const c of list) {
            req.cookies.set(c.name, c.value);
            response = NextResponse.next({ request: { headers: req.headers } });
            response.cookies.set({ name: c.name, value: c.value, ...(c.options ?? {}) });
          }
        },
      },
    }
  );
  await supabase.auth.getUser();

  // Auth wall for game routes
  const protectedRoutes = ['/lobby', '/table', '/tournaments', '/wallet', '/profile'];
  if (protectedRoutes.some(p => url.pathname.startsWith(p))) {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      url.pathname = '/auth';
      url.searchParams.set('next', req.nextUrl.pathname);
      return NextResponse.redirect(url);
    }
  }

  return response;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|svg|css|js)$).*)'],
};
