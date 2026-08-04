import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { createApp } from '../../app/server/app';
import { prisma } from '../../app/server/db';

process.env.NODE_ENV = 'test';

const app = createApp();

describe('Driver availability', () => {
  beforeAll(async () => {
    const passwordHash = await bcrypt.hash('Password123!', 10);
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
  });

  it('driver can switch between ONLINE and OFF and OFF blocks new offers', async () => {
    const agent = request.agent(app);
    await agent.post('/api/auth/login').send({ phone: '+231770000003', password: 'Password123!' });

    const offline = await agent.post('/api/driver/availability').send({ status: 'OFF' });
    expect(offline.status).toBe(200);
    expect(offline.body.status).toBe('OFF');
    expect(offline.body.message).toContain('offline');

    const reqsOff = await agent.get('/api/driver/requests');
    expect(reqsOff.status).toBe(200);
    expect(reqsOff.body.offers).toEqual([]);

    const online = await agent.post('/api/driver/availability').send({ status: 'ONLINE' });
    expect(online.status).toBe(200);
    expect(online.body.status).toBe('ONLINE');

    const persisted = await agent.get('/api/driver/availability');
    expect(persisted.body.status).toBe('ONLINE');

    // Active/assigned requests remain listed even after going OFF
    await agent.post('/api/driver/availability').send({ status: 'OFF' });
    const reqs = await agent.get('/api/driver/requests');
    expect(Array.isArray(reqs.body.requests)).toBe(true);
  });
});
