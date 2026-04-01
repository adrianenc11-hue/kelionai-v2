import { describe, it, expect } from "vitest";

describe("Stripe Price IDs", () => {
  it("should have all price IDs set", () => {
    expect(process.env.STRIPE_PRO_MONTHLY_PRICE_ID).toBeTruthy();
    expect(process.env.STRIPE_PRO_MONTHLY_PRICE_ID).toMatch(/^price_/);
    
    expect(process.env.STRIPE_PRO_YEARLY_PRICE_ID).toBeTruthy();
    expect(process.env.STRIPE_PRO_YEARLY_PRICE_ID).toMatch(/^price_/);
    
    expect(process.env.STRIPE_ENTERPRISE_MONTHLY_PRICE_ID).toBeTruthy();
    expect(process.env.STRIPE_ENTERPRISE_MONTHLY_PRICE_ID).toMatch(/^price_/);
    
    expect(process.env.STRIPE_ENTERPRISE_YEARLY_PRICE_ID).toBeTruthy();
    expect(process.env.STRIPE_ENTERPRISE_YEARLY_PRICE_ID).toMatch(/^price_/);
  });
});
