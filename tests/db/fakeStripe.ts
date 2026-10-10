import type Stripe from "stripe";
import type { StripeApi } from "../../lib/stripe/client";

type InvoiceStatus = Stripe.Invoice.Status;

export interface FakeCharge {
  id: string;
  object: "charge";
  payment_intent: string;
  amount: number;
  amount_refunded: number;
  currency: string;
  created: number;
  status: "succeeded";
  refunded: boolean;
  balance_transaction: { id: string; fee: number; currency: string; exchange_rate: number | null };
}

/** Records every call; never talks to Stripe. */
export class FakeStripe implements StripeApi {
  sessions: Stripe.Checkout.SessionCreateParams[] = [];
  customersCreated: Stripe.CustomerCreateParams[] = [];
  customerUpdates: { id: string; params: Stripe.CustomerUpdateParams }[] = [];
  expired: string[] = [];
  /** Status returned by checkout.sessions.retrieve (default "open"). */
  sessionStatus: Record<string, Stripe.Checkout.Session.Status> = {};
  invoicesCreated: { id: string; params: Stripe.InvoiceCreateParams }[] = [];
  invoiceItemsCreated: Stripe.InvoiceItemCreateParams[] = [];
  invoiceStatus: Record<string, InvoiceStatus> = {};
  invoiceCustomer: Record<string, string> = {};
  invoiceUpdates: { id: string; params: Stripe.InvoiceUpdateParams }[] = [];
  invoiceTotal: Record<string, number> = {};
  invoiceFinalized: { id: string; params?: Stripe.InvoiceFinalizeInvoiceParams }[] = [];
  invoicePaid: string[] = [];
  voided: string[] = [];
  /** invoices.sendInvoice calls (pay-by-link emails), with their idempotency key. */
  invoicesSent: { id: string; idempotencyKey?: string }[] = [];
  /** Set to make the next sendInvoice call throw (once). */
  sendInvoiceError: unknown = null;
  /** Set to make the next invoiceItems.create / voidInvoice call throw (once). */
  invoiceItemError: unknown = null;
  voidError: unknown = null;
  /** Max invoices per list page (to exercise pagination). */
  pageSize = 10;
  /** Set to make the next create / expire call throw. */
  createError: unknown = null;
  expireError: unknown = null;
  /** Set to make invoices.pay throw (e.g. a card error). */
  payError: unknown = null;
  /** Set to make customers.update throw. */
  customerUpdateError: unknown = null;

  /** Idempotency keys seen by checkout.sessions.create: params (JSON) and the response. */
  idempotency = new Map<string, { params: string; result: { id: string; url: string } }>();

  checkout = {
    sessions: {
      create: async (params: Stripe.Checkout.SessionCreateParams, options?: Stripe.RequestOptions) => {
        // Like Stripe: a reused key returns the first response, or errors if the params differ.
        const key = options?.idempotencyKey;
        const seen = key ? this.idempotency.get(key) : undefined;
        if (seen) {
          if (seen.params !== JSON.stringify(params)) {
            throw Object.assign(new Error("Keys for idempotent requests can only be used with the same parameters"), {
              type: "StripeIdempotencyError",
              statusCode: 400,
            });
          }
          return seen.result;
        }
        this.sessions.push(params);
        if (this.createError) throw this.createError;
        const id = `cs_test_${this.sessions.length}`;
        const result = { id, url: `https://checkout.stripe.test/${id}` };
        if (key) this.idempotency.set(key, { params: JSON.stringify(params), result });
        return result;
      },
      expire: async (id: string) => {
        if (this.expireError) throw this.expireError;
        this.expired.push(id);
        this.sessionStatus[id] = "expired";
        return { id };
      },
      retrieve: async (id: string) => ({ id, status: this.sessionStatus[id] ?? ("open" as const) }),
      /** Sessions created through this fake, filtered like Stripe (customer, status). */
      list: async (params: Stripe.Checkout.SessionListParams) => {
        const all = this.sessions
          .map((p, i) => ({ id: `cs_test_${i + 1}`, metadata: (p.metadata ?? null) as Stripe.Metadata | null, customer: p.customer }))
          .filter((s) => !params.customer || s.customer === params.customer)
          .filter((s) => !params.status || (this.sessionStatus[s.id] ?? "open") === params.status);
        const start = params.starting_after ? all.findIndex((s) => s.id === params.starting_after) + 1 : 0;
        const size = Math.min(params.limit ?? 10, this.pageSize);
        const page = all.slice(start, start + size);
        return { data: page.map(({ id, metadata }) => ({ id, metadata })), has_more: start + size < all.length };
      },
    },
  };

  /** Charges by id (add with addCharge); refunds.create adds to amount_refunded like Stripe. */
  chargeStore: Record<string, FakeCharge> = {};
  /** invoice id → the payment intent that paid it (invoicePayments.list). */
  invoicePaymentIntent: Record<string, string> = {};

  /** A succeeded charge with its balance transaction (fee in `feeCurrency`, default AED). */
  addCharge(c: {
    id: string;
    paymentIntent: string;
    amount: number;
    currency: string;
    fee: number;
    feeCurrency?: string;
    exchangeRate?: number | null;
    created: number;
    amountRefunded?: number;
  }): void {
    this.chargeStore[c.id] = {
      id: c.id,
      object: "charge",
      payment_intent: c.paymentIntent,
      amount: c.amount,
      amount_refunded: c.amountRefunded ?? 0,
      currency: c.currency.toLowerCase(),
      created: c.created,
      status: "succeeded",
      refunded: false,
      balance_transaction: {
        id: `txn_${c.id}`,
        fee: c.fee,
        currency: (c.feeCurrency ?? "aed").toLowerCase(),
        exchange_rate: c.exchangeRate ?? null,
      },
    };
  }

  chargeListCalls: Stripe.ChargeListParams[] = [];

  charges = {
    list: async (params: Stripe.ChargeListParams) => {
      this.chargeListCalls.push(params);
      const data = Object.values(this.chargeStore).filter((c) => c.payment_intent === params.payment_intent);
      return { data, has_more: false };
    },
  };

  invoicePayments = {
    list: async (params: Stripe.InvoicePaymentListParams) => {
      const pi = params.invoice ? this.invoicePaymentIntent[params.invoice] : undefined;
      return {
        data: pi ? [{ id: `inpay_${params.invoice}`, status: "paid", payment: { type: "payment_intent" as const, payment_intent: pi } }] : [],
        has_more: false,
      };
    },
  };

  customers = {
    create: async (params: Stripe.CustomerCreateParams) => {
      this.customersCreated.push(params);
      return { id: `cus_test_${this.customersCreated.length}` };
    },
    retrieve: async (id: string) => {
      const last = [...this.customerUpdates].reverse().find((u) => u.id === id);
      return { invoice_settings: { default_payment_method: last?.params.invoice_settings?.default_payment_method ?? null } };
    },
    update: async (id: string, params: Stripe.CustomerUpdateParams) => {
      if (this.customerUpdateError) throw this.customerUpdateError;
      this.customerUpdates.push({ id, params });
      return { id };
    },
  };

  paymentIntents = {
    retrieve: async (id: string) => ({ id, payment_method: `pm_of_${id}` }),
  };

  paymentMethods = {
    retrieve: async (id: string) => ({ id, card: { last4: "4242" } }),
  };

  setupIntents = {
    retrieve: async (id: string) => ({ id, payment_method: { id: `pm_of_${id}` } }),
  };

  /** Runs inside invoices.create, after the draft exists and before it is returned (race tests). */
  onInvoiceCreate: (() => Promise<void>) | null = null;
  /** Extra fields returned by invoices.retrieve (for invoices not created through this fake). */
  invoiceDetails: Record<
    string,
    { amount_paid?: number; currency?: string; metadata?: Stripe.Metadata | null; hosted_invoice_url?: string | null }
  > = {};
  /** Set to make invoices.retrieve throw (Stripe unreachable). */
  invoiceRetrieveError: unknown = null;
  /** Draft invoices deleted (invoices.del). */
  deletedInvoices: string[] = [];

  invoices = {
    create: async (params: Stripe.InvoiceCreateParams) => {
      const id = `in_test_${this.invoicesCreated.length + 1}`;
      this.invoicesCreated.push({ id, params });
      this.invoiceStatus[id] = "draft";
      this.invoiceTotal[id] = 0;
      if (params.customer) this.invoiceCustomer[id] = params.customer;
      if (this.onInvoiceCreate) {
        const hook = this.onInvoiceCreate;
        this.onInvoiceCreate = null;
        await hook();
      }
      return { id };
    },
    del: async (id: string) => {
      if (this.invoiceStatus[id] !== "draft") throw new Error(`Only draft invoices can be deleted (${id})`);
      this.deletedInvoices.push(id);
      delete this.invoiceStatus[id];
      return { id, deleted: true as const };
    },
    retrieve: async (id: string) => {
      if (this.invoiceRetrieveError) throw this.invoiceRetrieveError;
      const created = this.invoicesCreated.find((i) => i.id === id)?.params;
      return {
        id,
        status: this.invoiceStatus[id] ?? null,
        total: this.invoiceTotal[id] ?? 0,
        collection_method: (created?.collection_method ?? "charge_automatically") as Stripe.Invoice.CollectionMethod,
        metadata: (created?.metadata ?? null) as Stripe.Metadata | null,
        currency: created?.currency ?? "",
        amount_paid: this.invoiceStatus[id] === "paid" ? (this.invoiceTotal[id] ?? 0) : 0,
        ...this.invoiceDetails[id],
      };
    },
    finalizeInvoice: async (id: string, params?: Stripe.InvoiceFinalizeInvoiceParams) => {
      this.invoiceFinalized.push({ id, params });
      this.invoiceStatus[id] = "open";
      return { id, status: "open" as InvoiceStatus };
    },
    pay: async (id: string) => {
      if (this.payError) throw this.payError;
      this.invoicePaid.push(id);
      this.invoiceStatus[id] = "paid";
      return { id, status: "paid" as InvoiceStatus };
    },
    sendInvoice: async (id: string, _params?: Stripe.InvoiceSendInvoiceParams, options?: Stripe.RequestOptions) => {
      if (this.sendInvoiceError) {
        const e = this.sendInvoiceError;
        this.sendInvoiceError = null;
        throw e;
      }
      this.invoicesSent.push({ id, idempotencyKey: options?.idempotencyKey });
      return { id };
    },
    voidInvoice: async (id: string) => {
      if (this.voidError) {
        const e = this.voidError;
        this.voidError = null;
        throw e;
      }
      this.voided.push(id);
      this.invoiceStatus[id] = "void";
      return { id };
    },
    list: async (params: Stripe.InvoiceListParams) => {
      const all = Object.keys(this.invoiceStatus)
        .filter((id) => !params.status || this.invoiceStatus[id] === params.status)
        .filter((id) => !params.customer || this.invoiceCustomer[id] === params.customer);
      const start = params.starting_after ? all.indexOf(params.starting_after) + 1 : 0;
      const size = Math.min(params.limit ?? 10, this.pageSize);
      const page = all.slice(start, start + size);
      return { data: page.map((id) => ({ id })), has_more: start + size < all.length };
    },
    update: async (id: string, params: Stripe.InvoiceUpdateParams) => {
      this.invoiceUpdates.push({ id, params });
      return { id };
    },
  };

  refundsCreated: { params: Stripe.RefundCreateParams; options?: Stripe.RequestOptions }[] = [];

  /** Set to make the next refunds.create throw (once). */
  refundError: unknown = null;

  /** Idempotency keys seen by refunds.create (like Stripe: same params → same refund, else an error). */
  refundIdempotency = new Map<string, { params: string; result: { id: string } }>();

  /** Refunds Stripe already has (from the dashboard or an earlier run), listed by refunds.list. */
  existingRefunds: {
    id: string;
    charge: string;
    /** When set, refunds.list by payment_intent only returns it for that payment intent. */
    payment_intent?: string;
    amount: number;
    status: string;
    metadata: Record<string, string>;
    /** Unix seconds (default 0). */
    created?: number;
  }[] = [];

  refunds = {
    list: async (params: Stripe.RefundListParams) => {
      const made = this.refundsCreated.map((r, i) => ({
        id: `re_test_${i + 1}`,
        charge: r.params.charge ?? null,
        payment_intent: r.params.payment_intent,
        amount: r.params.amount ?? 0,
        status: "succeeded",
        metadata: (r.params.metadata ?? {}) as Record<string, string>,
        created: Math.floor(Date.now() / 1000),
      }));
      const all = [...this.existingRefunds, ...made]
        .filter((r) => !params.charge || r.charge === params.charge)
        .filter((r) => !params.payment_intent || r.payment_intent === undefined || r.payment_intent === params.payment_intent);
      return {
        data: all.map(({ id, status, metadata, amount, created }) => ({ id, status, metadata, amount, created: created ?? 0 })),
        has_more: false,
      };
    },
    create: async (params: Stripe.RefundCreateParams, options?: Stripe.RequestOptions) => {
      if (this.refundError) {
        const e = this.refundError;
        this.refundError = null;
        throw e;
      }
      const key = options?.idempotencyKey;
      const seen = key ? this.refundIdempotency.get(key) : undefined;
      if (seen) {
        if (seen.params !== JSON.stringify(params)) {
          throw Object.assign(new Error("Keys for idempotent requests can only be used with the same parameters"), {
            type: "StripeIdempotencyError",
            statusCode: 400,
          });
        }
        return seen.result;
      }
      this.refundsCreated.push(options ? { params, options } : { params });
      const charge = params.charge ? this.chargeStore[params.charge] : undefined;
      if (charge) charge.amount_refunded += params.amount ?? charge.amount - charge.amount_refunded;
      const result = { id: `re_test_${this.refundsCreated.length}` };
      if (key) this.refundIdempotency.set(key, { params: JSON.stringify(params), result });
      return result;
    },
  };

  invoiceItems = {
    create: async (params: Stripe.InvoiceItemCreateParams) => {
      if (this.invoiceItemError) {
        const e = this.invoiceItemError;
        this.invoiceItemError = null;
        throw e;
      }
      this.invoiceItemsCreated.push(params);
      if (params.invoice) this.invoiceTotal[params.invoice] = (this.invoiceTotal[params.invoice] ?? 0) + (params.amount ?? 0);
      return { id: `ii_test_${this.invoiceItemsCreated.length}` };
    },
  };
}
