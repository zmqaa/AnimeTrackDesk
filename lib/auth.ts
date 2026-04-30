import type { NextAuthOptions } from 'next-auth';
import CredentialsProvider from 'next-auth/providers/credentials';
import bcrypt from 'bcrypt';
import type { JWT } from 'next-auth/jwt';

import { query } from '@/lib/db';

interface AuthUserRow {
  id: number;
  username: string;
  password_hash: string;
  name: string;
  role: string;
}

export const authOptions: NextAuthOptions = {
  providers: [
    CredentialsProvider({
      name: 'Credentials',
      credentials: {
        username: { label: 'Username', type: 'text' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials) {
        if (!credentials?.username || !credentials?.password) {
          return null;
        }

        const users = await query<AuthUserRow[]>(
          'SELECT id, username, password_hash, name, role FROM users WHERE username = ?',
          [credentials.username]
        );

        if (users && users.length > 0) {
          const user = users[0];
          const isValid = await bcrypt.compare(credentials.password, user.password_hash);
          if (isValid) {
            return {
              id: user.id.toString(),
              name: user.name,
              username: user.username,
              role: user.role,
            };
          }
        }

        return null;
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      const nextToken = token as JWT & { role?: string };
      if (user) {
        nextToken.role = (user as { role?: string }).role;
      }
      return nextToken;
    },
    async session({ session, token }) {
      if (session.user) {
        (session.user as typeof session.user & { role?: string }).role = (token as JWT & { role?: string }).role;
      }
      return session;
    },
  },
  pages: {
    signIn: '/login',
  },
  session: {
    strategy: 'jwt',
  },
  secret: process.env.NEXTAUTH_SECRET,
};