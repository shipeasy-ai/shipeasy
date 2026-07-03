"use client";

import * as React from "react";
// The client SDK entrypoint. Gate/experiment reads happen through `flags`.
import { flags } from "@shipeasy/sdk/client";

/**
 * Checkout page for the storefront.
 *
 * The "Complete purchase" button is the primary conversion action — the natural
 * thing to A/B test (e.g. its colour or copy), measured by whether the user then
 * completes checkout. It's currently the default indigo; a variant might try a
 * green button to see if it lifts completed checkouts.
 */
export default function CheckoutPage() {
  const [submitting, setSubmitting] = React.useState(false);

  async function handleComplete() {
    setSubmitting(true);
    // A purchase completed here. This is where a conversion event would fire
    // (e.g. a "checkout_completed" event) so a metric can measure it.
    await placeOrder();
    setSubmitting(false);
  }

  return (
    <main className="checkout">
      <h1>Checkout</h1>
      <ul className="cart-summary">
        <li>1 × Pro plan — $29/mo</li>
        <li>Tax — $2.32</li>
      </ul>

      <button
        type="button"
        data-testid="checkout-complete"
        onClick={handleComplete}
        disabled={submitting}
        style={{
          background: "#6366f1", // current checkout button colour
          color: "white",
          padding: "12px 24px",
          borderRadius: 8,
          border: "none",
          fontWeight: 600,
        }}
      >
        {submitting ? "Processing…" : "Complete purchase"}
      </button>
    </main>
  );
}

async function placeOrder(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 400));
}

// Silence "unused" until the experiment assignment is wired into the button.
void flags;
