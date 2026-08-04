import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { createApp } from '../../app/server/app';
import { prisma } from '../../app/server/db';

process.env.NODE_ENV = 'test';
process.env.SESSION_SECRET = 'test-session-secret';
process.env.CSRF_SECRET = 'test-csrf-secret';

const app = createApp();

async function ensureUsers() {
  const passwordHash = await bcrypt.hash('Password123!', 10);
  await prisma.user.upsert({
    where: { phone: '+231770000001' },
    update: { passwordHash, role: 'ADMIN', status: 'ACTIVE' },
    create: {
      phone: '+231770000001',
      passwordHash,
      firstName: 'Amina',
      lastName: 'Admin',
      role: 'ADMIN',
      status: 'ACTIVE',
      adminProfile: { create: {} },
    },
  });
  await prisma.user.upsert({
    where: { phone: '+231770000002' },
    update: { passwordHash, role: 'CUSTOMER', status: 'ACTIVE' },
    create: {
      phone: '+231770000002',
      passwordHash,
      firstName: 'Comfort',
      lastName: 'Kollie',
      role: 'CUSTOMER',
      status: 'ACTIVE',
      customerProfile: { create: {} },
    },
  });
  await prisma.user.upsert({
    where: { phone: '+231770000003' },
    update: { passwordHash, role: 'DRIVER', status: 'ACTIVE' },
    create: {
      phone: '+231770000003',
      passwordHash,
      firstName: 'Emmanuel',
      lastName: 'Driver',
      role: 'DRIVER',
      status: 'ACTIVE',
      driverProfile: {
        create: {
          applicationStatus: 'APPROVED',
          availability: { create: { status: 'ONLINE' } },
        },
      },
    },
  });
  await prisma.user.upsert({
    where: { phone: '+231770000004' },
    update: { passwordHash, role: 'MERCHANT', status: 'ACTIVE' },
    create: {
      phone: '+231770000004',
      passwordHash,
      firstName: 'Sarah',
      lastName: 'Merchant',
      role: 'MERCHANT',
      status: 'ACTIVE',
      merchantProfile: {
        create: { applicationStatus: 'APPROVED', businessName: "Cee's Kitchen" },
      },
    },
  });
}

async function login(phone: string) {
  const agent = request.agent(app);
  const res = await agent.post('/api/auth/login').send({ phone, password: 'Password123!' });
  expect(res.status).toBe(200);
  return agent;
}

describe('Admin authorization', () => {
  beforeAll(async () => {
    await ensureUsers();
  });

  it('unauthenticated users cannot retrieve Admin data', async () => {
    const res = await request(app).get('/api/admin/control-center');
    expect(res.status).toBe(401);
  });

  it('customers cannot access Admin routes', async () => {
    const agent = await login('+231770000002');
    const res = await agent.get('/api/admin/control-center');
    expect(res.status).toBe(403);
  });

  it('drivers cannot access Admin routes', async () => {
    const agent = await login('+231770000003');
    const res = await agent.get('/api/admin/control-center');
    expect(res.status).toBe(403);
  });

  it('merchants cannot access Admin routes', async () => {
    const agent = await login('+231770000004');
    const res = await agent.get('/api/admin/control-center');
    expect(res.status).toBe(403);
  });

  it('verified administrators can access the Admin Control Center', async () => {
    const agent = await login('+231770000001');
    const res = await agent.get('/api/admin/control-center');
    expect(res.status).toBe(200);
    expect(res.body.title).toBe('Admin Control Center');
  });
});
