exports.up = async function (knex) {
  // MPS 5.6 / 11: effective-dated, versioned Polish piece rates. category is
  // ROUND_OEB | FANCY_IGI | FANCY_GIA. max_weight is null to mean unbounded
  // ("≥ X.XX"). The EXCLUDE constraint makes it physically impossible to
  // create two rows for the same category whose weight slab AND effective
  // date range both overlap -- i.e. "overlapping active rate applicability
  // must be prevented" is a hard DB guarantee, not just app-level validation.
  await knex.raw(`
    CREATE TABLE rates_polish (
      id SERIAL PRIMARY KEY,
      category TEXT NOT NULL CHECK (category IN ('ROUND_OEB','FANCY_IGI','FANCY_GIA')),
      min_weight NUMERIC(10,2) NOT NULL,
      max_weight NUMERIC(10,2),
      rate_per_ct NUMERIC(12,2) NOT NULL,
      effective_from DATE NOT NULL,
      effective_to DATE,
      weight_range NUMRANGE GENERATED ALWAYS AS (
        numrange(min_weight, COALESCE(max_weight, 'infinity'::numeric), '[]')
      ) STORED,
      date_range DATERANGE GENERATED ALWAYS AS (
        daterange(effective_from, COALESCE(effective_to, 'infinity'::date), '[]')
      ) STORED,
      created_by INTEGER REFERENCES users(id),
      created_at TIMESTAMP NOT NULL DEFAULT now(),
      EXCLUDE USING gist (
        category WITH =,
        weight_range WITH &&,
        date_range WITH &&
      )
    )
  `);
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('rates_polish');
};
