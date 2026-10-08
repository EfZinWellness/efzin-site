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
  voided: string[] = [];
  /** Set to make the next create / expire call throw. */
  createError: unknown = null;
  expireError: unknown = null;
  /** Set to make invoices.pay throw (e.g. a card error). */
  payError: unknown = null;
  /** Set to make customers.update throw. */
  customerUpdateError: unknown = null;

  checkout = {
    sessions: {
      create: async (params: Stripe.Checkout.SessionCreateParams) => {
        this.sessions.push(params);
        if (this.createError) throw this.createError;
        const id = `cs_test_${this.sessions.length}`;
        return { id, url: `https://checkout.stripe.test/${id}` };
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
      if (params.customer) this.invoiceCustomer[id] = params.customer;
      return { id };
    },
    retrieve: async (id: string) => ({ id, status: this.invoiceStatus[id] ?? null }),
    finalizeInvoice: async (id: string) => {
      this.invoiceStatus[id] = "open";
      return { id, status: "open" as InvoiceStatus };
    },
    pay: async (id: string) => {
      if (this.payError) throw this.payError;
      this.invoiceStatus[id] = "paid";
      return { id, status: "paid" as InvoiceStatus };
    },
    voidInvoice: async (id: string) => {
      this.voided.push(id);
      this.invoiceStatus[id] = "void";
      return { id };
    },
    list: async (params: Stripe.InvoiceListParams) => ({
      data: Object.keys(this.invoiceStatus)
        .filter((id) => (!params.status || this.invoiceStatus[id] === params.status))
        .filter((id) => !params.customer || this.invoiceCustomer[id] === params.customer)
        .map((id) => ({ id })),
    }),
    update: async (id: string, params: Stripe.InvoiceUpdateParams) => {
      this.invoiceUpdates.push({ id, params });
      return { id };
    },
  };

  invoiceItems = {
    create: async (params: Stripe.InvoiceItemCreateParams) => {
      this.invoiceItemsCreated.push(params);
      return { id: `ii_test_${this.invoiceItemsCreated.length}` };
    },
  };
}
