/**
 * Create Stripe products and prices for KelionAI v2
 * Run once to set up products in Stripe dashboard
 */
import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || '');

async function setupProducts() {
  console.log('[Stripe Setup] Creating products and prices...');

  // Create Pro product
  const proProduct = await stripe.products.create({
    name: 'KelionAI Pro',
    description: 'Pro plan - 500 messages/month, 100 voice minutes, priority support',
  });
  console.log('[Stripe Setup] Pro product created:', proProduct.id);

  // Pro Monthly price - €9.99/month
  const proMonthly = await stripe.prices.create({
    product: proProduct.id,
    unit_amount: 999,
    currency: 'eur',
    recurring: { interval: 'month' },
  });
  console.log('[Stripe Setup] Pro Monthly price:', proMonthly.id);

  // Pro Yearly price - €99.99/year (save ~17%)
  const proYearly = await stripe.prices.create({
    product: proProduct.id,
    unit_amount: 9999,
    currency: 'eur',
    recurring: { interval: 'year' },
  });
  console.log('[Stripe Setup] Pro Yearly price:', proYearly.id);

  // Create Enterprise product
  const enterpriseProduct = await stripe.products.create({
    name: 'KelionAI Enterprise',
    description: 'Enterprise plan - Unlimited messages, 1000 voice minutes, voice cloning, priority support',
  });
  console.log('[Stripe Setup] Enterprise product created:', enterpriseProduct.id);

  // Enterprise Monthly price - €29.99/month
  const enterpriseMonthly = await stripe.prices.create({
    product: enterpriseProduct.id,
    unit_amount: 2999,
    currency: 'eur',
    recurring: { interval: 'month' },
  });
  console.log('[Stripe Setup] Enterprise Monthly price:', enterpriseMonthly.id);

  // Enterprise Yearly price - €299.99/year (save ~17%)
  const enterpriseYearly = await stripe.prices.create({
    product: enterpriseProduct.id,
    unit_amount: 29999,
    currency: 'eur',
    recurring: { interval: 'year' },
  });
  console.log('[Stripe Setup] Enterprise Yearly price:', enterpriseYearly.id);

  console.log('\n=== PRICE IDS TO SET AS ENV VARS ===');
  console.log(`STRIPE_PRO_MONTHLY_PRICE_ID=${proMonthly.id}`);
  console.log(`STRIPE_PRO_YEARLY_PRICE_ID=${proYearly.id}`);
  console.log(`STRIPE_ENTERPRISE_MONTHLY_PRICE_ID=${enterpriseMonthly.id}`);
  console.log(`STRIPE_ENTERPRISE_YEARLY_PRICE_ID=${enterpriseYearly.id}`);
}

setupProducts().catch(console.error);
