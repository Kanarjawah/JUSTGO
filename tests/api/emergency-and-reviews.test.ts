import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { createApp } from '../../server/app';
import { prisma } from '../../server/db';
import { encryptText } from '../../server/lib/crypto';

process.env.NODE_ENV = 'test';
const app = createApp();

describe('Emergency contacts and reviews', () => {
  let rideId = '';

  beforeAll(async () => {
    const passwordHash = await bcrypt.hash('Password123!', 10);
    const customer = await prisma.user.upsert({
      where: { phone: '+231770000002' },
      update: {},
      create: {
        phone: '+231770000002',
        passwordHash,
        firstName: 'Comfort',
        lastName: 'Kollie',
        role: 'CUSTOMER',
        customerProfile: { create: {} },
      },
      include: { customerProfile: true },
    });
    const driver = await prisma.user.upsert({
      where: { phone: '+231770000003' },
      update: {},
      create: {
        phone: '+231770000003',
        passwordHash,
        firstName: 'Emmanuel',
        lastName: 'Driver',
        role: 'DRIVER',
        driverProfile: {
          create: {
            applicationStatus: 'APPROVED',
            availability: { create: { status: 'ONLINE' } },
          },
        },
      },
      include: { driverProfile: true },
    });

    const customerProfile =
      customer.customerProfile ||
      (await prisma.customerProfile.findUnique({ where: { userId: customer.id } }));
    const driverProfile =
      driver.driverProfile ||
      (await prisma.driverProfile.findUnique({ where: { userId: driver.id } }));

    await prisma.rideRequest.deleteMany({ where: { requestNumber: 'RIDE-TEST-EC' } });
    const ride = await prisma.rideRequest.create({
      data: {
        requestNumber: 'RIDE-TEST-EC',
        customerId: customerProfile!.id,
        serviceType: 'RIDE',
        pickup: 'A',
        destination: 'B',
        pickupDate: '2026-08-02',
        pickupTime: '10:00',
        riderCount: 1,
        customerPhone: '+231770000002',
        estimatedFareCents: 20000,
        paymentMethod: 'MTN_MOMO',
        safetyConsent: true,
        adminStatus: 'ACCEPTED',
        fulfillmentStage: 'IN_TRANSIT',
        emergencyContacts: {
          create: {
            customerId: customerProfile!.id,
            nameEncrypted: encryptText('Secret Contact'),
            phoneEncrypted: encryptText('+231770099999'),
          },
        },
        assignment: {
          create: { driverId: driverProfile!.id, active: true },
        },
      },
    });
    rideId = ride.id;
  });

  it('does not return emergency-contact information to drivers', async () => {
    const agent = request.agent(app);
    await agent.post('/api/auth/login').send({ phone: '+231770000003', password: 'Password123!' });
    const res = await agent.get('/api/driver/requests');
    expect(res.status).toBe(200);
    const blob = JSON.stringify(res.body);
    expect(blob).not.toContain('Secret Contact');
    expect(blob).not.toContain('+231770099999');
    expect(blob).not.toContain('emergency');
  });

  it('blocks reviews until delivery is complete', async () => {
    const agent = request.agent(app);
    await agent.post('/api/auth/login').send({ phone: '+231770000002', password: 'Password123!' });
    const blocked = await agent.post('/api/customer/reviews').send({
      kind: 'ride',
      requestId: rideId,
      rating: 5,
      target: 'driver',
    });
    expect(blocked.status).toBe(400);

    await prisma.rideRequest.update({
      where: { id: rideId },
      data: { fulfillmentStage: 'DELIVERED' },
    });

    const allowed = await agent.post('/api/customer/reviews').send({
      kind: 'ride',
      requestId: rideId,
      rating: 5,
      target: 'overall',
    });
    expect(allowed.status).toBe(201);
  });
});
