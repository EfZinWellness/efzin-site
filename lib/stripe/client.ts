import Stripe from "stripe";

type PaymentMethodRef = string | { id: string } | null;

/** The fields of a Charge the cancellation refunds read (balance_transaction expanded). */
export interface ChargeRef {
  id: string;
  amount: number;
  amount_refunded: number;
  currency: string;
  created: number;
  status: string;
  balance_transaction: string | { fee: number; currency: string; exchange_rate: number | null } | null;
}

/**
 * The slice of the Stripe client this app uses. The real `Stripe` instance satisfies it;
 * tests pass a typed fake so the real API is never called.
 */
export interface StripeApi {
  checkout: {
    sessions: {
      create(
        params: Stripe.Checkout.SessionCreateParams,
        options?: Stripe.RequestOptions,
      ): Promise<{ id: string; url: string | null }>;
      expire(
        id: string,
        params?: Stripe.Checkout.SessionExpireParams,
        options?: Stripe.RequestOptions,
      ): Promise<{ id: string }>;
      retrieve(id: string): Promise<{ id: string; status: Stripe.Checkout.Session.Status | null }>;
      list(params: Stripe.Checkout.SessionListParams): Promise<{
        data: { id: string; metadata: Stripe.Metadata | null }[];
        has_more: boolean;
      }>;
    };
  };
  charges: {
    list(params: Stripe.ChargeListParams): Promise<{ data: ChargeRef[]; has_more: boolean }>;
  };
  invoicePayments: {
    list(params: Stripe.InvoicePaymentListParams): Promise<{
      data: { id: string; status: string; payment: { type: string; payment_intent?: string | { id: string } | null } }[];
      has_more: boolean;
    }>;
  };
  customers: {
    create(params: Stripe.CustomerCreateParams, options?: Stripe.RequestOptions): Promise<{ id: string }>;
    retrieve(
      id: string,
    ): Promise<{ deleted?: unknown; invoice_settings?: { default_payment_method: PaymentMethodRef } }>;
    update(id: string, params: Stripe.CustomerUpdateParams, options?: Stripe.RequestOptions): Promise<{ id: string }>;
  };
  paymentIntents: {
    retrieve(id: string): Promise<{ id: string; payment_method: PaymentMethodRef }>;
  };
  paymentMethods: {
    retrieve(id: string): Promise<{ id: string; card?: { last4: string } | null }>;
  };
  setupIntents: {
    retrieve(id: string): Promise<{ id: string; payment_method: PaymentMethodRef }>;
  };
  invoices: {
    create(params: Stripe.InvoiceCreateParams, options?: Stripe.RequestOptions): Promise<{ id: string }>;
    retrieve(id: string): Promise<{
      id: string;
      status: Stripe.Invoice.Status | null;
      total: number;
      collection_method: Stripe.Invoice.CollectionMethod;
    }>;
    finalizeInvoice(
      id: string,
      params?: Stripe.InvoiceFinalizeInvoiceParams,
      options?: Stripe.RequestOptions,
    ): Promise<{ id: string; status: Stripe.Invoice.Status | null }>;
    pay(
      id: string,
      params?: Stripe.InvoicePayParams,
      options?: Stripe.RequestOptions,
    ): Promise<{ id: string; status: Stripe.Invoice.Status | null }>;
    sendInvoice(
      id: string,
      params?: Stripe.InvoiceSendInvoiceParams,
      options?: Stripe.RequestOptions,
    ): Promise<{ id: string }>;
    voidInvoice(id: string): Promise<{ id: string }>;
    list(params: Stripe.InvoiceListParams): Promise<{ data: { id: string }[]; has_more: boolean }>;
    update(id: string, params: Stripe.InvoiceUpdateParams): Promise<{ id: string }>;
  };
  refunds: {
    create(params: Stripe.RefundCreateParams, options?: Stripe.RequestOptions): Promise<{ id: string }>;
  };
  invoiceItems: {
    create(params: Stripe.InvoiceItemCreateParams, options?: Stripe.RequestOptions): Promise<{ id: string }>;
  };
}

/** Id of an expandable Stripe reference (`"pm_123"` or `{ id: "pm_123" }`). */
export function refId(ref: string | { id: string } | null | undefined): string | null {
  if (!ref) return null;
  return typeof ref === "string" ? ref : ref.id;
}

let client: Stripe | null = null;

/** Lazily constructed from STRIPE_SECRET_KEY; null when no key is configured. */
export function getStripe(): Stripe | null {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return null;
  client ??= new Stripe(key);
  return client;
}
