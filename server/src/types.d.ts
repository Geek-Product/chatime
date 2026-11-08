import 'fastify';

export interface AuthUser {
  id: string;
  username: string;
  displayName: string;
  email: string;
  avatarColor: string;
}

declare module 'fastify' {
  interface FastifyRequest {
    user: AuthUser | null;
  }
  interface FastifyInstance {
    findUserById(id: string): Promise<AuthUser | null>;
  }
}
