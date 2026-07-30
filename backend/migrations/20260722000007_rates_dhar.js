exports.up = async function (knex) {
  // MPS 8: DHAR rate = Weight x applicable Issue-Date rate, keyed by
  // classification (ALL_SHAPE | ROUND) and derived weight_slab (LT_2 | GTE_2).
  await knex.raw(`
    CREATE TABLE rates_dhar (
      id SERIAL PRIMARY KEY,
      classification TEXT NOT NULL CHECK (classification IN ('ALL_SHAPE','ROUND')),
      weight_slab TEXT NOT NULL CHECK (weight_slab IN ('LT_2','GTE_2')),
      rate_per_ct NUMERIC(12,2) NOT NULL,
      effective_from DATE NOT NULL,
      effective_to DATE,
      date_range DATERANGE GENERATED ALWAYS AS (
        daterange(effective_from, COALESCE(effective_to, 'infinity'::date), '[]')
      ) STORED,
      created_by INTEGER REFERENCES users(id),
      created_at TIMESTAMP NOT NULL DEFAULT now(),
      EXCLUDE USING gist (
        classification WITH =,
        weight_slab WITH =,
        date_range WITH &&
      )
    )
  `);
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('rates_dhar');
};
