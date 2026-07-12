/**
 * The neutral core: domain types + pure derivation, zero `@backstage/*`.
 * This is the reusable piece an adapter maps onto (Backstage today; a
 * standalone runtime later). See ADR 0011 and CONTEXT.md.
 */

export * from './snapshot';
export * from './health';
