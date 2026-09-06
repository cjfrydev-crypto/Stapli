# Stapli product contract

## Product promise

**Open the list, shop, tick things, close it. Stapli learns the rest.**

## Core rules

1. A household **need** is distinct from the exact retailer **article** that satisfies it.
2. Checking an item means bought; its suggested quantity is assumed unless the shopper adjusts it.
3. Quantity correction must be one tap away (`− / +`), including immediately after checking the item.
4. Unbought items never silently disappear.
5. “Couldn’t get it”, “still have some”, and “leave for another shop” are different signals.
6. Prediction is selectable: `Auto`, `Manual`, or `Off`.
7. Observed buying behaviour is calculated regardless of prediction mode.
8. The primary observed comparison is the rolling last-16-week cadence.
9. Manual settings never get silently overwritten by observed behaviour.
10. Routine history drives learning; one-off/recipe-event purchases do not redefine normal household cadence.
11. Retailer-specific articles matter because the household may prefer a particular pack/brand/price at Tesco versus Asda.
12. Retailer imports are preserved as raw source records so future matching improvements do not require re-exporting history.
13. Re-importing the same/updated retailer history must be idempotent.
14. Household data is private to household members, with real individual logins.

## Shopping-generation behaviour

When generating a store trip, Stapli should:

- carry unresolved needs forward;
- include manually scheduled needs due by the planned date;
- include auto-predicted needs only once evidence is sufficient;
- choose the preferred article for that retailer when known;
- keep needs with no suitable article visible rather than pretending they do not exist;
- eventually surface cross-store choices explicitly: use an alternative here, keep for the usual store, or defer.

## Cadence display

A manual setting and actual behaviour are separate truths.

Example:

```text
Dishwasher tablets
Set: every 14 days
Observed (16 weeks): every 9.2 days
Trend: buying faster
```

Stapli may offer to update the manual setting, but does not do so without the user choosing it.
