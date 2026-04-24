'use strict';

process.env.NODE_ENV       = 'test';
process.env.JWT_SECRET     = 'test-jwt-secret-at-least-32-chars!!';
process.env.SESSION_SECRET = 'test-session-secret-32chars-longx';
process.env.DB_PATH        = '/tmp/noop.db';

// Test the mock DB logic itself (no native binary needed)
const { createMockDb } = require('./helpers/mockDb');

let db;
beforeEach(() => { db = createMockDb(); });

const uniqueEmail = () => `db_${Date.now()}_${Math.random().toString(36).slice(2)}@test.com`;

describe('insertUser / findByEmail / findById', () => {
  it('inserts and finds by email',     () => { const e=uniqueEmail(); const u=db.insertUser({email:e,password_hash:'h',name:'U'}); expect(u.id).toBeTruthy(); expect(db.findByEmail(e).id).toBe(u.id); });
  it('finds by id',                    () => { const u=db.insertUser({email:uniqueEmail(),password_hash:'h',name:'U'}); expect(db.findById(u.id).email).toBe(u.email); });
  it('null for non-existent email',    () => { expect(db.findByEmail('x@x.com')).toBeNull(); });
  it('null for non-existent id',       () => { expect(db.findById('bad-id')).toBeNull(); });
  it('returns null on duplicate email',() => { const e=uniqueEmail(); db.insertUser({email:e,password_hash:'h',name:'A'}); expect(db.insertUser({email:e,password_hash:'h',name:'B'})).toBeNull(); });
  it('defaults role to user',          () => { const u=db.insertUser({email:uniqueEmail(),password_hash:'h',name:'U'}); expect(u.role).toBe('user'); expect(u.subscription_tier).toBe('free'); });
});

describe('upsertUser (Google)', () => {
  it('creates new Google user',        () => { const u=db.upsertUser({googleId:'g1',email:uniqueEmail(),name:'G'}); expect(u.google_id).toBe('g1'); });
  it('updates existing user',          () => { const e=uniqueEmail(); const u1=db.upsertUser({googleId:'g2',email:e,name:'Old'}); const u2=db.upsertUser({googleId:'g2',email:e,name:'New'}); expect(u1.id).toBe(u2.id); expect(u2.name).toBe('New'); });
});

describe('updateProfile / updateRole / updateSubscription', () => {
  let user;
  beforeEach(() => { user=db.insertUser({email:uniqueEmail(),password_hash:'x',name:'Test'}); });

  it('updateProfile changes name',     () => { expect(db.updateProfile(user.id,{name:'New'}).name).toBe('New'); });
  it('updateRole changes role',        () => { expect(db.updateRole(user.id,'admin').role).toBe('admin'); });
  it('updateSubscription changes tier',() => { expect(db.updateSubscription(user.id,{subscription_tier:'premium',subscription_status:'active'}).subscription_tier).toBe('premium'); });
});

describe('Usage tracking', () => {
  it('starts at 0',                    () => { const u=db.insertUser({email:uniqueEmail(),password_hash:'x',name:'U'}); expect(db.getUsageToday(u.id)).toBe(0); });
  it('increments correctly',           () => { const u=db.insertUser({email:uniqueEmail(),password_hash:'x',name:'U'}); db.incrementUsage(u.id); db.incrementUsage(u.id); expect(db.getUsageToday(u.id)).toBe(2); });
});

describe('Referral codes', () => {
  let owner, other;
  beforeEach(() => {
    owner=db.insertUser({email:uniqueEmail(),password_hash:'x',name:'Owner'});
    other=db.insertUser({email:uniqueEmail(),password_hash:'x',name:'Other'});
  });

  it('creates 8-char code',            () => { expect(db.createReferralCode(owner.id).code).toHaveLength(8); });
  it('finds the code',                 () => { const ref=db.createReferralCode(owner.id); expect(db.findReferralCode(ref.code).owner_id).toBe(owner.id); });
  it('uses the code',                  () => { const ref=db.createReferralCode(owner.id); db.useReferralCode(ref.code,other.id); expect(db.findReferralCode(ref.code).used).toBe(1); });
  it('throws on already used',         () => { const ref=db.createReferralCode(owner.id); db.useReferralCode(ref.code,other.id); expect(()=>db.useReferralCode(ref.code,other.id)).toThrow(/already used/); });
  it('throws on own code',             () => { const ref=db.createReferralCode(owner.id); expect(()=>db.useReferralCode(ref.code,owner.id)).toThrow(/own/); });
  it('null for non-existent code',     () => { expect(db.findReferralCode('ZZZZZZZZ')).toBeNull(); });
});
