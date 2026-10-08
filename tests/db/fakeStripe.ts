import type Stripe from "stripe";
import type { StripeApi } from "../../lib/stripe/client";

type InvoiceStatus = Stripe.Invoice.Status;

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

  setupIntents = {
    retrieve: async (id: string) => ({ id, payment_method: { id: `pm_of_${id}` } }),
  };

  invoices = {
    create: async (params: Stripe.InvoiceCreateParams) => {
      const id = `in_test_${this.invoicesCreated.length + 1}`;
      this.invoicesCreated.push({ id, params });
      this.invoiceStatus[id] = "draft";
      this.invoiceTotal[id] = 0;
      if (params.customer) this.invoiceCustomer[id] = params.customer;
      return { id };
    },
    retrieve: async (id: string) => ({
      id,
      status: this.invoiceStatus[id] ?? null,
      total: this.invoiceTotal[id] ?? 0,
      collection_method: (this.invoicesCreated.find((i) => i.id === id)?.params.collection_method ??
        "charge_automatically") as Stripe.Invoice.CollectionMethod,
    }),
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

  refunds = {
    create: async (params: Stripe.RefundCreateParams, options?: Stripe.RequestOptions) => {
      if (this.refundError) {
        const e = this.refundError;
        this.refundError = null;
        throw e;
      }
      this.refundsCreated.push(options ? { params, options } : { params });
      return { id: `re_test_${this.refundsCreated.length}` };
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
