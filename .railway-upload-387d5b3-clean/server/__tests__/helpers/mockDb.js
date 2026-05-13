'use strict';

function createMockDb() {
  const users = new Map();
  const referrals = new Map();
  const usage = new Map();
  let counter = 1;

  return {
    upsertUser: jest.fn(({ googleId, email, name, picture }) => {
      for (const u of users.values()) {
        if (u.google_id === googleId) {
          u.email = email; u.name = name; if (picture !== undefined) u.picture = picture;
          return u;
        }
      }
      const id = `uid-${counter++}`;
      const user = { id, google_id: googleId, email, name, picture: picture||null,
        role: 'user', subscription_tier: 'free', subscription_status: 'active',
        subscription_expires_at: null, stripe_customer_id: null, password_hash: null,
        created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
        last_login_at: new Date().toISOString() };
      users.set(id, user); return user;
    }),
    insertUser: jest.fn(({ email, password_hash, name, role='user', terms_accepted_at=null }) => {
      for (const u of users.values()) if (u.email === email) return null;
      const id = `uid-${counter++}`;
      const user = { id, google_id: null, email, name, password_hash, role,
        subscription_tier: 'free', subscription_status: 'active',
        subscription_expires_at: null, stripe_customer_id: null,
        terms_accepted_at,
        created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
      users.set(id, user); return user;
    }),
    findById:             jest.fn((id)    => users.get(id) || null),
    findByEmail:          jest.fn((email) => { for (const u of users.values()) if (u.email===email) return u; return null; }),
    findByGoogleId:       jest.fn((gid)   => { for (const u of users.values()) if (u.google_id===gid) return u; return null; }),
    findAll:              jest.fn(()      => Array.from(users.values())),
    updateProfile:        jest.fn((id,{name})  => { const u=users.get(id); if(!u) return null; u.name=name; return u; }),
    updateRole:           jest.fn((id, role)   => { const u=users.get(id); if(!u) return null; u.role=role; return u; }),
    updateSubscription:   jest.fn((id, data)   => { const u=users.get(id); if(!u) return null; Object.assign(u,data); return u; }),
    updateStripeCustomerId: jest.fn((id,cid)   => { const u=users.get(id); if(u) u.stripe_customer_id=cid; }),
    findByStripeCustomerId: jest.fn((cid)      => { for(const u of users.values()) if(u.stripe_customer_id===cid) return u; return null; }),
    findByStripeSubscriptionId: jest.fn((sid)  => { for(const u of users.values()) if(u.stripe_subscription_id===sid) return u; return null; }),
    updateStripeSubscription: jest.fn((id, fields) => {
      const u = users.get(id); if (!u) return null;
      for (const k of ['stripe_subscription_id','current_period_end','cancel_at_period_end','canceled_at','subscription_status','subscription_tier']) {
        if (fields[k] !== undefined) u[k] = fields[k];
      }
      return u;
    }),
    getUsageToday:        jest.fn((uid)   => usage.get(uid)||0),
    incrementUsage:       jest.fn((uid)   => usage.set(uid,(usage.get(uid)||0)+1)),
    createReferralCode:   jest.fn((ownerId) => {
      const code = Math.random().toString(36).slice(2,10).toUpperCase();
      const ref  = { id: counter++, code, owner_id: ownerId, used: 0, used_by: null,
                     expires_at: new Date(Date.now()+30*86400000).toISOString() };
      referrals.set(code, ref); return ref;
    }),
    findReferralCode:     jest.fn((code)  => referrals.get(code)||null),
    useReferralCode:      jest.fn((code, userId) => {
      const ref = referrals.get(code);
      if (!ref)       throw new Error('Referral code not found');
      if (ref.used)   throw new Error('Referral code already used');
      if (ref.owner_id === userId) throw new Error('Cannot use your own referral code');
      ref.used = 1; ref.used_by = userId;
    }),
    sanitizeUser: jest.fn((user) => {
      if (!user) return user;
      const clean = { ...user };
      delete clean.password_hash;
      return clean;
    }),
    initDb: jest.fn(() => Promise.resolve()),
    // Aliases matching actual db module export names
    getUserById:           jest.fn((id) => users.get(id) || null),
    getUserByEmail:        jest.fn((email) => { for (const u of users.values()) if (u.email===email) return u; return null; }),
    getUserByGoogleId:     jest.fn((gid) => { for (const u of users.values()) if (u.google_id===gid) return u; return null; }),
    updateUser:            jest.fn((id, data) => { const u=users.get(id); if(!u) return null; Object.assign(u, data); return u; }),
    getAllUsers:            jest.fn(() => Array.from(users.values())),
    deleteUser:            jest.fn((id) => { users.delete(id); }),
    _users:    users,
    _referrals: referrals,
    _usage:    usage,
    _reset() { users.clear(); referrals.clear(); usage.clear(); counter=1; },
  };
}

module.exports = { createMockDb };
