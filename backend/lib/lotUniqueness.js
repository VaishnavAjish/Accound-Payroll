function normalizeLotValue(value) {
  return String(value || '').trim().toLowerCase();
}

async function findExistingLot(db, { lotId, lotName, exclude = {} }) {
  const normalizedLotId = normalizeLotValue(lotId);
  const normalizedLotName = normalizeLotValue(lotName);

  if (!normalizedLotId || !normalizedLotName) return null;

  const tables = [
    { table: 'polish_entries', type: 'Polish' },
    { table: 'dhar_entries', type: 'DHAR' },
    { table: 'maxi_entries', type: 'MAXI' },
  ];

  for (const item of tables) {
    const excludedId = exclude[item.table];
    let query = db(item.table)
      .whereRaw('LOWER(TRIM(lot_id)) = ?', [normalizedLotId])
      .whereRaw('LOWER(TRIM(lot_name)) = ?', [normalizedLotName]);

    if (excludedId) query = query.whereNot('id', excludedId);

    const row = await query.first();
    if (row) return { ...row, entry_type: item.type, table: item.table };
  }

  return null;
}

async function assertUniqueLot(db, { lotId, lotName, exclude = {} }) {
  const existing = await findExistingLot(db, { lotId, lotName, exclude });
  if (!existing) return;

  const err = new Error(
    `This lot already exists in the system as ${existing.entry_type} entry #${existing.id}. Lot ID and Lot Name must be unique.`
  );
  err.status = 409;
  throw err;
}

module.exports = { assertUniqueLot, findExistingLot };
