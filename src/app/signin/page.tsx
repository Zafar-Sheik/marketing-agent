import { redirect } from 'next/navigation';
import { auth, signIn, devLoginEnabled } from '@/auth';
import { env } from '@/env';
import { Spotlight } from '@/components/ui/spotlight';
import { Button } from '@/components/ui/primitives';

export const metadata = { title: 'Sign in' };
export const dynamic = 'force-dynamic';

export default async function SignIn() {
  if ((await auth())?.user) redirect('/dashboard');
  const google = Boolean(env().AUTH_GOOGLE_ID);
  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden grid-bg px-4">
      <Spotlight className="-top-40 left-0 md:left-40" fill="#7c5cff" />
      <div className="relative z-10 w-full max-w-sm rounded-2xl border border-line bg-panel/90 p-8 backdrop-blur">
        <h1 className="text-xl font-semibold">Sign in to Marketing Agent</h1>
        <p className="mt-1 text-sm text-muted">Manage every client’s TikTok from one place.</p>
        <div className="mt-6 flex flex-col gap-3">
          {google && (
            <form
              action={async () => {
                'use server';
                await signIn('google', { redirectTo: '/dashboard' });
              }}
            >
              <Button className="w-full">Continue with Google</Button>
            </form>
          )}
          {devLoginEnabled && (
            <form
              action={async (form: FormData) => {
                'use server';
                await signIn('dev', { email: String(form.get('email')), redirectTo: '/dashboard' });
              }}
              className="flex flex-col gap-3"
            >
              <label className="label" htmlFor="email">
                Email (development login)
              </label>
              <input id="email" name="email" type="email" required className="field" placeholder="you@agency.com" />
              <Button>Continue</Button>
              <p className="text-xs text-muted">Add AUTH_GOOGLE_ID to .env to switch to Google sign-in.</p>
            </form>
          )}
          {!google && !devLoginEnabled && <p className="text-sm text-bad">No sign-in method configured. Set AUTH_GOOGLE_ID and AUTH_GOOGLE_SECRET.</p>}
        </div>
      </div>
    </main>
  );
}
