/**
 * DEVELOPMENT-ONLY synthetic stock generator.
 *
 * This module must only ever be reached when ENABLE_FANTACY_MOCK_DATA === "true".
 * It is dynamically imported by the API route so that neither the generator nor
 * the reference fixture is bundled into a normal production build.
 *
 * Every record it emits is tagged `source: "mock"` and `__synthetic: true`, so
 * mock rows are identifiable at every downstream layer (route, client, cache)
 * and can never be mistaken for live stock.
 *
 * History: the previous generator lived inside the API route and ran whenever
 * the live call failed OR returned zero rows after filtering. Combined with a
 * `filteredItems.length > 0 ? filteredItems : items` fallback, that silently
 * substituted tens of thousands of fabricated lots for real stock. Both the
 * unconditional fallback and the generator's presence in the production path
 * are gone -- this file exists purely for offline UI development.
 */

import polish2Reference from "./polish2_reference.json";
import {
  SYNTHETIC_SERIE_PREFIX,
  SYNTHETIC_REMARK_PREFIX,
} from "../fantacyStockFilter.js";

const SHAPES = ["ROUND", "PRINCESS", "CUSHION", "EMERALD", "OVAL", "PEAR", "RADIANT", "MARQUISE"];
const COLORS = ["D", "E", "F", "G", "H", "I", "J", "K"];
const CLARITIES = ["FL", "IF", "VVS1", "VVS2", "VS1", "VS2", "SI1", "SI2"];

// Uses the department spelling the live API actually returns ("Polish-3"),
// not the sheet-export spelling, so mock exercises the real code path.
const MOCK_DEPARTMENTS = [
  ...Array.from({ length: 15 }, (_, i) => `Polish-${i + 1}`),
  "SF-2",
];

function tag(record) {
  return { ...record, source: "mock", __synthetic: true };
}

/**
 * @param {number} skip
 * @param {number} take
 * @param {number} totalAvailable
 * @returns {object[]}
 */
export function generateMockStock(skip = 0, take = 100, totalAvailable = 5000) {
  const records = [];

  // Seed the first page with the real Polish-2 reference set so offline work
  // has one department that mirrors production shape exactly.
  if (skip === 0) {
    records.push(
      ...polish2Reference.map((item, index) => {
        const sendDate = new Date(Date.now() - ((index * 13 + 3) % 950) * 86400000);
        return tag({
          ...item,
          ProcessSendDate: sendDate.toISOString().slice(0, 10),
          PreviousProcessRtnDate: sendDate.toISOString().slice(0, 10),
          DocDate: sendDate.toISOString(),
        });
      })
    );
  }

  const end = Math.min(skip + take, totalAvailable);
  for (let i = skip + 1; i <= end; i += 1) {
    const weight = +(0.3 + ((i * 0.037) % 5.2)).toFixed(3);
    const sendDate = new Date(Date.now() - ((i * 17 + 5) % 950) * 86400000);
    const rtnDate = new Date(sendDate.getTime() - (i % 3) * 86400000);

    records.push(
      tag({
        Stock_ID: 8183100 + i,
        LotID: String(83152800 + i),
        LotName: `${["654-", "643-", "653-", "637-", "628-"][i % 5]}${String((i * 137 + 325) % 9999).padStart(4, "0")}`,
        DepartmentAccountName: MOCK_DEPARTMENTS[i % MOCK_DEPARTMENTS.length],
        LocationAccountName: MOCK_DEPARTMENTS[i % MOCK_DEPARTMENTS.length],
        PreviousLocationAccountName: MOCK_DEPARTMENTS[(i + 1) % MOCK_DEPARTMENTS.length],
        EstimateShapeID: SHAPES[i % SHAPES.length],
        EstimateColorID: COLORS[i % COLORS.length],
        EstimateClarityID: CLARITIES[i % CLARITIES.length],
        EstimateQualityID: "EXCELLENT",
        EstimateWeight: weight,
        Weight: weight,
        Quantity: 1,
        SerieID: `${SYNTHETIC_SERIE_PREFIX}${String(i % 50).padStart(2, "0")}`,
        ExternalSourceLotRemark: `${SYNTHETIC_REMARK_PREFIX}${String(i % 100).padStart(2, "0")}`,
        ItemTypeID: "POLISHED_DIAMOND",
        ProductionStatusID: "IN_PROGRESS",
        ProcessID: "POLISHING",
        ProcessName: "Final Polishing",
        ProcessSendDate: sendDate.toISOString().slice(0, 10),
        PreviousProcessRtnDate: rtnDate.toISOString().slice(0, 10),
        PreviousProcessReturnStatusID: "COMPLETED",
        TB209: `TB209-${(i % 12) + 1}`,
        TB104ID: `Lvl-${(i % 5) + 1}`,
        TB401: +(54.0 + (i % 10) * 0.5).toFixed(1),
        LotMeasurements1: +(3.5 + ((i * 0.01) % 2.0)).toFixed(2),
        LotMeasurements2: +(3.5 + ((i * 0.02) % 2.0)).toFixed(2),
        LotMeasurements3: +(2.1 + ((i * 0.01) % 1.5)).toFixed(2),
        DocID: 81105900 + i,
        DocDate: sendDate.toISOString(),
      })
    );
  }

  return records;
}

// Synthetic-record detection lives in `@/lib/fantacyStockFilter` so the client
// can purge stale mock rows without importing this dev module or its fixture.
export { isSyntheticRecord } from "../fantacyStockFilter.js";
