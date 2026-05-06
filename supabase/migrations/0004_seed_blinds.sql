-- ============================================================================
-- Seed: standard tournament blind structures (PokerStars / GG-style)
-- Levels in micro-USDC chips (1 chip = 1 micro). Starting stack 30k chips
-- represents 30,000 chips at the table — relative to blinds, not USD.
-- ============================================================================

insert into blind_structures (name, starting_stack, level_seconds, break_after_levels, levels)
values
  ('turbo', 5000, 300, '{6,12,18}'::int[],
    jsonb_build_array(
      jsonb_build_object('level', 1,  'sb', 25,   'bb', 50,    'ante', 0),
      jsonb_build_object('level', 2,  'sb', 50,   'bb', 100,   'ante', 0),
      jsonb_build_object('level', 3,  'sb', 75,   'bb', 150,   'ante', 25),
      jsonb_build_object('level', 4,  'sb', 100,  'bb', 200,   'ante', 25),
      jsonb_build_object('level', 5,  'sb', 150,  'bb', 300,   'ante', 50),
      jsonb_build_object('level', 6,  'sb', 200,  'bb', 400,   'ante', 75),
      jsonb_build_object('level', 7,  'sb', 300,  'bb', 600,   'ante', 100),
      jsonb_build_object('level', 8,  'sb', 400,  'bb', 800,   'ante', 150),
      jsonb_build_object('level', 9,  'sb', 600,  'bb', 1200,  'ante', 200),
      jsonb_build_object('level', 10, 'sb', 800,  'bb', 1600,  'ante', 300),
      jsonb_build_object('level', 11, 'sb', 1200, 'bb', 2400,  'ante', 400),
      jsonb_build_object('level', 12, 'sb', 1600, 'bb', 3200,  'ante', 500),
      jsonb_build_object('level', 13, 'sb', 2500, 'bb', 5000,  'ante', 750),
      jsonb_build_object('level', 14, 'sb', 4000, 'bb', 8000,  'ante', 1000),
      jsonb_build_object('level', 15, 'sb', 6000, 'bb', 12000, 'ante', 1500),
      jsonb_build_object('level', 16, 'sb', 10000,'bb', 20000, 'ante', 2500),
      jsonb_build_object('level', 17, 'sb', 15000,'bb', 30000, 'ante', 4000),
      jsonb_build_object('level', 18, 'sb', 25000,'bb', 50000, 'ante', 6000),
      jsonb_build_object('level', 19, 'sb', 40000,'bb', 80000, 'ante', 10000),
      jsonb_build_object('level', 20, 'sb', 60000,'bb', 120000,'ante', 15000)
    )
  ),
  ('regular', 10000, 600, '{4,8,12,16,20}'::int[],
    jsonb_build_array(
      jsonb_build_object('level', 1,  'sb', 25,   'bb', 50,    'ante', 0),
      jsonb_build_object('level', 2,  'sb', 50,   'bb', 100,   'ante', 0),
      jsonb_build_object('level', 3,  'sb', 75,   'bb', 150,   'ante', 0),
      jsonb_build_object('level', 4,  'sb', 100,  'bb', 200,   'ante', 25),
      jsonb_build_object('level', 5,  'sb', 150,  'bb', 300,   'ante', 50),
      jsonb_build_object('level', 6,  'sb', 200,  'bb', 400,   'ante', 50),
      jsonb_build_object('level', 7,  'sb', 250,  'bb', 500,   'ante', 75),
      jsonb_build_object('level', 8,  'sb', 300,  'bb', 600,   'ante', 100),
      jsonb_build_object('level', 9,  'sb', 400,  'bb', 800,   'ante', 100),
      jsonb_build_object('level', 10, 'sb', 500,  'bb', 1000,  'ante', 150),
      jsonb_build_object('level', 11, 'sb', 700,  'bb', 1400,  'ante', 200),
      jsonb_build_object('level', 12, 'sb', 1000, 'bb', 2000,  'ante', 300),
      jsonb_build_object('level', 13, 'sb', 1500, 'bb', 3000,  'ante', 400),
      jsonb_build_object('level', 14, 'sb', 2000, 'bb', 4000,  'ante', 500),
      jsonb_build_object('level', 15, 'sb', 3000, 'bb', 6000,  'ante', 750),
      jsonb_build_object('level', 16, 'sb', 4000, 'bb', 8000,  'ante', 1000),
      jsonb_build_object('level', 17, 'sb', 6000, 'bb', 12000, 'ante', 1500),
      jsonb_build_object('level', 18, 'sb', 8000, 'bb', 16000, 'ante', 2000),
      jsonb_build_object('level', 19, 'sb', 12000,'bb', 24000, 'ante', 3000),
      jsonb_build_object('level', 20, 'sb', 20000,'bb', 40000, 'ante', 5000),
      jsonb_build_object('level', 21, 'sb', 30000,'bb', 60000, 'ante', 7500),
      jsonb_build_object('level', 22, 'sb', 50000,'bb', 100000,'ante', 12500)
    )
  ),
  ('hyper', 1500, 180, '{}'::int[],
    jsonb_build_array(
      jsonb_build_object('level', 1, 'sb', 10,  'bb', 20,  'ante', 0),
      jsonb_build_object('level', 2, 'sb', 15,  'bb', 30,  'ante', 5),
      jsonb_build_object('level', 3, 'sb', 25,  'bb', 50,  'ante', 10),
      jsonb_build_object('level', 4, 'sb', 50,  'bb', 100, 'ante', 15),
      jsonb_build_object('level', 5, 'sb', 75,  'bb', 150, 'ante', 25),
      jsonb_build_object('level', 6, 'sb', 100, 'bb', 200, 'ante', 30),
      jsonb_build_object('level', 7, 'sb', 150, 'bb', 300, 'ante', 50),
      jsonb_build_object('level', 8, 'sb', 250, 'bb', 500, 'ante', 75),
      jsonb_build_object('level', 9, 'sb', 400, 'bb', 800, 'ante', 100),
      jsonb_build_object('level', 10,'sb', 600, 'bb', 1200,'ante', 200),
      jsonb_build_object('level', 11,'sb', 1000,'bb', 2000,'ante', 300),
      jsonb_build_object('level', 12,'sb', 1500,'bb', 3000,'ante', 400)
    )
  )
on conflict (name) do nothing;
