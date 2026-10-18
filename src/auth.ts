import NextAuth, { type NextAuthConfig } from 'next-auth';
import Google from 'next-auth/providers/google';
import Credentials from 'next-auth/providers/credentials';
import { eq } from 'drizzle-orm';
import { db, schema } from '@/db';
import { env } from '@/env';
import { slugify } from '@/lib/domain/text';

/** First sign-in creates the user and their agency workspace. */
async function ensureUser(email: string, name?: string | null, image?: string | null) {
  const d = await db();
  const normalized = email.trim().toLowerCase();
  let [user] = await d.select().from(schema.users).where(eq(schema.users.email, normalized));
  if (!user) {
    [user] = await d.insert(schema.users).values({ email: normalized, name, imageUrl: image }).returning();
  }
  const [membership] = await d.select().from(schema.workspaceMembers).where(eq(schema.workspaceMembers.userId, user.id));
  if (!membership) {
    const base = slugify(`${name ?? normalized.split('@')[0]}-agency`);
    const [ws] = await d
      .insert(schema.workspaces)
      .values({ name: `${name ?? normalized.split('@')[0]}'s agency`, slug: `${base}-${user.id.slice(0, 6)}` })
      .returning();
    await d.insert(schema.workspaceMembers).values({ workspaceId: ws.id, userId: user.id, role: 'owner' });
  }
  return user;
}

const e = env();
const devLogin = !e.AUTH_GOOGLE_ID && e.NODE_ENV !== 'production';

const config: NextAuthConfig = {
  secret: e.AUTH_SECRET ?? (e.NODE_ENV !== 'production' ? 'dev-only-secret-run-npm-run-env-setup' : undefined),
  trustHost: true,
  session: { strategy: 'jwt' },
  pages: { signIn: '/signin' },
  providers: [
    ...(e.AUTH_GOOGLE_ID ? [Google({ clientId: e.AUTH_GOOGLE_ID, clientSecret: e.AUTH_GOOGLE_SECRET })] : []),
    // Local development without Google keys: sign in with just an email.
    ...(devLogin
      ? [
          Credentials({
            id: 'dev',
            name: 'Development login',
            credentials: { email: { label: 'Email', type: 'email' } },
            async authorize(credentials) {
              const email = String(credentials?.email ?? '');
              if (!/^[^@\s]+@[^@\s]+$/.test(email)) return null;
              const user = await ensureUser(email, email.split('@')[0]);
              return { id: user.id, email: user.email, name: user.name };
            },
          }),
        ]
      : []),
  ],
  callbacks: {
    async signIn({ user }) {
      if (!user.email) return false;
      await ensureUser(user.email, user.name, user.image);
      return true;
    },
    async jwt({ token, user }) {
      if (user?.email) {
        const u = await ensureUser(user.email, user.name, user.image);
        token.uid = u.id;
      }
      return token;
    },
    session({ session, token }) {
      if (token.uid) session.user.id = token.uid as string;
      return session;
    },
  },
};

export const { handlers, auth, signIn, signOut } = NextAuth(config);
export const devLoginEnabled = devLogin;
