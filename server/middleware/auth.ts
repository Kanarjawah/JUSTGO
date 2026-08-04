import type { NextFunction, Request, Response } from 'express';
import type { Role } from '@prisma/client';
import { prisma } from '../db.js';

export interface AuthedUser {
  id: string;
  role: Role;
  firstName: string;
  lastName: string;
  phone: string;
  status: string;
}

declare module 'express-session' {
  interface SessionData {
    userId?: string;
  }
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthedUser;
    }
  }
}

export async function loadUser(req: Request, _res: Response, next: NextFunction) {
  try {
    if (!req.session.userId) {
      return next();
    }
    const user = await prisma.user.findUnique({ where: { id: req.session.userId } });
    if (!user || user.status === 'DEACTIVATED' || user.status === 'SUSPENDED') {
      req.session.userId = undefined;
      return next();
    }
    req.user = {
      id: user.id,
      role: user.role,
      firstName: user.firstName,
      lastName: user.lastName,
      phone: user.phone,
      status: user.status,
    };
    next();
  } catch (err) {
    next(err);
  }
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.user) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  next();
}

export function requireRole(...roles: Role[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    next();
  };
}
