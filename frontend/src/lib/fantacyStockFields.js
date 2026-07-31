/**
 * The columns requested from Skylab's POST /api/stock.
 *
 * SINGLE SOURCE OF TRUTH. Imported by both the API route and
 * scripts/skylab-probe.mjs so a probe always exercises exactly what production
 * sends. They previously held separate copies, drifted apart, and a probe run
 * "verified" a field list the route no longer used.
 *
 * EVERY name here is verified to exist on type `Lot` against the live API. An
 * unknown column fails the ENTIRE request with
 *   "No property or field 'X' exists in type 'Lot'"
 * so never add one speculatively. Check first:
 *   node --env-file=.env.local scripts/skylab-fields.mjs --try YourFieldName
 *
 * The list mirrors `requestedColumns` in /fantacy/data-fetch/page.js -- the
 * columns the grid actually renders.
 *
 * Verified ABSENT, do not re-add:
 *   Company, CompanyName, ExternalNotes, ProductionStatus, Status
 * The grid's "External Notes" comes from `Remark`, its "Production Status" from
 * `ProductionStatusID`.
 */
export const STOCK_SELECT_FIELD_LIST = Object.freeze([
  // Filtering + identity. CompanyID and DepartmentAccountName are read by the
  // row filters; LotID and Stock_ID are the dedupe keys. Do not remove these.
  "CompanyID",
  "DepartmentAccountName",
  "LotStatusDB",
  "LotID",
  "Stock_ID",

  // Grid columns
  "ItemTypeID",
  "SerieID",
  "Quantity",
  "Remark",
  "LotName",
  "EstimateWeight",
  "Weight",
  "ProductionStatusID",
  "EstimateShapeID",
  "ProcessID",
  "LocationAccountName",
  "EstimateColorID",
  "EstimateClarityID",
  "EstimateQualityID",
  "ProcessSendDate",
  "PreviousProcessRtnDate",
  "TB209",
  "LotMeasurements1",
  "LotMeasurements2",
  "LotMeasurements3",
  "TB401",
  "TB104ID",
  "PreviousLocationAccountName",
  "PreviousProcessReturnStatusID",
]);

/** Comma-separated form, as the `select` parameter expects. */
export const STOCK_SELECT_FIELDS = STOCK_SELECT_FIELD_LIST.join(",");
